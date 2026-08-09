/**
 * Merchant-facing reason tokens for argument-plan exclusions.
 *
 * `lib/**` may not emit resolved English (CLAUDE.md §5), so an exclusion
 * carries a KEY. The merchant is owed the reason — a fact excluded silently is
 * indistinguishable from a fact that was never collected — and the issuer is
 * owed none of it, which is why this map is consumed only by merchant surfaces
 * and never by the package projection.
 *
 * One token per `ExclusionReason`, and no token is reused across two reasons:
 * the four exclusion classes route differently in the UI (review_required is
 * actionable; merchant_only never will be), so collapsing two of them into one
 * sentence would tell a merchant to fix something they cannot.
 */

import type { ExclusionReason } from "@/lib/pipeline/contracts";

/** Key paths under `packs.argumentPlan.exclusion.*` in every locale catalog. */
export const EXCLUSION_REASON_TOKENS: Record<ExclusionReason, string> = {
  review_required: "packs.argumentPlan.exclusion.reviewRequired",
  unverified: "packs.argumentPlan.exclusion.unverified",
  adverse: "packs.argumentPlan.exclusion.adverse",
  merchant_only: "packs.argumentPlan.exclusion.merchantOnly",
  not_argument_relevant: "packs.argumentPlan.exclusion.notArgumentRelevant",
};

export function exclusionReasonToken(reason: ExclusionReason): string {
  return EXCLUSION_REASON_TOKENS[reason];
}
