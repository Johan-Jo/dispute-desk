import { describe, it, expect } from "vitest";
import { evaluateModelFeasibility, DEFAULT_MODEL_GATES } from "@/lib/intelligence/models/feasibility";
import type { DisputeRecordRow } from "@/lib/intelligence/report/baseline";

function adj(year: string, outcome: "won" | "lost" | "partially_won"): DisputeRecordRow {
  return {
    dispute_id: Math.random().toString(36).slice(2),
    initiated_at: `${year}-06-01T00:00:00Z`,
    due_at: `${year}-06-15T00:00:00Z`,
    submitted_at: `${year}-06-10T00:00:00Z`,
    reason: "FRAUDULENT", phase: "chargeback",
    final_outcome: outcome, amount: "100.00", currency_code: "USD",
    outcome_amount_recovered: outcome === "lost" ? null : "100.00",
    is_adjudicated: true,
  };
}

describe("model feasibility gates", () => {
  it("prevention is infeasible — too few leakage-safe order-time features (§14)", () => {
    const rows = Array.from({ length: 300 }, () => adj("2025", "won"));
    const v = evaluateModelFeasibility(rows).verdicts.find((x) => x.model === "prevention")!;
    // Only customer tenure is a leakage-safe ODT feature; risk is retrospective
    // and order-value/gateway/carrier are unverified — below the 3-feature gate.
    expect(v.feasible).toBe(false);
    expect(v.eligibleFeatures.length).toBeLessThan(3);
    expect(v.eligibleFeatures).not.toContain("risk_level_initial");
    expect(v.fallback).toBe("descriptive_only");
  });

  it("response-win is INFEASIBLE when underpowered (few events / folds)", () => {
    const rows = [
      ...Array.from({ length: 12 }, () => adj("2025", "won")),
      ...Array.from({ length: 8 }, () => adj("2025", "lost")),
    ];
    const report = evaluateModelFeasibility(rows);
    const v = report.verdicts.find((x) => x.model === "response_win_pooled")!;
    expect(v.feasible).toBe(false);
    expect(report.anyModelBuilt).toBe(false);
    expect(report.summary).toMatch(/unsupported/);
    expect(report.summary).toMatch(/P\(win \| historically contested/);
  });

  it("response-win becomes FEASIBLE with enough events, folds, and balance", () => {
    const rows: DisputeRecordRow[] = [];
    for (const y of ["2023", "2024", "2025", "2026"]) {
      for (let i = 0; i < 60; i++) rows.push(adj(y, i % 3 === 0 ? "lost" : "won"));
    }
    const report = evaluateModelFeasibility(rows);
    const v = report.verdicts.find((x) => x.model === "response_win_pooled")!;
    expect(v.feasible).toBe(true);
    expect(v.eligibleFeatures).toEqual(expect.arrayContaining(["dispute_reason_raw", "dispute_phase"]));
    expect(report.anyModelBuilt).toBe(true);
  });

  it("category-specific calibration is always infeasible (segment cells too small)", () => {
    const rows = Array.from({ length: 240 }, (_, i) => adj("2025", i % 3 === 0 ? "lost" : "won"));
    const v = evaluateModelFeasibility(rows).verdicts.find((x) => x.model === "response_win_by_category")!;
    expect(v.feasible).toBe(false);
  });

  it("uses the configured gates", () => {
    expect(evaluateModelFeasibility([]).gates).toEqual(DEFAULT_MODEL_GATES);
  });
});
