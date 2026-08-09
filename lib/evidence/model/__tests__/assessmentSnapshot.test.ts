/**
 * CP-A — `CaseAssessmentSnapshot`, and the input hash that makes it safe.
 *
 * THE PROPERTY UNDER TEST is stated once and asserted many times: changing
 * ANY result-bearing input changes `freshness.inputHash`, and changing an
 * input that cannot move the result does NOT change it.
 *
 * Both directions matter. A hash that misses an input lets a snapshot built
 * from replaced evidence present itself as current — the failure that puts a
 * false assertion in front of an issuer. A hash that over-covers reports the
 * whole fleet stale on every rebuild, which is not "safe": a permanently
 * stale fleet never files anything, and the pressure to add a grandfathering
 * escape hatch starts the next day.
 *
 * The brief asks for at least three distinct inputs. Eight are exercised
 * below, because the three that come to mind first (status, reason, gate) are
 * the ones a naive hash already covers; the interesting ones are payload and
 * the provided/not-provided distinction.
 */

import { describe, it, expect } from "vitest";
import {
  ASSESSMENT_POLICY_VERSION,
  ASSESSMENT_VERSION,
  buildCaseAssessmentSnapshot,
  computeAssessmentInputHash,
  isGateDecided,
} from "../assessmentSnapshot";
import { deriveCaseEvidenceModel } from "../derive";
import type { CaseEvidenceModel } from "../types";
import type { EvidencePayloadSource } from "@/lib/argument/caseStrength";
import {
  buildCaseGateAssessment,
  gateNotProvided,
  gateProvided,
  type CaseGateSources,
} from "@/lib/argument/caseGateAssessment";
import { NO_GATES, gatesWith } from "@/tests/helpers/caseStrengthGates";
import { evaluateFreshness } from "@/lib/pipeline/contracts";

const NOW = "2026-08-09T00:00:00.000Z";

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

const ORDER = {
  source: "shopify_order",
  fieldsProvided: ["order_confirmation"],
  data: { orderName: "#1001", orderId: "gid://shopify/Order/1" },
};

function modelFor(
  sections: unknown[],
  reason: string | null,
  disputeId = "d1",
): CaseEvidenceModel {
  return deriveCaseEvidenceModel({
    disputeId,
    reason,
    sections: sections as never,
  }).model;
}

const BASE_SECTIONS = [ORDER, DELIVERY];

function hashOf(
  model: CaseEvidenceModel,
  gates = NO_GATES,
  payloadSource: EvidencePayloadSource | undefined = undefined,
) {
  return computeAssessmentInputHash({ model, gates, payloadSource });
}

describe("CaseAssessmentSnapshot — shape", () => {
  it("carries the contract fields, a real freshness, and a policy version", () => {
    const snap = buildCaseAssessmentSnapshot({
      caseId: "d1",
      model: modelFor(BASE_SECTIONS, "PRODUCT_NOT_RECEIVED"),
      gates: NO_GATES,
      payloadSource: undefined,
      now: NOW,
    });

    expect(snap.caseId).toBe("d1");
    expect(snap.assessmentVersion).toBe(ASSESSMENT_VERSION);
    expect(snap.freshness.policyVersion).toBe(ASSESSMENT_POLICY_VERSION);
    expect(snap.freshness.computedAt).toBe(NOW);
    expect(snap.freshness.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(snap.strength.overall).toBeDefined();
    expect(typeof snap.completeness.score).toBe("number");
  });

  it("is time-invariant — `computedAt` never reaches the hash", () => {
    // `computedAt` is audit-only by contract. If it leaked into the hash,
    // every snapshot would be stale against its own successor and the
    // freshness predicate would degenerate into "recompute always".
    const model = modelFor(BASE_SECTIONS, "PRODUCT_NOT_RECEIVED");
    const a = buildCaseAssessmentSnapshot({
      caseId: "d1", model, gates: NO_GATES, payloadSource: undefined, now: NOW,
    });
    const b = buildCaseAssessmentSnapshot({
      caseId: "d1", model, gates: NO_GATES, payloadSource: undefined,
      now: "2027-01-01T00:00:00.000Z",
    });
    expect(b.freshness.inputHash).toBe(a.freshness.inputHash);
    expect(b.freshness.computedAt).not.toBe(a.freshness.computedAt);
  });

  it("round-trips through `evaluateFreshness` as fresh against its own inputs", () => {
    const model = modelFor(BASE_SECTIONS, "PRODUCT_NOT_RECEIVED");
    const snap = buildCaseAssessmentSnapshot({
      caseId: "d1", model, gates: NO_GATES, payloadSource: undefined, now: NOW,
    });
    expect(
      evaluateFreshness({
        snapshot: snap.freshness,
        currentInputHash: hashOf(model),
        currentPolicyVersion: ASSESSMENT_POLICY_VERSION,
      }),
    ).toEqual({ fresh: true });
  });
});

describe("input hash — every result-bearing input moves it", () => {
  const baseModel = modelFor(BASE_SECTIONS, "PRODUCT_NOT_RECEIVED");
  const base = hashOf(baseModel);

  it("guard the guard — the baseline hash is stable across repeated calls", () => {
    // Every assertion below is `!==` against `base`. If the hash were
    // nondeterministic (an unsorted key walk, a Set iteration, a Date), all
    // of them would pass vacuously and this suite would prove nothing.
    expect(hashOf(modelFor(BASE_SECTIONS, "PRODUCT_NOT_RECEIVED"))).toBe(base);
    expect(hashOf(modelFor([DELIVERY, ORDER], "PRODUCT_NOT_RECEIVED"))).toBe(base);
  });

  it("1. the dispute reason", () => {
    // The reason picks the template AND the reason family, so it moves
    // relevance, the checklist row set and the family scoring rules at once.
    expect(hashOf(modelFor(BASE_SECTIONS, "FRAUDULENT"))).not.toBe(base);
  });

  it("2. evidence presence — a field gained or lost", () => {
    expect(hashOf(modelFor([ORDER], "PRODUCT_NOT_RECEIVED"))).not.toBe(base);
  });

  it("3. a payload value, with every status flag unchanged", () => {
    // The sharpest case. `delivered_confirmed` → `label_created` is the same
    // field, same availability, same relevance — and a different band,
    // because the categorizer reads the payload. A hash over statuses alone
    // calls this snapshot fresh, which is the exact silent-staleness failure.
    const weaker = modelFor(
      [ORDER, { ...DELIVERY, data: { ...DELIVERY.data, proofType: "label_created" } }],
      "PRODUCT_NOT_RECEIVED",
    );
    expect(hashOf(weaker)).not.toBe(base);
  });

  it("4. a gate VALUE — coverage flipping to covered", () => {
    const covered = gatesWith({
      coverage: { state: "covered_shopify", shopifyProtectStatus: "PROTECTED" },
    });
    expect(hashOf(baseModel, covered)).not.toBe(hashOf(baseModel, NO_GATES));
  });

  it("5. gateProvided(null) vs gateNotProvided — the conflation that shipped a wrong band", () => {
    // "This case has no fatal loss" and "this call site never loaded the
    // order" scored the same and hashed the same, and the browser showed
    // Strong on a case the server had capped at Moderate. They must be
    // distinguishable snapshots even when they score identically.
    const stated = gatesWith({ fatalLoss: null });
    const unseen = buildCaseGateAssessment({
      coverage: gateNotProvided("gate_free_query"),
      fatalLoss: gateNotProvided("order_not_loaded"),
      riskWeakness: gateNotProvided("gate_free_query"),
      nameMismatch: gateNotProvided("gate_free_query"),
      creditAlreadyIssued: gateNotProvided("gate_free_query"),
    } as unknown as CaseGateSources);
    expect(hashOf(baseModel, stated)).not.toBe(hashOf(baseModel, unseen));
  });

  it("6. an external payload source the scorer reads", () => {
    const withAvs: EvidencePayloadSource = {
      kind: "byField",
      map: { avs_cvv_match: { payload: { avsResultCode: "Y", cvvResultCode: "M" } } },
    };
    const withDifferentAvs: EvidencePayloadSource = {
      kind: "byField",
      map: { avs_cvv_match: { payload: { avsResultCode: "N", cvvResultCode: "N" } } },
    };
    const fraud = modelFor(BASE_SECTIONS, "FRAUDULENT");
    expect(hashOf(fraud, NO_GATES, withAvs)).not.toBe(hashOf(fraud, NO_GATES, undefined));
    expect(hashOf(fraud, NO_GATES, withAvs)).not.toBe(
      hashOf(fraud, NO_GATES, withDifferentAvs),
    );
  });

  it("7. coverage carried on the model's non-evidence facts", () => {
    const covered = modelFor(BASE_SECTIONS, "PRODUCT_NOT_RECEIVED");
    covered.nonEvidence.coverage = {
      state: "covered_shopify",
      shopifyProtectStatus: "PROTECTED",
    };
    expect(hashOf(covered)).not.toBe(base);
  });

  it("8. the model / registry versions", () => {
    const bumped = modelFor(BASE_SECTIONS, "PRODUCT_NOT_RECEIVED");
    bumped.modelVersion = bumped.modelVersion + 1;
    expect(hashOf(bumped)).not.toBe(base);

    const registryBumped = modelFor(BASE_SECTIONS, "PRODUCT_NOT_RECEIVED");
    registryBumped.definitionRegistryVersion += 1;
    expect(hashOf(registryBumped)).not.toBe(base);
  });
});

describe("input hash — inputs that CANNOT move the result do not move it", () => {
  const model = modelFor(BASE_SECTIONS, "PRODUCT_NOT_RECEIVED");
  const base = hashOf(model);

  it("packId and evidenceItemIds are provenance, not inputs", () => {
    // These change on every rebuild. Hashing them would mark the whole fleet
    // stale continuously — a false-stale is not the conservative choice, it
    // is a fleet that never files.
    const rebuilt = modelFor(BASE_SECTIONS, "PRODUCT_NOT_RECEIVED");
    rebuilt.derivedFrom = {
      packId: "a-completely-different-pack",
      sectionsHash: "different",
      evidenceItemIds: ["x", "y", "z"],
    };
    expect(hashOf(rebuilt)).toBe(base);
  });

  it("operational metadata (collector errors, retired keys) is recorded, never scored", () => {
    const noisy = modelFor(BASE_SECTIONS, "PRODUCT_NOT_RECEIVED");
    noisy.nonEvidence.operational = {
      collectorErrors: [{ source: "gorgias", error: "timeout" }],
      unregisteredFields: ["mystery_field"],
      retiredFields: ["billing_address_match"],
    };
    expect(hashOf(noisy)).toBe(base);
  });

  it("the two payload-source FORMS agree — buildPack and the workspace route must not disagree", () => {
    // `buildPack` passes the `list` form over all sections; the workspace
    // route passes `byField` for the same case. A form-sensitive hash would
    // report every case stale on whichever surface ran second.
    const fraud = modelFor(BASE_SECTIONS, "FRAUDULENT");
    const payload = { avsResultCode: "Y", cvvResultCode: "M", fieldsProvided: ["avs_cvv_match"] };
    const byField: EvidencePayloadSource = {
      kind: "byField",
      map: { avs_cvv_match: { payload } },
    };
    const list: EvidencePayloadSource = { kind: "list", items: [{ payload }] };
    expect(hashOf(fraud, NO_GATES, list)).toBe(hashOf(fraud, NO_GATES, byField));
  });
});

describe("gateDecided", () => {
  it("is true when coverage says covered", () => {
    expect(
      isGateDecided(
        gatesWith({
          coverage: { state: "covered_shopify", shopifyProtectStatus: "PROTECTED" },
        }),
      ),
    ).toBe(true);
  });

  it("is true when fatal loss triggered", () => {
    expect(
      isGateDecided(gatesWith({ fatalLoss: { triggered: true, reason: "refund_issued", messageToken: null } })),
    ).toBe(true);
  });

  it("is FALSE when a gate was never looked at", () => {
    // "Nobody looked" is not "no gate". Collapsing them is the conflation
    // `CaseGateAssessment` was built to prevent, and `gateDecided` must not
    // reintroduce it one layer up.
    expect(isGateDecided(NO_GATES)).toBe(false);
    expect(
      isGateDecided(
        buildCaseGateAssessment({
          coverage: gateNotProvided("order_not_loaded"),
          fatalLoss: gateNotProvided("order_not_loaded"),
          riskWeakness: gateProvided(null),
          nameMismatch: gateProvided(null),
          creditAlreadyIssued: gateProvided(null),
        } as unknown as CaseGateSources),
      ),
    ).toBe(false);
  });

  it("is false when both gates are stated and neither fires", () => {
    expect(isGateDecided(gatesWith({ coverage: null, fatalLoss: null }))).toBe(false);
  });
});
