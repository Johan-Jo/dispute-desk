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

/** A Strong, uncovered, winnable case — the only "proceed". */
function baseInput(overrides: Partial<AutoSubmitGuardInput> = {}): AutoSubmitGuardInput {
  return {
    coverageState: "not_covered",
    fatalLoss: { triggered: false, reason: null },
    returnedToSender: null,
    caseStrength: "strong",
    // Required as of 2026-08-04 (P5): every caller states every gate, so a
    // path can no longer omit one and reach a different verdict reason.
    creditAlreadyIssued: null,
    ...overrides,
  };
}

describe("evaluateAutoSubmitGuards — proceed", () => {
  it("Strong case proceeds, whatever the dispute reason", () => {
    // The guard is reason-blind as of 2026-07-30 — see the removed-park block
    // at the bottom of this file.
    expect(evaluateAutoSubmitGuards(baseInput())).toEqual({ decision: "proceed" });
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

  it("product-family Moderate parks on its strength, like every other family", () => {
    const v = evaluateAutoSubmitGuards(baseInput({ caseStrength: "moderate" }));
    expect(v).toMatchObject({ decision: "park", reason: "moderate_strength" });
  });
});

describe("evaluateAutoSubmitGuards — the removed product-family park", () => {
  // Removed 2026-07-30. The guard used to park "not as described" cases even
  // at Strong, on the theory the merchant might know the item genuinely WAS
  // defective. Three facts killed it: Shopify files its own scraped evidence
  // when we file none (so parking swapped our pack for a worse one, it did not
  // withhold a rebuttal); VDMP/VAMP score disputes RECEIVED so there is no
  // penalty for losing a representment; and we ship no way to edit the
  // narrative, so the merchant could not act on that context anyway.
  //
  // These cases exist so a reintroduction has to delete an explicit statement
  // of intent rather than quietly flip an assertion.

  it("does not park on strength alone — the input no longer carries a reason", () => {
    // `disputeReason` was dropped from AutoSubmitGuardInput with the park. If
    // it comes back, this test is where to justify it.
    const v = evaluateAutoSubmitGuards(baseInput({ caseStrength: "strong" }));
    expect(v).toEqual({ decision: "proceed" });
  });

  it("no verdict reason mentions the product family", () => {
    const verdicts = (
      ["strong", "moderate", "weak", "insufficient", null] as const
    ).map((s) => evaluateAutoSubmitGuards(baseInput({ caseStrength: s })));
    for (const v of verdicts) {
      if (v.decision !== "proceed") {
        expect(v.reason).not.toMatch(/product/);
      }
    }
  });
});

describe("evaluateAutoSubmitGuards — precedence", () => {
  it("coverage beats fatal loss", () => {
    const v = evaluateAutoSubmitGuards(
      baseInput({
        coverageState: "covered_shopify",
        fatalLoss: { triggered: true, reason: "refund_issued" },
        returnedToSender: null,
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
        returnedToSender: null,
        caseStrength: "weak",
      }),
    );
    expect(v).toMatchObject({ decision: "block", reason: "fatal_loss" });
  });

  it("fatal loss beats a Strong score", () => {
    const v = evaluateAutoSubmitGuards(
      baseInput({
        fatalLoss: { triggered: true, reason: "refund_issued" },
        returnedToSender: null,
        caseStrength: "strong",
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
