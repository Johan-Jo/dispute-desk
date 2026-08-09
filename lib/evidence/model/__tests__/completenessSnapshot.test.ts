/**
 * CP-A — completeness is independent of strength, and the persisted gate
 * reader is faithful to production.
 *
 * TWO SEPARATE CLAIMS, and they fail in different ways:
 *
 *   INDEPENDENCE — completeness must not move when only strength inputs move,
 *     and vice versa. A shared input (the evidence itself) moving both is not
 *     a violation; a GATE moving completeness is.
 *
 *   FAITHFULNESS — the three NULL coercions in `pipeline.ts` are three
 *     different answers to three different questions, and one of them
 *     (`?? undefined`) selects an ENTIRELY DIFFERENT ARM of the auto-save
 *     gate. Getting it wrong would silently auto-file every legacy pack that
 *     has blockers.
 */

import { describe, it, expect } from "vitest";
import {
  completenessFromChecklist,
  deriveCompletenessSnapshot,
  readPersistedCompletenessForGate,
} from "../completenessSnapshot";
import { deriveCaseEvidenceModel } from "../derive";
import { evaluateAutoSaveGate } from "@/lib/automation/autoSaveGate";
import { gatesWith, NO_GATES } from "@/tests/helpers/caseStrengthGates";
import { buildCaseAssessmentSnapshot } from "../assessmentSnapshot";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";

const ORDER = {
  source: "shopify_order",
  fieldsProvided: ["order_confirmation"],
  data: { orderName: "#1001", orderId: "gid://shopify/Order/1" },
};
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
  return deriveCaseEvidenceModel({ disputeId: "d1", reason, sections: sections as never })
    .model;
}

describe("completeness is derived independently of strength", () => {
  it("takes the model and nothing else — no gates, no payload source, no reason family", () => {
    // This is a signature assertion as much as a behavioural one. If a future
    // change needs a gate to compute completeness, the arity changes here and
    // the conflation becomes visible in review instead of in production.
    expect(deriveCompletenessSnapshot.length).toBe(1);
  });

  it("does not move when only a GATE moves", () => {
    const model = modelFor([ORDER, DELIVERY], "PRODUCT_NOT_RECEIVED");
    const plain = buildCaseAssessmentSnapshot({
      caseId: "d1", model, gates: NO_GATES, payloadSource: undefined,
      now: "2026-08-09T00:00:00.000Z",
    });
    const covered = buildCaseAssessmentSnapshot({
      caseId: "d1",
      model,
      gates: gatesWith({
        coverage: { state: "covered_shopify", shopifyProtectStatus: "PROTECTED" },
      }),
      payloadSource: undefined,
      now: "2026-08-09T00:00:00.000Z",
    });

    // The coverage gate rewrites the hero variant and the strength reason.
    // It may not touch a single completeness number: "how much of the asked-
    // for evidence is present" is not a question coverage answers.
    expect(covered.completeness).toEqual(plain.completeness);
    expect(covered.strength.heroVariant).not.toBe(plain.strength.heroVariant);
  });

  it("a fatal-loss cap moves the band and leaves completeness alone", () => {
    const model = modelFor([ORDER, DELIVERY], "PRODUCT_NOT_RECEIVED");
    const now = "2026-08-09T00:00:00.000Z";
    const open = buildCaseAssessmentSnapshot({
      caseId: "d1", model, gates: NO_GATES, payloadSource: undefined, now,
    });
    const fatal = buildCaseAssessmentSnapshot({
      caseId: "d1",
      model,
      gates: gatesWith({ fatalLoss: { triggered: true, reason: "refund_issued", messageToken: null } }),
      payloadSource: undefined,
      now,
    });
    expect(fatal.strength.overall).toBe("weak");
    expect(fatal.completeness.score).toBe(open.completeness.score);
  });

  it("completeness counts `unavailable` rows out of the DENOMINATOR, not into `missing`", () => {
    // The 30-point error. `deriveCompletenessMetrics` drops `unavailable`
    // rows entirely, so an unfulfilled order is not penalised for having no
    // delivery proof. Collapsing `unavailable` into `missing` read ~30 points
    // low against prod.
    const rows: ChecklistItemV2[] = [
      { field: "order_confirmation", label: "", status: "available", priority: "critical", blocking: false, source: "auto_shopify" },
      { field: "delivery_proof", label: "", status: "unavailable", priority: "critical", blocking: false, source: "auto_shopify" },
    ];
    const asMissing: ChecklistItemV2[] = [
      rows[0],
      { ...rows[1], status: "missing" },
    ];
    expect(completenessFromChecklist(rows).score).toBe(100);
    expect(completenessFromChecklist(asMissing).score).toBe(50);
  });
});

describe("readPersistedCompletenessForGate — the three faithful coercions", () => {
  it("NULL score → 0, so an unscored pack parks instead of auto-filing", () => {
    expect(readPersistedCompletenessForGate({ completeness_score: null }).completenessScore).toBe(0);
    expect(readPersistedCompletenessForGate({}).completenessScore).toBe(0);
    expect(readPersistedCompletenessForGate(null).completenessScore).toBe(0);
    // 0 is a real score and must survive — `?? 0` and `|| 0` differ here only
    // for 0 itself, and only `??` is correct.
    expect(readPersistedCompletenessForGate({ completeness_score: 0 }).completenessScore).toBe(0);
    expect(readPersistedCompletenessForGate({ completeness_score: 42 }).completenessScore).toBe(42);
  });

  it("NULL blockers → []", () => {
    expect(readPersistedCompletenessForGate({ blockers: null }).blockers).toEqual([]);
    expect(readPersistedCompletenessForGate({}).blockers).toEqual([]);
    expect(readPersistedCompletenessForGate({ blockers: ["a", "b"] }).blockers).toEqual(["a", "b"]);
  });

  it("NULL readiness → undefined, which selects the LEGACY blocker-count arm", () => {
    // The load-bearing one. `undefined` is not a missing value here; it is a
    // routing decision, and the two obvious "fixes" both change dispositions:
    //   → "ready"   auto-files every legacy pack that has blockers
    //   → "blocked" freezes every legacy pack forever
    expect(readPersistedCompletenessForGate({ submission_readiness: null }).submissionReadiness)
      .toBeUndefined();
    expect(readPersistedCompletenessForGate({}).submissionReadiness).toBeUndefined();
    expect(readPersistedCompletenessForGate({ submission_readiness: "ready" }).submissionReadiness)
      .toBe("ready");
    expect(readPersistedCompletenessForGate({ submission_readiness: "blocked" }).submissionReadiness)
      .toBe("blocked");
  });

  it("an unrecognised readiness falls back to the legacy arm rather than clearing the gate", () => {
    // The readiness arm asks `=== "blocked"`. An unknown fifth member would
    // satisfy `!== "blocked"` and clear a gate nobody evaluated.
    expect(
      readPersistedCompletenessForGate({ submission_readiness: "almost_ready" }).submissionReadiness,
    ).toBeUndefined();
  });

  it("END TO END: the legacy arm still blocks on blocker count when readiness is NULL", () => {
    const gateInput = {
      autoSaveEnabled: true,
      autoSaveMinScore: 50,
      enforceNoBlockers: true,
      ...readPersistedCompletenessForGate({
        completeness_score: 90,
        blockers: ["Delivery Proof"],
        submission_readiness: null,
      }),
    };
    expect(evaluateAutoSaveGate(gateInput).action).toBe("block");
  });

  it("END TO END: with readiness present, `ready_with_warnings` + blockers does NOT block", () => {
    // The v2 arm deliberately tolerates warnings. Same row, same blockers,
    // opposite disposition — which is exactly why the NULL coercion cannot be
    // "simplified".
    const gateInput = {
      autoSaveEnabled: true,
      autoSaveMinScore: 50,
      enforceNoBlockers: true,
      ...readPersistedCompletenessForGate({
        completeness_score: 90,
        blockers: ["Delivery Proof"],
        submission_readiness: "ready_with_warnings",
      }),
    };
    expect(evaluateAutoSaveGate(gateInput).action).toBe("auto_save");
  });

  it("a non-array `blockers` produces the SAME gate outcome as production's cast", () => {
    // The one deliberate difference from `(pack.blockers as string[]) ?? []`.
    // Production would pass the object through and evaluate
    // `undefined > 0` === false; this returns [] and evaluates
    // `0 > 0` === false. Identical disposition, honest type.
    const gateInput = {
      autoSaveEnabled: true,
      autoSaveMinScore: 50,
      enforceNoBlockers: true,
      ...readPersistedCompletenessForGate({
        completeness_score: 90,
        blockers: { unexpected: true } as unknown,
        submission_readiness: null,
      }),
    };
    expect(evaluateAutoSaveGate(gateInput).action).toBe("auto_save");
  });
});
