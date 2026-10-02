import { describe, expect, it } from "vitest";
import { evaluateCheckpoints } from "../checkpoints";
import type { CheckpointInput, ProgrammeCheckpointInput } from "../checkpoints.types";

/** blume-box, September 2026 (prod, 2026-10-02): 4 card chargebacks on
 *  2,686 card settled orders, 2 Visa, 2 Mastercard. */
const sep: ProgrammeCheckpointInput = {
  periodMonth: "2026-09-01",
  cardDisputeRatio: 0.00149,
  visaChargebackCount: 2,
  mcChargebackCount: 2,
  ecmRatio: 0.00061,
  ecmIsLowerBound: true,
  cardFramingApplies: true,
  cardDisputeShare: 1,
};

// A baseline input where every rule emits its healthiest/quietest
// observation — used as a starting point each test mutates.
const baseline: CheckpointInput = {
  programme: sep,
  fraudDisputeRatePct: 0.3,
  fulfilledHighRiskPct: 20,
  threeDsAuthRatePct: 40,
  signedForRatePct: 50,
  shopifyProtectCoveragePct: 40,
  medianFulfillmentHoursCurrent: 18,
  medianFulfillmentHoursPrior: 18,
};

const find = (input: CheckpointInput, id: string) =>
  evaluateCheckpoints(input, 10).find((c) => c.id === id);
const withProgramme = (p: Partial<ProgrammeCheckpointInput>): CheckpointInput => ({
  ...baseline,
  programme: { ...sep, ...p },
});

describe("evaluateCheckpoints — VAMP rule (one calendar month)", () => {
  it("emits healthy below the 0.9% early-warning level, citing the month", () => {
    const v = find(baseline, "chargeback_rate_vs_vamp");
    expect(v?.severity).toBe("healthy");
    expect(v?.values.current).toBe("0.15%");
    expect(v?.values.month).toBe("2026-09-01");
  });

  // blume-box July 2026: a fraud wave, 75 card chargebacks (2.37%) but only
  // 2 on Visa — far below the 1,500/month floor. Visa cannot enforce VAMP
  // on it, so it is never a breach.
  it("emits info (above the ratio, below the floor) when the Visa count is under 1,500", () => {
    const v = find(withProgramme({ cardDisputeRatio: 0.02369, visaChargebackCount: 2 }), "chargeback_rate_vs_vamp");
    expect(v?.severity).toBe("info");
    expect(v?.titleKey).toContain("_below_floor_");
    expect(v?.values.vampFloor).toBe(1500);
  });

  it("emits consider between 0.9% and 1.5% once the floor is met", () => {
    const v = find(withProgramme({ cardDisputeRatio: 0.012, visaChargebackCount: 1600 }), "chargeback_rate_vs_vamp");
    expect(v?.severity).toBe("consider");
  });

  it("emits breach at 1.5% once the floor is met", () => {
    const v = find(withProgramme({ cardDisputeRatio: 0.015, visaChargebackCount: 1600 }), "chargeback_rate_vs_vamp");
    expect(v?.severity).toBe("breach");
  });

  it("returns nothing when the month has too few orders to measure", () => {
    expect(find(withProgramme({ cardDisputeRatio: null }), "chargeback_rate_vs_vamp")).toBeUndefined();
  });

  // The defect class this replaces: a verdict from a rolling window, or from
  // disputes counted by when we inserted them (blume-box "5.31%, breach").
  it("emits NO VAMP/ECM checkpoint without a programme block", () => {
    const input: CheckpointInput = { ...baseline, programme: undefined };
    expect(find(input, "chargeback_rate_vs_vamp")).toBeUndefined();
    expect(find(input, "chargeback_rate_vs_ecm")).toBeUndefined();
  });
});

describe("evaluateCheckpoints — Mastercard ECM rule (one calendar month)", () => {
  it("emits healthy below 1.5% with the real monthly count", () => {
    const e = find(baseline, "chargeback_rate_vs_ecm");
    expect(e?.severity).toBe("healthy");
    expect(e?.values.mcCount).toBe(2);
  });

  it("emits info above 1.5% while under 100 Mastercard chargebacks", () => {
    const e = find(withProgramme({ ecmRatio: 0.0513, mcChargebackCount: 71 }), "chargeback_rate_vs_ecm");
    expect(e?.severity).toBe("info");
    expect(e?.titleKey).toContain("_below_floor_");
  });

  it("emits breach when both criteria are met", () => {
    const e = find(withProgramme({ ecmRatio: 0.016, mcChargebackCount: 120 }), "chargeback_rate_vs_ecm");
    expect(e?.severity).toBe("breach");
  });

  it("emits at least consider at 120 Mastercard chargebacks while the denominator is a lower bound", () => {
    const e = find(withProgramme({ ecmRatio: 0.008, mcChargebackCount: 120, ecmIsLowerBound: true }), "chargeback_rate_vs_ecm");
    expect(e?.severity).toBe("consider");
  });

  it("is healthy below the ratio with a true Mastercard denominator", () => {
    const e = find(withProgramme({ ecmRatio: 0.008, mcChargebackCount: 120, ecmIsLowerBound: false }), "chargeback_rate_vs_ecm");
    expect(e?.severity).toBe("healthy");
  });
});

describe("evaluateCheckpoints — card programmes only apply to card disputes", () => {
  // cay-collective is 100% Klarna and Mein Maison mostly PayPal. Neither is
  // measured by Visa or Mastercard; `healthy` would be as wrong as `breach`.
  const klarnaShop = withProgramme({ cardFramingApplies: false, cardDisputeShare: 0 });

  it("emits a not-applicable observation instead of a VAMP verdict", () => {
    const vamp = find(klarnaShop, "chargeback_rate_vs_vamp");
    expect(vamp?.severity).toBe("info");
    expect(vamp?.titleKey).toContain("not_applicable");
  });

  it("emits a not-applicable observation instead of an ECM verdict", () => {
    const ecm = find(klarnaShop, "chargeback_rate_vs_ecm");
    expect(ecm?.severity).toBe("info");
    expect(ecm?.titleKey).toContain("not_applicable");
  });
});

describe("evaluateCheckpoints — high-risk-fulfilled rule", () => {
  it("does not emit below 50%", () => {
    expect(find({ ...baseline, fulfilledHighRiskPct: 49 }, "high_risk_fulfilled")).toBeUndefined();
  });

  it("emits consider at 50% and above", () => {
    expect(find({ ...baseline, fulfilledHighRiskPct: 65 }, "high_risk_fulfilled")?.severity).toBe("consider");
  });
});

describe("evaluateCheckpoints — signature-capture rule", () => {
  it("does not emit at or above 30%", () => {
    expect(find({ ...baseline, signedForRatePct: 35 }, "signature_capture_low")).toBeUndefined();
  });

  it("emits consider below 30%", () => {
    expect(find({ ...baseline, signedForRatePct: 21 }, "signature_capture_low")?.severity).toBe("consider");
  });
});

describe("evaluateCheckpoints — 3-DS auth rule", () => {
  it("healthy at or above 25%", () => {
    expect(find({ ...baseline, threeDsAuthRatePct: 38 }, "threeds_auth")?.severity).toBe("healthy");
  });

  it("info in the 10–25% middle band", () => {
    expect(find({ ...baseline, threeDsAuthRatePct: 15 }, "threeds_auth")?.severity).toBe("info");
  });

  it("consider below 10%", () => {
    expect(find({ ...baseline, threeDsAuthRatePct: 5 }, "threeds_auth")?.severity).toBe("consider");
  });
});

describe("evaluateCheckpoints — fulfillment baseline rule", () => {
  it("emits degraded when current is 12+ hours slower than prior", () => {
    const r = { ...baseline, medianFulfillmentHoursCurrent: 32, medianFulfillmentHoursPrior: 18 };
    expect(find(r, "fulfillment_baseline_degraded")?.severity).toBe("consider");
  });

  it("emits improved when current is 6+ hours faster than prior", () => {
    const r = { ...baseline, medianFulfillmentHoursCurrent: 10, medianFulfillmentHoursPrior: 18 };
    expect(find(r, "fulfillment_baseline_improved")?.severity).toBe("healthy");
  });

  it("does not emit for small drifts", () => {
    const r = evaluateCheckpoints({ ...baseline, medianFulfillmentHoursCurrent: 19, medianFulfillmentHoursPrior: 18 });
    expect(r.find((c) => c.id?.startsWith("fulfillment_baseline_"))).toBeUndefined();
  });
});

describe("evaluateCheckpoints — sort + cap", () => {
  const busy: CheckpointInput = {
    ...withProgramme({ cardDisputeRatio: 0.016, visaChargebackCount: 1600, ecmRatio: 0.016, mcChargebackCount: 120 }),
    fulfilledHighRiskPct: 70,
    signedForRatePct: 10,
    threeDsAuthRatePct: 5,
    shopifyProtectCoveragePct: 5,
    medianFulfillmentHoursCurrent: 36,
    medianFulfillmentHoursPrior: 18,
  };

  it("sorts most-urgent severity first", () => {
    const r = evaluateCheckpoints(busy);
    expect(r[0]?.severity).toBe("breach");
    const firstHealthyIdx = r.findIndex((c) => c.severity === "healthy");
    const lastBreachIdx = r.map((c) => c.severity).lastIndexOf("breach");
    if (firstHealthyIdx >= 0 && lastBreachIdx >= 0) {
      expect(firstHealthyIdx).toBeGreaterThan(lastBreachIdx);
    }
  });

  it("caps at 5 visible by default", () => {
    expect(evaluateCheckpoints(busy).length).toBeLessThanOrEqual(5);
  });

  it("respects custom limit", () => {
    expect(evaluateCheckpoints(baseline, 2).length).toBeLessThanOrEqual(2);
  });
});
