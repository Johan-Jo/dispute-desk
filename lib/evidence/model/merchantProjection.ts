/**
 * CP-A — the server projection the three merchant tabs render.
 *
 * ── WHAT A PROJECTION MAY DO ──────────────────────────────────────────
 *
 * Filter, sort, summarise. Never reclassify, never re-band, never
 * reconstruct readiness. `MerchantAssessmentProjection` is deliberately NOT
 * the full snapshot: the tabs receive a band, a number and a readiness, and
 * they have no inputs from which to compute a different answer. That is the
 * structural half of the migration — deleting the client's
 * `calculateCaseStrength` call is the other half, and neither works alone.
 *
 * ── `needsRecalculation` IS A STATE, NOT A NULL ───────────────────────
 *
 * A stale number rendered as current is worse than no number, because the
 * merchant acts on it: they see "Strong, 92% complete" for evidence they
 * replaced an hour ago and close the tab. So when the snapshot is absent or
 * stale, EVERY value this projection carries goes null together. There is no
 * partial mode where the band survives and the score does not — the two were
 * computed from the same inputs, and if those inputs moved, both are wrong.
 *
 * `evaluateFreshness` is the ONLY predicate consulted. No date comparison
 * lives here; `computedAt` is audit-only by contract.
 */

import type {
  CaseArgumentPlanSnapshot,
  CaseAssessmentSnapshot,
  InputHash,
  MerchantAssessmentProjection,
  MerchantReviewItem,
} from "@/lib/pipeline/contracts";
import { evaluateFreshness } from "@/lib/pipeline/contracts";

/*
 * WHY THE MERCHANT IS BEING ASKED TO WAIT lives on the contract now.
 *
 * CP-A first carried it on a local `MerchantAssessmentProjectionWithReason`
 * extension, on the reading that `MerchantAssessmentProjection` was
 * coordinator-owned and the reason was CP-A's routing detail. CONTRACT
 * REVISION 1 moved `recalculationReason` into the contract itself and the local
 * extension is deleted: `snapshot_absent` means "never computed" (recalculate),
 * `input_hash_mismatch` means "computed against evidence that has since
 * changed" (rebuild). Both block, they route the merchant differently, and a
 * parallel type next to the contract is exactly the divergence the contract
 * exists to prevent.
 */

/**
 * Review items, projected from the argument plan.
 *
 * Projected — not derived. Which facts are excluded and why is layer 3's
 * decision (Agent B); this function only reformats the `review_required`
 * subset for a merchant surface. It cannot add an item the plan does not
 * carry, and it cannot drop one the plan does.
 *
 * `blocksNormalFiling` is read from `plan.deadlineOnly`, the plan's own
 * statement of consequence, rather than inferred from "there is at least one
 * review item". Those coincide today; inferring would make this a second
 * predicate the moment they stop coinciding.
 */
export function projectReviewItems(
  plan: CaseArgumentPlanSnapshot | null | undefined,
): MerchantReviewItem[] {
  if (!plan) return [];
  return plan.excluded
    .filter((fact) => fact.reason === "review_required")
    .map((fact) => ({
      recordId: fact.recordId,
      fieldKey: fact.fieldKey,
      // Never English. The plan carries a token KEY; contract revision 1 made
      // this field an `I18nToken`, so the key is wrapped here rather than
      // handed on bare — a bare string cannot carry params, and the first
      // reason that needs a field label or a count would otherwise have forced
      // English into `lib/` or a second token shape.
      //
      // A fact with no reason token still gets a generic one rather than an
      // empty string, because an empty reason renders as a blank line the
      // merchant cannot act on.
      reasonToken: {
        key: fact.merchantReasonToken ?? REVIEW_REASON_FALLBACK_TOKEN,
      },
      blocksNormalFiling: plan.deadlineOnly,
    }));
}

/** Generic "this needs your confirmation" reason. Present in all six locales. */
export const REVIEW_REASON_FALLBACK_TOKEN =
  "disputes.deadlineOnly.reviewItem.generic";

/**
 * The projection.
 *
 * `currentInputHash` is recomputed by the CALLER from live inputs
 * (`computeAssessmentInputHash`) — this function must never recompute it,
 * because a projection that can derive the hash can derive the assessment,
 * and then it is not a projection.
 */
export function projectMerchantAssessment(args: {
  caseId: string;
  snapshot: CaseAssessmentSnapshot | null | undefined;
  currentInputHash: InputHash;
  currentPolicyVersion: number;
  plan?: CaseArgumentPlanSnapshot | null;
}): MerchantAssessmentProjection {
  const { caseId, snapshot, currentInputHash, currentPolicyVersion, plan } = args;

  const verdict = evaluateFreshness({
    snapshot: snapshot?.freshness,
    currentInputHash,
    currentPolicyVersion,
  });

  // Review items survive staleness on purpose. "One item needs your
  // confirmation" is a fact about the evidence, not about the score, and
  // hiding it while a recalculation is pending would remove the merchant's
  // only lever at exactly the moment they are being asked to wait.
  const reviewItems = projectReviewItems(plan);

  if (!verdict.fresh || !snapshot) {
    return {
      caseId,
      needsRecalculation: true,
      strengthBand: null,
      completenessScore: null,
      readiness: null,
      reviewItems,
      recalculationReason: verdict.fresh ? "snapshot_absent" : verdict.reason,
    };
  }

  return {
    caseId,
    needsRecalculation: false,
    strengthBand: snapshot.strength.overall,
    completenessScore: snapshot.completeness.score,
    readiness: snapshot.completeness.readiness,
    reviewItems,
    recalculationReason: null,
  };
}
