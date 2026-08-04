/**
 * P2b — `CaseAssessment` adapter invariants.
 *
 * The adapter must change exactly ONE input to the scorer: the checklist.
 * These tests pin that, because the first version of it changed two — it
 * rebuilt the payload source as a by-field map while `buildPack` uses the
 * `list` form over all sections. `avs_cvv_match` is emitted by two sections,
 * so first-match handed the categorizer the wrong payload and the prod
 * transition matrix reported 56 of 76 packs as stale. That number was
 * produced entirely by the adapter, not by production.
 *
 * Measured on prod 2026-08-04 (npm run analysis:evidence), 76 open ready packs:
 *   strict     (scoreNotApplicable: false) → 0 strength changes
 *   permissive (scoreNotApplicable: true)  → 2 changes, both weak → moderate
 */

import { describe, it, expect, vi } from "vitest";
import {
  checklistFromModel,
  deriveCaseAssessment,
  DEFAULT_SCORING_POLICY,
  SCORING_POLICY_VERSION,
} from "../assessment";
import { deriveCaseEvidenceModel } from "../derive";
import type { CaseStrengthGates } from "@/lib/argument/caseStrength";

const NO_GATES: CaseStrengthGates = {
  coverage: null,
  fatalLoss: null,
  riskWeakness: null,
  nameMismatch: null,
  creditAlreadyIssued: null,
};

/** 3DS is in NO reason template, so it is always `not_applicable`. */
const THREE_DS = {
  source: "shopify_transactions",
  fieldsProvided: ["tds_authentication"],
  data: {
    tdsAuthenticated: true,
    liabilityShift: true,
    tdsVerified: false,
    verifiedSource: "shopify_receipt",
    eci: "02",
  },
};

/** delivery_proof IS in the PRODUCT_NOT_RECEIVED template. */
const DELIVERY = {
  source: "shopify_fulfillments",
  fieldsProvided: ["delivery_proof"],
  data: {
    proofType: "delivered_confirmed",
    deliveredToVerifiedAddress: true,
    deliveredAt: "2026-07-10T19:28:00Z",
    fulfillments: [{ fulfillmentId: "gid://shopify/Fulfillment/1", tracking: [] }],
  },
};

function modelFor(sections: unknown[], reason: string | null) {
  return deriveCaseEvidenceModel({
    disputeId: "d1",
    reason,
    sections: sections as never,
  }).model;
}

describe("the scoring policy is an explicit decision, not a default", () => {
  it("strict omits not_applicable records from the checklist", () => {
    const model = modelFor([THREE_DS, DELIVERY], "PRODUCT_NOT_RECEIVED");
    const fields = checklistFromModel(model, { scoreNotApplicable: false }).map(
      (c) => c.field,
    );
    expect(fields).toContain("delivery_proof");
    expect(fields).not.toContain("tds_authentication");
  });

  it("permissive includes them", () => {
    const model = modelFor([THREE_DS, DELIVERY], "PRODUCT_NOT_RECEIVED");
    const fields = checklistFromModel(model, { scoreNotApplicable: true }).map(
      (c) => c.field,
    );
    expect(fields).toContain("tds_authentication");
  });

  it("defaults to strict — the conservative direction", () => {
    // Making a case stronger files evidence we would otherwise have held, so
    // it must be chosen, never inherited from a default.
    expect(DEFAULT_SCORING_POLICY.scoreNotApplicable).toBe(false);
    const model = modelFor([THREE_DS], "PRODUCT_UNACCEPTABLE");
    expect(checklistFromModel(model)).toEqual([]);
  });
});

describe("the adapter changes ONLY the checklist", () => {
  it("passes payloadSource through untouched", async () => {
    const caseStrength = await import("@/lib/argument/caseStrength");
    const spy = vi.spyOn(caseStrength, "calculateCaseStrength");
    const payloadSource = {
      kind: "list" as const,
      items: [{ payload: { fieldsProvided: ["delivery_proof"], proofType: "x" } }],
    };
    const model = modelFor([DELIVERY], "PRODUCT_NOT_RECEIVED");

    deriveCaseAssessment({ model, gates: NO_GATES, payloadSource });

    expect(spy).toHaveBeenCalledTimes(1);
    // Same object identity — not rebuilt, not re-keyed.
    expect(spy.mock.calls[0][2]).toBe(payloadSource);
    expect(spy.mock.calls[0][3]).toBe(NO_GATES);
    expect(spy.mock.calls[0][1]).toBe("PRODUCT_NOT_RECEIVED");
    spy.mockRestore();
  });

  it("omits fields with no records rather than emitting empty rows", () => {
    // An empty row would move `coveragePercent` (it divides by registered
    // items) without moving `overall` — a silent fleet-wide number change
    // smuggled inside a scoring migration.
    const model = modelFor([DELIVERY], "PRODUCT_NOT_RECEIVED");
    const fields = checklistFromModel(model).map((c) => c.field);
    expect(fields).toEqual(["delivery_proof"]);
    expect(fields).not.toContain("refund_record");
  });

  it("emits no English label — lib/** may not, and the scorer never reads it", () => {
    const model = modelFor([DELIVERY], "PRODUCT_NOT_RECEIVED");
    expect(checklistFromModel(model)[0].label).toBe("");
  });
});

describe("the assessment records the policy it was computed under", () => {
  it("carries scoringPolicyVersion and the model it read", () => {
    const model = modelFor([DELIVERY], "PRODUCT_NOT_RECEIVED");
    const assessment = deriveCaseAssessment({
      model,
      gates: NO_GATES,
      payloadSource: undefined,
    });
    expect(assessment.scoringPolicyVersion).toBe(SCORING_POLICY_VERSION);
    expect(assessment.modelVersion).toBe(model.modelVersion);
    expect(assessment.sectionsHash).toBe(model.derivedFrom.sectionsHash);
    // Changing a threshold must never look like a change to what evidence
    // exists — the versions are independent by construction.
    expect(assessment.strength.overall).toBeTruthy();
  });
});
