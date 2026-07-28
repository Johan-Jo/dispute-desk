/**
 * Exhaustive coverage of the ONE auto-submit decision shared by
 * lib/automation/pipeline.ts, lib/jobs/handlers/buildDefencePackageJob.ts
 * and lib/automation/reconcileParkedAutoDisputes.ts.
 *
 * Before this function existed the job BLOCKED on Moderate while the
 * pipeline PARKED on it. These tests pin the canonical semantics so the
 * three callers can never drift apart again.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateAutoSubmitGuards,
  type AutoSubmitGuardInput,
} from "../autoSubmitGuards";

/** A Strong, non-product, uncovered, winnable case — the only "proceed". */
function baseInput(overrides: Partial<AutoSubmitGuardInput> = {}): AutoSubmitGuardInput {
  return {
    coverageState: "not_covered",
    fatalLoss: { triggered: false, reason: null },
    caseStrength: "strong",
    disputeReason: "FRAUDULENT",
    ...overrides,
  };
}

describe("evaluateAutoSubmitGuards — proceed", () => {
  it("Strong non-product case proceeds", () => {
    expect(evaluateAutoSubmitGuards(baseInput())).toEqual({ decision: "proceed" });
  });

  it("Strong delivery (PRODUCT_NOT_RECEIVED) proceeds — 'delivery' is not the product family", () => {
    // Guards against a naive substring match on "PRODUCT_".
    const v = evaluateAutoSubmitGuards(
      baseInput({ disputeReason: "PRODUCT_NOT_RECEIVED" }),
    );
    expect(v.decision).toBe("proceed");
  });

  it("legacy pack with null case_strength proceeds (pre-scoring behaviour preserved)", () => {
    expect(evaluateAutoSubmitGuards(baseInput({ caseStrength: null }))).toEqual({
      decision: "proceed",
    });
  });

  it("undefined case_strength is treated the same as null", () => {
    expect(
      evaluateAutoSubmitGuards(baseInput({ caseStrength: undefined })),
    ).toEqual({ decision: "proceed" });
  });

  it("absent fatal_loss object proceeds — absence is never a negative signal", () => {
    expect(evaluateAutoSubmitGuards(baseInput({ fatalLoss: null }))).toEqual({
      decision: "proceed",
    });
    expect(evaluateAutoSubmitGuards(baseInput({ fatalLoss: undefined }))).toEqual({
      decision: "proceed",
    });
  });
});

describe("evaluateAutoSubmitGuards — block", () => {
  it("Shopify Protect coverage blocks", () => {
    const v = evaluateAutoSubmitGuards(baseInput({ coverageState: "covered_shopify" }));
    expect(v).toMatchObject({ decision: "block", reason: "covered_shopify" });
  });

  it("fatal loss blocks and surfaces the engine's message when present", () => {
    const v = evaluateAutoSubmitGuards(
      baseInput({
        fatalLoss: {
          triggered: true,
          reason: "refund_issued",
          message: "Already refunded in full",
        },
      }),
    );
    expect(v).toMatchObject({ decision: "block", reason: "fatal_loss" });
    expect(v.decision === "block" && v.message).toBe("Already refunded in full");
  });

  it("fatal loss without a message falls back to a PRD-cited reason", () => {
    const v = evaluateAutoSubmitGuards(
      baseInput({ fatalLoss: { triggered: true, reason: "inr_no_fulfillment" } }),
    );
    expect(v.decision).toBe("block");
    expect(v.decision === "block" && v.message).toContain("inr_no_fulfillment");
  });

  it("weak blocks", () => {
    expect(evaluateAutoSubmitGuards(baseInput({ caseStrength: "weak" }))).toMatchObject({
      decision: "block",
      reason: "weak",
    });
  });

  it("insufficient blocks", () => {
    expect(
      evaluateAutoSubmitGuards(baseInput({ caseStrength: "insufficient" })),
    ).toMatchObject({ decision: "block", reason: "insufficient" });
  });

  it("fatal_loss.triggered must be exactly true — a falsy/absent flag never blocks", () => {
    const v = evaluateAutoSubmitGuards(
      baseInput({ fatalLoss: { triggered: false, reason: "refund_issued" } }),
    );
    expect(v.decision).toBe("proceed");
  });
});

describe("evaluateAutoSubmitGuards — park", () => {
  it("Moderate PARKS, it does not block (the canonical semantics)", () => {
    const v = evaluateAutoSubmitGuards(baseInput({ caseStrength: "moderate" }));
    expect(v).toMatchObject({ decision: "park", reason: "moderate_strength" });
  });

  it("product-family Strong parks (subjective merchandise claim)", () => {
    const v = evaluateAutoSubmitGuards(
      baseInput({ caseStrength: "strong", disputeReason: "PRODUCT_UNACCEPTABLE" }),
    );
    expect(v).toMatchObject({ decision: "park", reason: "product_family_strong" });
  });

  it("product-family Moderate reports moderate_strength, not product_family_strong", () => {
    // Strength is evaluated before the product-family park, so a Moderate
    // product case is attributed to its strength — the more actionable cause.
    const v = evaluateAutoSubmitGuards(
      baseInput({ caseStrength: "moderate", disputeReason: "PRODUCT_UNACCEPTABLE" }),
    );
    expect(v).toMatchObject({ decision: "park", reason: "moderate_strength" });
  });

  it("product-family with null strength still proceeds (never scored)", () => {
    const v = evaluateAutoSubmitGuards(
      baseInput({ caseStrength: null, disputeReason: "PRODUCT_UNACCEPTABLE" }),
    );
    expect(v.decision).toBe("proceed");
  });
});

describe("evaluateAutoSubmitGuards — precedence", () => {
  it("coverage beats fatal loss", () => {
    const v = evaluateAutoSubmitGuards(
      baseInput({
        coverageState: "covered_shopify",
        fatalLoss: { triggered: true, reason: "refund_issued" },
      }),
    );
    expect(v).toMatchObject({ decision: "block", reason: "covered_shopify" });
  });

  it("coverage beats weak strength", () => {
    const v = evaluateAutoSubmitGuards(
      baseInput({ coverageState: "covered_shopify", caseStrength: "weak" }),
    );
    expect(v).toMatchObject({ decision: "block", reason: "covered_shopify" });
  });

  it("fatal loss beats weak strength", () => {
    const v = evaluateAutoSubmitGuards(
      baseInput({
        fatalLoss: { triggered: true, reason: "refund_issued" },
        caseStrength: "weak",
      }),
    );
    expect(v).toMatchObject({ decision: "block", reason: "fatal_loss" });
  });

  it("fatal loss beats the product-family park", () => {
    const v = evaluateAutoSubmitGuards(
      baseInput({
        fatalLoss: { triggered: true, reason: "refund_issued" },
        disputeReason: "PRODUCT_UNACCEPTABLE",
      }),
    );
    expect(v).toMatchObject({ decision: "block", reason: "fatal_loss" });
  });
});

describe("evaluateAutoSubmitGuards — purity", () => {
  it("does not mutate its input", () => {
    const input = baseInput({ caseStrength: "moderate" });
    const snapshot = JSON.parse(JSON.stringify(input));
    evaluateAutoSubmitGuards(input);
    expect(input).toEqual(snapshot);
  });

  it("is deterministic across repeated calls", () => {
    const input = baseInput({ caseStrength: "moderate" });
    expect(evaluateAutoSubmitGuards(input)).toEqual(evaluateAutoSubmitGuards(input));
  });
});
