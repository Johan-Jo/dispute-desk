/**
 * `CaseArgumentPlan` — the ONLY owner of argument disposition, inclusion,
 * disclosure and issuer-facing claim authority (CP-B §1).
 *
 * WHAT THIS REPLACES. Today the same question — "may this fact reach the
 * issuer?" — is answered by `factClassifier` (bankEligible /
 * includeInBankNarrative / submissionRisk), by the reason module's
 * `allowedFactCategories`, by `alwaysAdmissible`, by the PDF's Evidence Basis
 * renderer and by the claim guards, each from its own inputs. The plan answers
 * it ONCE and every downstream surface becomes a projection of `included`.
 *
 * EXCLUSION HAPPENS BEFORE GENERATION, NOT AFTER. A `review_required`,
 * unverified, adverse or merchant-only record is removed from the argument
 * before any issuer-facing text exists, so the language model is never shown a
 * fact it may not cite. Filtering generated prose afterwards is the failure mode
 * this ordering exists to prevent: prose that has already been written around a
 * fact does not survive that fact's removal, it merely loses its support and
 * keeps its sentence.
 *
 * ARGUMENT RELEVANCE STAYS. `reasonCodeModule.allowedFactCategories` decides
 * which facts belong in THIS argument; the evidence model decides what is true.
 * The maintainer decided 2026-08-04 that the allow-list is kept (P4-as-specced
 * was stopped on it: 0 of 76 packs identical). This module CONSUMES it — it does
 * not replace it, widen it, or re-open the decision.
 *
 * DETERMINISM. No clock, no I/O, no randomness. The same candidates plus the
 * same module produce the same plan, which is what makes `inputHash` a real
 * staleness signal rather than a timestamp with extra steps.
 */

import type {
  CaseArgumentPlanSnapshot,
  ExcludedFact,
  ExclusionReason,
  IncludedFact,
  MerchantReviewItem,
  NoSafeArgumentReason,
  SnapshotFreshness,
} from "@/lib/pipeline/contracts";
import type { ReasonCodeGuidance } from "@/lib/defence/types";
import type { PlanCandidate } from "./candidates";
import { exclusionReasonToken } from "./exclusionTokens";

/** Bumped when the derivation's SHAPE changes. Distinct from policy version. */
export const PLAN_VERSION = 1;

export interface DeriveArgumentPlanInput {
  caseId: string;
  /** Pins which allow-list applied. Usually `reasonModule.key`. */
  reasonModuleId: string;
  /**
   * The resolved reason-code module. Only two of its lists are read:
   * `allowedFactCategories` (argument relevance) and `criticalCategories` (the
   * categories this reason code declares its own theory rests on).
   *
   * `criticalCategories` and NOT `prioritize`: `prioritize` is a foregrounding
   * hint that names almost everything the module allows, so a "primary support
   * was removed" verdict keyed on it would fire for practically any exclusion
   * and say nothing. `criticalCategories` is the module's own statement of what
   * a full argument requires — for `visa_10_4_fraud`, payment authentication and
   * billing match, not every category it happens to like.
   */
  reasonModule: Pick<ReasonCodeGuidance, "allowedFactCategories" | "criticalCategories">;
  candidates: readonly PlanCandidate[];
  /**
   * Categories admitted regardless of what the label allows — the
   * `alwaysAdmissible` set, resolved by the caller against the same facts.
   *
   * Passed IN rather than computed here because the admission test operates on
   * `EvidenceFact.value.fieldKey`, and this module deliberately cannot see a
   * payload. Keeping the reach-in impossible is worth the extra parameter.
   */
  alwaysAdmissibleCategories?: readonly string[];
  /**
   * Records the merchant must resolve before they may be used, from
   * `CaseAssessment` (CP-A). Their presence is what makes a plan
   * `deadlineOnly`; their `reasonToken` is what the merchant is shown.
   */
  reviewItems?: readonly MerchantReviewItem[];
  freshness: SnapshotFreshness;
  planVersion?: number;
}

/**
 * Why a candidate is not in the argument. FIRST MATCH WINS, and the order is
 * load-bearing rather than incidental:
 *
 *   1. review_required     — actionable by the merchant, so it must not be
 *                            reported as something structural they cannot fix.
 *   2. merchant_only       — structurally never bank-facing. Not overridable.
 *   3. adverse             — sound evidence whose citation would hand the
 *                            issuer an argument (`withheld_risk`).
 *   4. unverified          — invalid or unverifiable; nothing to stand behind.
 *                            `ineligible` citation lands here too: the record is
 *                            sound but carries nothing an issuer could use.
 *   5. not_argument_relevant — the reason module's allow-list.
 *
 * Relevance is checked LAST on purpose. A record that is both irrelevant and
 * adverse should be reported as adverse: relevance is the weakest statement of
 * the five and would mask the reason that actually matters.
 */
function exclusionFor(
  candidate: PlanCandidate,
  args: { reviewRequired: boolean; allowed: ReadonlySet<string> },
): ExclusionReason | null {
  if (args.reviewRequired) return "review_required";
  if (candidate.citation === "withheld_internal") return "merchant_only";
  if (candidate.citation === "withheld_risk") return "adverse";
  if (candidate.validity !== "valid") return "unverified";
  if (candidate.citation === "ineligible") return "unverified";
  if (!args.allowed.has(candidate.factCategory)) return "not_argument_relevant";
  return null;
}

/**
 * Why nothing safe remains, when that is the answer.
 *
 * A real product state, not an error: "we will not file" is the honest outcome
 * and the merchant is notified. It is never a reason to lower the bar.
 *
 * The three reasons are distinguished by WHAT was lost, because they read
 * differently to a merchant:
 *   - nothing was ever collected            → no_rebuttal_argument
 *   - the theory's own support was excluded → no_primary_argument
 *   - everything else was excluded          → all_support_excluded
 */
function noSafeArgumentReason(args: {
  includedCount: number;
  candidateCount: number;
  excludedPrimaryCount: number;
}): NoSafeArgumentReason | null {
  if (args.includedCount > 0) return null;
  if (args.candidateCount === 0) return "no_rebuttal_argument";
  if (args.excludedPrimaryCount > 0) return "no_primary_argument";
  return "all_support_excluded";
}

export function deriveCaseArgumentPlan(
  input: DeriveArgumentPlanInput,
): CaseArgumentPlanSnapshot {
  const allowed = new Set<string>([
    ...input.reasonModule.allowedFactCategories,
    ...(input.alwaysAdmissibleCategories ?? []),
  ]);
  const critical = new Set<string>(input.reasonModule.criticalCategories);

  // Review items are keyed by recordId. `fieldKey` is carried on the item too,
  // but matching on it would exclude every record of a multi-record field when
  // the merchant was only asked about one parcel.
  const reviewByRecordId = new Map<string, MerchantReviewItem>();
  for (const item of input.reviewItems ?? []) reviewByRecordId.set(item.recordId, item);

  const included: IncludedFact[] = [];
  const excluded: ExcludedFact[] = [];
  let excludedPrimaryCount = 0;

  for (const candidate of input.candidates) {
    const reviewItem = reviewByRecordId.get(candidate.recordId);
    const reason = exclusionFor(candidate, {
      reviewRequired: reviewItem !== undefined,
      allowed,
    });

    if (reason === null) {
      included.push({
        recordId: candidate.recordId,
        fieldKey: candidate.fieldKey,
        factCategory: candidate.factCategory,
      });
      continue;
    }

    if (critical.has(candidate.factCategory)) excludedPrimaryCount += 1;
    excluded.push({
      recordId: candidate.recordId,
      fieldKey: candidate.fieldKey,
      reason,
      // A review item carries its own reason; the merchant was told something
      // specific and must not be re-told the generic sentence.
      merchantReasonToken: reviewItem?.reasonToken ?? exclusionReasonToken(reason),
    });
  }

  return {
    caseId: input.caseId,
    planVersion: input.planVersion ?? PLAN_VERSION,
    reasonModuleId: input.reasonModuleId,
    included,
    excluded,
    noSafeArgument: noSafeArgumentReason({
      includedCount: included.length,
      candidateCount: input.candidates.length,
      excludedPrimaryCount,
    }),
    // Any remaining review_required exclusion makes the package deadline_only:
    // selectable by the deadline trigger only, and then only with all five P-6
    // conditions met. A plan with none may produce normal eligibility.
    deadlineOnly: excluded.some((e) => e.reason === "review_required"),
    freshness: input.freshness,
  };
}

/** The one predicate for "this plan authorises issuer-facing text". */
export function planHasSafeArgument(plan: CaseArgumentPlanSnapshot): boolean {
  return plan.noSafeArgument === null && plan.included.length > 0;
}

/** Record ids the plan removed. The projection's exclusion set. */
export function excludedRecordIds(plan: CaseArgumentPlanSnapshot): Set<string> {
  return new Set(plan.excluded.map((e) => e.recordId));
}

/** Record ids the plan authorises. Nothing else may reach an issuer. */
export function includedRecordIds(plan: CaseArgumentPlanSnapshot): Set<string> {
  return new Set(plan.included.map((i) => i.recordId));
}
