import { describe, it, expect } from "vitest";
import { fitLogistic, predictProba, sigmoid, brierScore } from "@/lib/intelligence/models/logistic";
import { buildResponseWinModel } from "@/lib/intelligence/models/responseWin";
import type { DisputeRecordRow } from "@/lib/intelligence/report/baseline";

describe("logistic regression core", () => {
  it("sigmoid is stable and monotonic", () => {
    expect(sigmoid(0)).toBeCloseTo(0.5, 6);
    expect(sigmoid(50)).toBeCloseTo(1, 6);
    expect(sigmoid(-50)).toBeCloseTo(0, 6);
  });

  it("learns a separable 1-D boundary", () => {
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 100; i++) { X.push([i < 50 ? 0 : 1]); y.push(i < 50 ? 0 : 1); }
    const m = fitLogistic(X, y, { l2: 0.01, iterations: 2000, lr: 0.5 });
    expect(predictProba(m, [1])).toBeGreaterThan(0.7);
    expect(predictProba(m, [0])).toBeLessThan(0.3);
  });

  it("is deterministic (no RNG)", () => {
    const X = [[0], [1], [0], [1]]; const y = [0, 1, 0, 1];
    const a = fitLogistic(X, y, { iterations: 100 });
    const b = fitLogistic(X, y, { iterations: 100 });
    expect(a.weights).toEqual(b.weights);
  });

  it("brier score rewards accurate probabilities", () => {
    expect(brierScore([1, 0], [1, 0])).toBe(0);
    expect(brierScore([0.5, 0.5], [1, 0])).toBeCloseTo(0.25, 6);
  });
});

function d(year: string, reason: string, outcome: "won" | "lost"): DisputeRecordRow {
  return {
    dispute_id: Math.random().toString(36).slice(2),
    initiated_at: `${year}-06-01T00:00:00Z`, due_at: `${year}-06-15T00:00:00Z`, submitted_at: `${year}-06-10T00:00:00Z`,
    reason, phase: "chargeback", final_outcome: outcome, amount: "100.00", currency_code: "USD",
    outcome_amount_recovered: outcome === "won" ? "100.00" : null, is_adjudicated: true,
  };
}

describe("response-win model — chronological backtest + caveats", () => {
  // FRAUDULENT usually loses, PRODUCT_NOT_RECEIVED usually wins — a learnable signal.
  const rows: DisputeRecordRow[] = [];
  for (const y of ["2023", "2024", "2025", "2026"]) {
    for (let i = 0; i < 40; i++) rows.push(d(y, "FRAUDULENT", i % 5 === 0 ? "won" : "lost"));
    for (let i = 0; i < 40; i++) rows.push(d(y, "PRODUCT_NOT_RECEIVED", i % 5 === 0 ? "lost" : "won"));
  }
  const report = buildResponseWinModel(rows);

  it("runs a chronological (not random) backtest with ≥1 fold", () => {
    expect(report.folds.length).toBeGreaterThanOrEqual(1);
    for (const f of report.folds) expect(f.testYear > f.trainThroughYear).toBe(true);
  });

  it("stamps the selection-bias target population and evidence grade", () => {
    expect(report.targetPopulation).toMatch(/historically contested & adjudicated/);
    expect(report.evidenceGrade).toBe("adjusted_observational");
    expect(report.limitations.join(" ")).toMatch(/selection bias/i);
  });

  it("produces calibration buckets and an overall Brier score", () => {
    expect(report.calibration.length).toBeGreaterThan(0);
    expect(report.overall.brier).toBeGreaterThanOrEqual(0);
    expect(report.overall.brier).toBeLessThan(0.4); // beats a coin-flip on a learnable signal
  });
});
