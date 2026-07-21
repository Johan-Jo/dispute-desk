import { describe, it, expect } from "vitest";
import { buildBaseline, type DisputeRecordRow } from "@/lib/intelligence/report/baseline";
import { detectOpportunities } from "@/lib/intelligence/opportunities/detect";
import type { DataQualityReport } from "@/lib/intelligence/types";

function rec(p: Partial<DisputeRecordRow>): DisputeRecordRow {
  return {
    dispute_id: Math.random().toString(36).slice(2),
    initiated_at: "2024-01-01T00:00:00Z",
    due_at: "2024-01-15T00:00:00Z",
    submitted_at: "2024-01-10T00:00:00Z",
    reason: "FRAUDULENT",
    phase: "chargeback",
    final_outcome: "won",
    amount: "100.00",
    currency_code: "USD",
    outcome_amount_recovered: "100.00",
    is_adjudicated: true,
    ...p,
  };
}

describe("buildBaseline — §7.1 metrics with correct denominators", () => {
  const rows: DisputeRecordRow[] = [
    rec({ final_outcome: "won", outcome_amount_recovered: "100.00" }),
    rec({ final_outcome: "won", outcome_amount_recovered: "100.00" }),
    rec({ final_outcome: "partially_won", outcome_amount_recovered: "40.00" }),
    rec({ final_outcome: "lost", outcome_amount_recovered: null }),
    // excluded from win-rate denominators:
    rec({ final_outcome: "withdrawn", is_adjudicated: false, outcome_amount_recovered: null }),
    rec({ final_outcome: "pending", submitted_at: null, is_adjudicated: false, outcome_amount_recovered: null }),
  ];
  const b = buildBaseline(rows);

  it("full-win-rate denominator = adjudicated responded (excludes withdrawn/pending)", () => {
    // won,won,partially_won,lost = 4 adjudicated responded; wins = 2
    expect(b.rates.fullWinRate.numerator).toBe(2);
    expect(b.rates.fullWinRate.denominator).toBe(4);
  });

  it("any-recovery-rate counts won + partially_won, no fractional credit", () => {
    expect(b.rates.anyRecoveryRate.numerator).toBe(3); // 2 won + 1 partial (whole)
    expect(b.rates.anyRecoveryRate.denominator).toBe(4);
  });

  it("monetary recovery uses bootstrap (not Wilson)", () => {
    expect(b.monetary.monetaryRecoveryRate.method).toBe("bootstrap");
    expect(b.monetary.avgRecoveryPerResponse.method).toBe("bootstrap");
  });

  it("net loss = disputed - recovered in minor units", () => {
    // disputed: 6×100 = 600.00 ; recovered: 100+100+40 = 240.00 ; net = 360.00
    expect(b.portfolio.totalDisputedAmount.amountMinor).toBe("600.00");
    expect(b.portfolio.totalRecovered.amountMinor).toBe("240.00");
    expect(b.portfolio.totalNetLoss.amountMinor).toBe("360.00");
  });

  it("raw response rate denominator = disputes with initiated_at + due_at", () => {
    expect(b.rates.rawResponseRate.denominator).toBe(6);
    expect(b.rates.rawResponseRate.numerator).toBe(5); // one pending has submitted_at null
  });
});

const DQ_LEAKY: DataQualityReport = {
  facts: {} as never,
  areas: [],
  riskPreventionSupported: false,
  globalLimitations: [],
};

describe("detectOpportunities — descriptive, gated, suppresses risk prevention", () => {
  it("emits an unanswered-disputes opportunity when enough are unanswered", () => {
    const rows: DisputeRecordRow[] = [
      ...Array.from({ length: 20 }, () => rec({ final_outcome: "won", submitted_at: "2024-01-10T00:00:00Z" })),
      ...Array.from({ length: 15 }, () => rec({ submitted_at: null, final_outcome: "lost", is_adjudicated: true, outcome_amount_recovered: null })),
    ];
    const b = buildBaseline(rows);
    const drafts = detectOpportunities(rows, b, DQ_LEAKY);
    const unanswered = drafts.find((d) => d.title.includes("Unanswered"));
    expect(unanswered).toBeDefined();
    expect(unanswered!.category).toBe("response");
    expect(unanswered!.evidenceGrade).toBe("descriptive");
    expect(unanswered!.affectedDisputeCount).toBe(15);
  });

  it("emits no risk-based prevention recommendation when leakage flagged", () => {
    const rows = Array.from({ length: 30 }, () => rec({}));
    const b = buildBaseline(rows);
    const drafts = detectOpportunities(rows, b, DQ_LEAKY);
    expect(drafts.every((d) => d.category !== "prevention")).toBe(true);
  });

  it("suppresses the unanswered opportunity below the sample gate", () => {
    const rows: DisputeRecordRow[] = [
      ...Array.from({ length: 20 }, () => rec({ submitted_at: "2024-01-10T00:00:00Z" })),
      ...Array.from({ length: 3 }, () => rec({ submitted_at: null })), // only 3 unanswered < gate(10)
    ];
    const b = buildBaseline(rows);
    const drafts = detectOpportunities(rows, b, DQ_LEAKY);
    expect(drafts.find((d) => d.title.includes("Unanswered"))).toBeUndefined();
  });
});
