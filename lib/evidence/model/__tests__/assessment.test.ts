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
 *   strict     → 0 strength changes
 *   permissive → 2 changes, both weak → moderate
 *
 * P-1 (approved 2026-08-06) chose strict and retired the toggle, so permissive
 * is no longer reachable and the second line is history, not a configuration.
 * Re-measured on 73 open ready packs 2026-08-06: identical strict column.
 */

import { describe, it, expect, vi } from "vitest";
import {
  checklistFromModel,
  completenessChecklistFromModel,
  deriveCaseAssessment,
  SCORING_POLICY_VERSION,
} from "../assessment";
import { deriveCaseEvidenceModel } from "../derive";
import { NO_GATES } from "@/tests/helpers/caseStrengthGates";

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

describe("P-1 — a not_applicable record is representable, visible, and unscored", () => {
  it("keeps the record in the model, where the merchant projection reads it", () => {
    // "Contributes nothing to strength" is not "does not exist". The record
    // must survive in `model.fields` with its payload intact — it is still
    // shown to the merchant and may still be cited to the issuer.
    const model = modelFor([THREE_DS, DELIVERY], "PRODUCT_NOT_RECEIVED");
    const tds = model.fields["tds_authentication"];
    expect(tds).toBeDefined();
    expect(tds.relevance).toBe("not_applicable");
    expect(tds.records.length).toBeGreaterThan(0);
  });

  it("omits it from the scoring checklist", () => {
    const model = modelFor([THREE_DS, DELIVERY], "PRODUCT_NOT_RECEIVED");
    const fields = checklistFromModel(model).map((c) => c.field);
    expect(fields).toContain("delivery_proof");
    expect(fields).not.toContain("tds_authentication");
  });

  it("omits it from the completeness denominator too", () => {
    // The denominator is the one place an irrelevant record could still move
    // a number without ever being counted as evidence.
    const model = modelFor([THREE_DS, DELIVERY], "PRODUCT_NOT_RECEIVED");
    const fields = completenessChecklistFromModel(model).map((c) => c.field);
    expect(fields).not.toContain("tds_authentication");
  });

  it("scores identically with and without the irrelevant record present", () => {
    // The whole of P-1 in one assertion: adding a fact the reason does not
    // weigh changes no part of the strength result.
    const withOnlyRelevant = deriveCaseAssessment({
      model: modelFor([DELIVERY], "PRODUCT_NOT_RECEIVED"),
      gates: NO_GATES,
      payloadSource: undefined,
    });
    const withIrrelevantToo = deriveCaseAssessment({
      model: modelFor([DELIVERY, THREE_DS], "PRODUCT_NOT_RECEIVED"),
      gates: NO_GATES,
      payloadSource: undefined,
    });
    expect(withIrrelevantToo.strength).toEqual(withOnlyRelevant.strength);
    expect(withIrrelevantToo.completeness).toEqual(withOnlyRelevant.completeness);
  });

  it("cannot carry a case that has nothing relevant above insufficient", () => {
    // A case whose ONLY evidence is irrelevant scores as if it had none —
    // never Weak → Moderate on an irrelevant fact.
    const model = modelFor([THREE_DS], "PRODUCT_UNACCEPTABLE");
    expect(checklistFromModel(model)).toEqual([]);
    const assessment = deriveCaseAssessment({
      model,
      gates: NO_GATES,
      payloadSource: undefined,
    });
    expect(assessment.strength.overall).toBe("insufficient");
    expect(assessment.strength.strongCount).toBe(0);
    expect(assessment.strength.moderateCount).toBe(0);
    expect(assessment.strength.score).toBe(0);
    expect(assessment.strength.coveragePercent).toBe(0);
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
