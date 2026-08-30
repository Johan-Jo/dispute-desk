import { describe, expect, it } from "vitest";
import { evaluateCheckpoints } from "../checkpoints";
import type { CheckpointInput } from "../checkpoints.types";

// A baseline input where every rule emits its healthiest/quietest
// observation — used as a starting point each test mutates.
const baseline: CheckpointInput = {
  chargebackRate90d: 0.4,
  chargebackCount90d: 30,
  fraudDisputeRatePct: 0.3,
  fulfilledHighRiskPct: 20,
  threeDsAuthRatePct: 40,
  signedForRatePct: 50,
  shopifyProtectCoveragePct: 40,
  medianFulfillmentHoursCurrent: 18,
  medianFulfillmentHoursPrior: 18,
};

describe("evaluateCheckpoints — VAMP rule", () => {
  it("emits healthy below 0.9%", () => {
    const r = evaluateCheckpoints(baseline);
    const v = r.find((c) => c.id === "chargeback_rate_vs_vamp");
    expect(v?.severity).toBe("healthy");
  });

  it("emits consider at 0.9% (approaching)", () => {
    const r = evaluateCheckpoints({
      ...baseline,
      chargebackRate90d: 0.9,
      chargebackCount90d: 30,
    });
    const v = r.find((c) => c.id === "chargeback_rate_vs_vamp");
    expect(v?.severity).toBe("consider");
  });

  it("emits breach at 1.5% (VAMP Excessive)", () => {
    const r = evaluateCheckpoints({
      ...baseline,
      chargebackRate90d: 1.5,
      chargebackCount90d: 30,
    });
    const v = r.find((c) => c.id === "chargeback_rate_vs_vamp");
    expect(v?.severity).toBe("breach");
  });

  it("returns null when chargeback rate unknown", () => {
    const r = evaluateCheckpoints({
      ...baseline,
      chargebackRate90d: null,
    });
    expect(r.find((c) => c.id === "chargeback_rate_vs_vamp")).toBeUndefined();
  });
});

describe("evaluateCheckpoints — Mastercard ECM rule", () => {
  it("breach requires BOTH ratio ≥ 1.5% AND ≥100/month", () => {
    // Ratio breach but count below 100/month → consider, not breach
    const r1 = evaluateCheckpoints({
      ...baseline,
      chargebackRate90d: 1.6,
      chargebackCount90d: 30, // 10/month
    });
    expect(
      r1.find((c) => c.id === "chargeback_rate_vs_ecm")?.severity,
    ).toBe("consider");

    // Both breached → breach
    const r2 = evaluateCheckpoints({
      ...baseline,
      chargebackRate90d: 1.6,
      chargebackCount90d: 400, // ≈133/month
    });
    expect(r2.find((c) => c.id === "chargeback_rate_vs_ecm")?.severity).toBe(
      "breach",
    );
  });

  // Regression: the input is a DISPUTE count, never an order count.
  // The in-app page used to pass the 90d order denominator here, so a
  // merchant with 14,635 orders and 300 chargebacks was told they average
  // ~4,878 chargebacks/month against a true ~100 — a 49x overstatement, on
  // the one number where precision decides the verdict (ECM's floor is
  // exactly 100/month). Pinning the rendered value is what catches a
  // future caller re-crossing the two.
  it("reports monthlyEstimate from the dispute count, not the order count", () => {
    const r = evaluateCheckpoints({
      ...baseline,
      chargebackRate90d: 2.05, // 300 / 14,635
      chargebackCount90d: 300, // NOT 14_635
    });
    const ecm = r.find((c) => c.id === "chargeback_rate_vs_ecm");
    expect(ecm?.values.monthlyEstimate).toBe(100);
    // An order count in this slot would read 4,878 and flip the verdict
    // to breach on volume the merchant does not have.
    expect(ecm?.values.monthlyEstimate).not.toBe(4878);
  });

  it("does not breach on volume when the true dispute count is below the ECM floor", () => {
    const r = evaluateCheckpoints({
      ...baseline,
      chargebackRate90d: 1.6, // ratio is breached
      chargebackCount90d: 297, // 99/month — just under the 100 floor
    });
    expect(r.find((c) => c.id === "chargeback_rate_vs_ecm")?.severity).toBe(
      "consider",
    );
  });
});

describe("evaluateCheckpoints — high-risk-fulfilled rule", () => {
  it("does not emit below 50%", () => {
    const r = evaluateCheckpoints({ ...baseline, fulfilledHighRiskPct: 49 });
    expect(r.find((c) => c.id === "high_risk_fulfilled")).toBeUndefined();
  });

  it("emits consider at 50% and above", () => {
    const r = evaluateCheckpoints({ ...baseline, fulfilledHighRiskPct: 65 });
    expect(r.find((c) => c.id === "high_risk_fulfilled")?.severity).toBe(
      "consider",
    );
  });
});

describe("evaluateCheckpoints — signature-capture rule", () => {
  it("does not emit at or above 30%", () => {
    const r = evaluateCheckpoints({ ...baseline, signedForRatePct: 35 });
    expect(r.find((c) => c.id === "signature_capture_low")).toBeUndefined();
  });

  it("emits consider below 30%", () => {
    const r = evaluateCheckpoints({ ...baseline, signedForRatePct: 21 });
    expect(r.find((c) => c.id === "signature_capture_low")?.severity).toBe(
      "consider",
    );
  });
});

describe("evaluateCheckpoints — 3-DS auth rule", () => {
  it("healthy at or above 25%", () => {
    expect(
      evaluateCheckpoints({ ...baseline, threeDsAuthRatePct: 38 }).find(
        (c) => c.id === "threeds_auth",
      )?.severity,
    ).toBe("healthy");
  });

  it("info in the 10–25% middle band", () => {
    expect(
      evaluateCheckpoints({ ...baseline, threeDsAuthRatePct: 15 }).find(
        (c) => c.id === "threeds_auth",
      )?.severity,
    ).toBe("info");
  });

  it("consider below 10%", () => {
    expect(
      evaluateCheckpoints({ ...baseline, threeDsAuthRatePct: 5 }).find(
        (c) => c.id === "threeds_auth",
      )?.severity,
    ).toBe("consider");
  });
});

describe("evaluateCheckpoints — fulfillment baseline rule", () => {
  it("emits degraded when current is 12+ hours slower than prior", () => {
    const r = evaluateCheckpoints({
      ...baseline,
      medianFulfillmentHoursCurrent: 32,
      medianFulfillmentHoursPrior: 18,
    });
    expect(
      r.find((c) => c.id === "fulfillment_baseline_degraded")?.severity,
    ).toBe("consider");
  });

  it("emits improved when current is 6+ hours faster than prior", () => {
    const r = evaluateCheckpoints({
      ...baseline,
      medianFulfillmentHoursCurrent: 10,
      medianFulfillmentHoursPrior: 18,
    });
    expect(
      r.find((c) => c.id === "fulfillment_baseline_improved")?.severity,
    ).toBe("healthy");
  });

  it("does not emit for small drifts", () => {
    const r = evaluateCheckpoints({
      ...baseline,
      medianFulfillmentHoursCurrent: 19,
      medianFulfillmentHoursPrior: 18,
    });
    expect(
      r.find((c) => c.id?.startsWith("fulfillment_baseline_")),
    ).toBeUndefined();
  });
});

describe("evaluateCheckpoints — sort + cap", () => {
  it("sorts most-urgent severity first", () => {
    const r = evaluateCheckpoints({
      ...baseline,
      chargebackRate90d: 1.6,
      chargebackCount90d: 400, // VAMP breach + ECM breach
      fulfilledHighRiskPct: 70,  // consider
      signedForRatePct: 10,      // consider
      threeDsAuthRatePct: 38,    // healthy
    });
    expect(r[0]?.severity).toBe("breach");
    // No "consider" entry may precede a "breach" entry.
    const firstHealthyIdx = r.findIndex((c) => c.severity === "healthy");
    const lastBreachIdx = r.map((c) => c.severity).lastIndexOf("breach");
    if (firstHealthyIdx >= 0 && lastBreachIdx >= 0) {
      expect(firstHealthyIdx).toBeGreaterThan(lastBreachIdx);
    }
  });

  it("caps at 5 visible by default", () => {
    const r = evaluateCheckpoints({
      ...baseline,
      chargebackRate90d: 1.6,
      chargebackCount90d: 400,
      fulfilledHighRiskPct: 70,
      signedForRatePct: 10,
      threeDsAuthRatePct: 5,
      shopifyProtectCoveragePct: 5,
      medianFulfillmentHoursCurrent: 36,
      medianFulfillmentHoursPrior: 18,
    });
    expect(r.length).toBeLessThanOrEqual(5);
  });

  it("respects custom limit", () => {
    const r = evaluateCheckpoints(baseline, 2);
    expect(r.length).toBeLessThanOrEqual(2);
  });
});

describe("evaluateCheckpoints — surasvenne current-state sanity", () => {
  it("produces a stable mix for realistic dev-shop data", () => {
    const r = evaluateCheckpoints({
      chargebackRate90d: 0.7,
      chargebackCount90d: 18,
      fraudDisputeRatePct: 3.0,
      fulfilledHighRiskPct: 64,
      threeDsAuthRatePct: 38,
      signedForRatePct: 21,
      shopifyProtectCoveragePct: 12,
      medianFulfillmentHoursCurrent: 20,
      medianFulfillmentHoursPrior: 22,
    });
    expect(r.length).toBeGreaterThan(0);
    expect(r.length).toBeLessThanOrEqual(5);
    // Should never emit a breach for these numbers.
    expect(r.find((c) => c.severity === "breach")).toBeUndefined();
  });
});
