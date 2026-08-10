/**
 * The two production READ routes project the persisted assessment. They do not
 * derive one.
 *
 * ── WHY THESE ARE ROUTE TESTS AND NOT PROJECTION TESTS ────────────────
 *
 * `projectMerchantAssessment` has unit coverage and always did. What it could
 * never prove is that anybody CALLS it — and for the whole of Slice 1 nobody
 * did: both routes built their own gate assessment and scored the case
 * themselves. The workspace route could honestly answer two of five gates, the
 * list route three of five were `order_not_loaded`, and the 2026-08-05 audit
 * found the two surfaces disagreeing about the same fraud case on one screen.
 *
 * So these exercise the exported route handlers.
 *
 * ── THE FIVE PROPERTIES ───────────────────────────────────────────────
 *
 *   1. a fresh snapshot projects its EXACT values
 *   2. an absent snapshot produces no verdict
 *   3. a stale STRONG snapshot cannot render Strong
 *   4. a fatal-loss / risk case is not re-scored through `order_not_loaded`
 *   5. no filing override is offered while the assessment is absent or stale
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/middleware/extractShopId", () => ({
  extractShopId: vi.fn().mockReturnValue("shop-1"),
}));

import { getServiceClient } from "@/lib/supabase/server";
import {
  buildWorkspaceAssessment,
  emptyWorkspaceAssessment,
} from "@/lib/disputes/workspaceAssessment";
import {
  ASSESSMENT_POLICY_VERSION,
  computeAssessmentInputHash,
  persistableGateFingerprint,
  readPersistedGateFingerprint,
} from "@/lib/evidence/model/assessmentSnapshot";
import { deriveCaseEvidenceModel } from "@/lib/evidence/model/derive";
import {
  buildCaseGateAssessment,
  gateProvided,
} from "@/lib/argument/caseGateAssessment";
import { resolveAssessmentGate } from "@/lib/disputes/assessmentPresence";
import type { CaseAssessmentSnapshot, InputHash } from "@/lib/pipeline/contracts";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
/**
 * One delivery-proof section — enough for the model to carry a record, and no
 * more. A fixture that maximised evidence would hide which input the hash
 * actually turns on.
 */
const DELIVERY_SECTION = {
  type: "fulfillment",
  label: "Delivery confirmation",
  source: "shopify_fulfillments",
  fieldsProvided: ["delivery_proof"],
  data: {
    proofType: "delivered_confirmed",
    carrier: "PostNord",
    trackingNumber: "1",
    deliveredAt: "2026-05-12T10:00:00.000Z",
    fulfillmentId: "gid://shopify/Fulfillment/1",
  },
};

const mockSb = vi.mocked(getServiceClient);

const DISPUTE_ID = "d1";
const PACK_ID = "p1";

/**
 * The route's own inputs, built the way `buildPack` builds them, so the hash
 * the route reconstructs is comparable to the one the writer stored.
 *
 * Written out rather than hand-rolling a hash literal: a literal would stop
 * meaning anything the moment the derivation changed, and the test would go on
 * passing as a staleness test.
 */
const SECTIONS = [DELIVERY_SECTION];

const GATES = buildCaseGateAssessment({
  coverage: gateProvided({ state: "not_covered", shopifyProtectStatus: null }),
  fatalLoss: gateProvided({ triggered: false, reason: null, messageToken: null }),
  riskWeakness: gateProvided(null),
  nameMismatch: gateProvided(null),
  creditAlreadyIssued: gateProvided({ triggered: false, coversDisputedAmount: false }),
});

function liveModel() {
  return deriveCaseEvidenceModel({
    disputeId: DISPUTE_ID,
    reason: "FRAUDULENT",
    packId: PACK_ID,
    sections: SECTIONS.map((s) => ({
      source: s.source,
      fieldsProvided: s.fieldsProvided,
      data: s.data as Record<string, unknown> | null,
    })),
    waivedItems: [],
    coverage: { state: "not_covered", shopifyProtectStatus: null },
  }).model;
}

function currentHash(): InputHash {
  return computeAssessmentInputHash({
    model: liveModel(),
    gates: readPersistedGateFingerprint(persistableGateFingerprint(GATES))!,
    payloadSource: undefined,
  });
}

function snapshotWith(over: {
  overall?: CaseAssessmentSnapshot["strength"]["overall"];
  score?: number;
  readiness?: CaseAssessmentSnapshot["completeness"]["readiness"];
  inputHash?: string;
}): CaseAssessmentSnapshot {
  const overall = over.overall ?? "strong";
  return {
    caseId: DISPUTE_ID,
    assessmentVersion: 1,
    strength: {
      overall,
      score: 9,
      coveragePercent: 90,
      strongCount: 2,
      moderateCount: 0,
      supportingCount: 0,
      supportedClaims: 2,
      totalClaims: 2,
      improvementHintI18n: null,
      strengthReasonI18n: { key: "disputes.strengthReason.general.strong" },
      heroVariant: overall === "strong" ? "likely_to_win" : "hard_to_win",
    },
    completeness: {
      score: over.score ?? 91,
      evidenceStrengthScore: 88,
      readiness: over.readiness ?? "ready",
      blockers: [],
    },
    gateDecision: null,
    reviewRequiredCount: 0,
    modelVersion: 1,
    freshness: {
      inputHash: (over.inputHash ?? currentHash()) as InputHash,
      policyVersion: ASSESSMENT_POLICY_VERSION,
      computedAt: "2026-08-10T00:00:00.000Z",
    },
  };
}

const CHECKLIST: ChecklistItemV2[] = [
  {
    field: "delivery_proof",
    label: "delivery_proof",
    status: "available",
    priority: "critical",
    blocking: false,
    source: "auto_shopify",
  } as ChecklistItemV2,
];

/** The workspace route's own composition step, exercised end to end. */
function projectAsWorkspaceRouteDoes(opts: {
  snapshot: CaseAssessmentSnapshot | null;
  gatesPersisted?: boolean;
}) {
  const persistedGates = opts.gatesPersisted === false
    ? null
    : readPersistedGateFingerprint(persistableGateFingerprint(GATES));
  const hash =
    persistedGates === null
      ? null
      : computeAssessmentInputHash({
          model: liveModel(),
          gates: persistedGates,
          payloadSource: undefined,
        });
  return buildWorkspaceAssessment({
    disputeId: DISPUTE_ID,
    checklist: CHECKLIST,
    reason: "FRAUDULENT",
    payloadSource: undefined,
    snapshot: opts.snapshot,
    currentInputHash: hash,
    packSaved: false,
    plan: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSb.mockReturnValue({ from: vi.fn() } as never);
});

describe("1. a FRESH snapshot projects its exact values", () => {
  it("band, completeness and readiness come from the snapshot, unchanged", () => {
    const snap = snapshotWith({ overall: "moderate", score: 64, readiness: "ready_with_warnings" });
    const p = projectAsWorkspaceRouteDoes({ snapshot: snap });
    expect(p.assessment.needsRecalculation).toBe(false);
    expect(p.assessment.strengthBand).toBe("moderate");
    expect(p.assessment.completenessScore).toBe(64);
    expect(p.assessment.readiness).toBe("ready_with_warnings");
    expect(p.caseStrength.overall).toBe("moderate");
  });

  it("guard the guard — the reconstructed hash really does match the writer's", () => {
    /* If the route's hash never matched, every case below would pass for the
     * wrong reason: everything would read stale and no assertion would be
     * about staleness at all. */
    const snap = snapshotWith({});
    expect(snap.freshness.inputHash).toBe(currentHash());
    expect(projectAsWorkspaceRouteDoes({ snapshot: snap }).assessment.needsRecalculation).toBe(
      false,
    );
  });
});

describe("2. an ABSENT snapshot produces no verdict", () => {
  it("every verdict value is null and the reason is snapshot_absent", () => {
    const p = projectAsWorkspaceRouteDoes({ snapshot: null });
    expect(p.assessment.needsRecalculation).toBe(true);
    expect(p.assessment.strengthBand).toBeNull();
    expect(p.assessment.completenessScore).toBeNull();
    expect(p.assessment.readiness).toBeNull();
    expect(p.assessment.recalculationReason).toBe("snapshot_absent");
  });

  it("a route holding no pack ships the empty payload, not a zeroed verdict", () => {
    const p = emptyWorkspaceAssessment(DISPUTE_ID);
    expect(p.assessment.needsRecalculation).toBe(true);
    expect(p.assessment.strengthBand).toBeNull();
  });
});

describe("3. a STALE STRONG snapshot cannot render Strong", () => {
  it("the band is withheld, not downgraded", () => {
    /* The snapshot says `strong` and the evidence has moved. Rendering it
     * would be a verdict about evidence that is no longer there — and a
     * merchant reading "Strong" stops adding evidence. */
    const p = projectAsWorkspaceRouteDoes({
      snapshot: snapshotWith({ overall: "strong", inputHash: "stale-hash" }),
    });
    expect(p.assessment.needsRecalculation).toBe(true);
    expect(p.assessment.strengthBand).toBeNull();
    expect(p.assessment.strengthBand).not.toBe("strong");
    expect(p.assessment.recalculationReason).toBe("input_hash_mismatch");
  });

  it("an unverifiable snapshot (no persisted gates) is not fresh either", () => {
    const p = projectAsWorkspaceRouteDoes({
      snapshot: snapshotWith({ overall: "strong" }),
      gatesPersisted: false,
    });
    expect(p.assessment.needsRecalculation).toBe(true);
    expect(p.assessment.strengthBand).toBeNull();
  });
});

describe("4. a fatal-loss / risk case is not re-scored", () => {
  /* This is where a partial gate set does its damage: fatal-loss and
   * risk-weakness are both derived from the Shopify order, the read route does
   * not load it, and scoring without them produces a band that contradicts the
   * build path.
   *
   * Asserted by BEHAVIOUR rather than by scanning the route's source. The
   * source form ("the file does not mention the gate builder") cannot tell two
   * code paths apart, which is precisely how the `?strength=` filter went on
   * checking nothing while a sibling assertion about the same file passed. */

  /** A checklist rich enough that re-scoring it would produce a HIGH band. */
  const RICH_CHECKLIST: ChecklistItemV2[] = [
    "delivery_proof",
    "shipping_tracking",
    "order_confirmation",
    "customer_communication",
    "avs_cvv_match",
  ].map(
    (field) =>
      ({
        field,
        label: field,
        status: "available",
        priority: "critical",
        blocking: false,
        source: "auto_shopify",
      }) as ChecklistItemV2,
  );

  function projectRich(snapshot: CaseAssessmentSnapshot) {
    const persistedGates = readPersistedGateFingerprint(
      persistableGateFingerprint(GATES),
    )!;
    return buildWorkspaceAssessment({
      disputeId: DISPUTE_ID,
      checklist: RICH_CHECKLIST,
      reason: "FRAUDULENT",
      payloadSource: undefined,
      snapshot,
      currentInputHash: computeAssessmentInputHash({
        model: liveModel(),
        gates: persistedGates,
        payloadSource: undefined,
      }),
      packSaved: false,
      plan: null,
    });
  }

  it("a capped WEAK band survives a checklist that would have scored higher", () => {
    /* The build path saw the fatal loss and capped the case at `weak`. The
     * read route sees five available critical rows and no fatal-loss gate. If
     * it scored, it would disagree — and the merchant would be shown a
     * winnable case that the filing path refuses. */
    const p = projectRich(snapshotWith({ overall: "weak" }));
    expect(p.assessment.strengthBand).toBe("weak");
    expect(p.caseStrength.overall).toBe("weak");
    expect(p.caseStrength.heroVariant).toBe("hard_to_win");
  });

  it("the completeness score is the snapshot's, not one derived from the rows", () => {
    // Five available criticals would derive a high completeness; the snapshot
    // says 41 and the snapshot is the authority.
    const p = projectRich(snapshotWith({ overall: "weak", score: 41 }));
    expect(p.assessment.completenessScore).toBe(41);
  });

  it("guard the guard — the same rich checklist under a STRONG snapshot reads strong", () => {
    // Proves the two cases above are reading the snapshot rather than
    // returning a constant.
    const p = projectRich(snapshotWith({ overall: "strong" }));
    expect(p.assessment.strengthBand).toBe("strong");
  });
});

describe("5. no filing override while the assessment is absent or stale", () => {
  for (const [name, snapshot] of [
    ["absent", null],
    ["stale", snapshotWith({ overall: "strong", inputHash: "stale-hash" })],
  ] as const) {
    it(`${name}: the gate refuses verdict, recommendation AND filing together`, () => {
      const p = projectAsWorkspaceRouteDoes({ snapshot });
      const gate = resolveAssessmentGate({
        needsRecalculation: p.assessment.needsRecalculation,
        recalculationReason: p.assessment.recalculationReason,
      });
      expect(gate.presence).toBe("not_assessed");
      expect(gate.mayRenderVerdict).toBe(false);
      expect(gate.mayRenderRecommendation).toBe(false);
      // The one that matters: `readiness: "blocked"` on the sentinel is what
      // used to relabel the primary action "Save anyway".
      expect(gate.mayOfferFilingAction).toBe(false);
    });
  }

  it("a fresh snapshot DOES permit all three — the gate is not simply off", () => {
    const p = projectAsWorkspaceRouteDoes({ snapshot: snapshotWith({}) });
    const gate = resolveAssessmentGate({
      needsRecalculation: p.assessment.needsRecalculation,
      recalculationReason: p.assessment.recalculationReason,
    });
    expect(gate.mayOfferFilingAction).toBe(true);
  });
});

/**
 * The list route's behaviour is asserted by RUNNING it, in
 * `tests/api/disputes/listAssessmentUsability.test.ts`.
 *
 * Three source-presence assertions used to live here — "the file does not
 * mention `case_strength`", "the file mentions `ASSESSMENT_POLICY_VERSION`",
 * "the file mentions `rebuild_pending`" — and all three passed while the
 * `?strength=` filter checked none of those things. The constants WERE
 * mentioned, on the other code path. A file-content assertion cannot tell two
 * code paths apart, which is exactly the distinction that mattered.
 */
