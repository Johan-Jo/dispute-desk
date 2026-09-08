/**
 * "May this surface render a verdict?" — asked once, answered once.
 *
 * ── THE DEFECT THIS CLOSES ────────────────────────────────────────────
 *
 * `needsRecalculation` was introduced as a first-class state and then rendered
 * by nobody. Every surface read straight past it into the payload, and the
 * payload's empty form is not neutral — it is
 *
 *     overall: "insufficient" · heroVariant: "hard_to_win" ·
 *     readiness: "blocked" · completenessScore: null
 *
 * chosen so the tabs would type-check. So a dispute whose assessment had never
 * been computed, or had gone stale, rendered as a case we had assessed and
 * judged unwinnable — with a blocked completeness bar and a "Save anyway"
 * override, which is an invitation to file a package against an assessment
 * nobody has. The sentinel exists to satisfy a type; treating it as a
 * judgement is the bug.
 *
 * ── WHY A MODULE AND NOT A BOOLEAN AT EACH SITE ───────────────────────
 *
 * Five surfaces have to agree: Overview, Evidence, Review & Forward,
 * `useEvidenceSections` and `useReviewView`. Five `if (needsRecalculation)`
 * checks are five chances to write the condition slightly differently — and
 * the one that gets it wrong is the one that renders "hard to win" over a case
 * with no assessment. One predicate, one copy resolution, one place to change.
 *
 * ── WHY THE REASON MATTERS TO THE MERCHANT ────────────────────────────
 *
 * `snapshot_absent` means we have not assessed it yet — nothing is wrong and
 * there is nothing to do but wait. `input_hash_mismatch` means the evidence
 * moved after we assessed it, so the number would be about evidence that is no
 * longer there. Those read differently and route differently, which is exactly
 * why `evaluateFreshness` returns a reason rather than a boolean; collapsing
 * them into one string here would throw that away at the last step.
 *
 * No English. `lib/**` emits `I18nToken`s.
 */

import type { I18nToken } from "@/lib/i18n/token";
import type { StalenessReason } from "@/lib/pipeline/contracts";

/**
 * Whether a surface may render strength, completeness, a recommendation, or a
 * filing action.
 *
 * A closed union rather than `!needsRecalculation`, so a reader cannot get the
 * answer by negating something and has to name which state they are handling.
 */
export type AssessmentPresence = "current" | "absent" | "stale" | "unknown";

/**
 * Plan §3.5 splits the former `not_assessed` into THREE.
 *
 * `absent` and `stale` were always different merchant situations —
 * bodyKeyFor already routed them to different copy — but they shared one
 * presence value, so a caller could only ask "assessed or not". The header
 * pill therefore said "Not assessed yet" over a case carrying completeness
 * 97, which is false: it WAS assessed, under a policy we have since retired.
 *
 * `unknown` is new and is the one that must never be collapsed: it means the
 * freshness read itself failed. Merging it into `absent` would let an
 * infrastructure failure assert "we have not assessed this yet", which is a
 * positive claim about our own state that nobody checked.
 */

export interface NotAssessedCopy {
  presence: AssessmentPresence;
  /** Short state label. Never a verb — there is nothing for the merchant to do. */
  titleToken: I18nToken;
  /** One sentence: why there is no number, and what happens next. */
  bodyToken: I18nToken;
}

/**
 * The single source of truth for the three questions every surface asks.
 *
 * `mayRenderVerdict` is deliberately not the only field: a surface that hides
 * the strength pill but leaves the "Save anyway" button on screen has still
 * offered to file against an assessment that does not exist, so the CTA rule
 * is carried here too rather than inferred.
 */
export interface AssessmentGate extends NotAssessedCopy {
  /** Strength band, hero variant, completeness score, contributions. */
  mayRenderVerdict: boolean;
  /** Recommendation text, improvement hint, "what supports your case". */
  mayRenderRecommendation: boolean;
  /**
   * Any action that files, saves, or overrides a gate — including
   * "Save anyway".
   *
   * An override is the WORST thing to offer here: it asks the merchant to
   * accept a risk the product has not measured, and it is the exact button an
   * empty sentinel's `readiness: "blocked"` would have produced.
   */
  mayOfferFilingAction: boolean;
}

const TITLE: Record<AssessmentPresence, string> = {
  current: "disputes.assessmentState.current.title",
  absent: "disputes.assessmentState.notAssessed.title",
  // Distinct title: "Not assessed yet" is false for a case that was
  // assessed under a retired policy.
  stale: "disputes.assessmentState.stale.title",
  unknown: "disputes.assessmentState.unknown.title",
};

/**
 * Body copy per reason. `snapshot_absent` is "not yet"; the other two are
 * "the evidence moved". A surface never picks between these itself.
 */
function bodyKeyFor(reason: StalenessReason | null): string {
  switch (reason) {
    case "input_hash_mismatch":
    case "policy_version_superseded":
      return "disputes.assessmentState.notAssessed.bodyStale";
    // `snapshot_absent`, and the null a caller passes when it holds no reason
    // at all, are the same merchant-facing situation: nothing has been
    // assessed. Defaulting to the STALE copy instead would tell a merchant
    // their evidence changed when it never did.
    default:
      return "disputes.assessmentState.notAssessed.bodyAbsent";
  }
}

export function resolveAssessmentGate(input: {
  needsRecalculation: boolean;
  recalculationReason?: StalenessReason | null;
  /**
   * Did the freshness/assessment read SUCCEED? Optional so existing callers
   * are unaffected, but when explicitly `false` the gate reports `unknown`
   * and licenses nothing. Plan §3.1: a failed read must never resolve to
   * absence.
   */
  readOk?: boolean;
}): AssessmentGate {
  if (input.readOk === false) {
    return {
      presence: "unknown",
      titleToken: { key: TITLE.unknown },
      bodyToken: { key: "disputes.assessmentState.unknown.body" },
      mayRenderVerdict: false,
      mayRenderRecommendation: false,
      mayOfferFilingAction: false,
    };
  }

  if (!input.needsRecalculation) {
    return {
      presence: "current",
      titleToken: { key: TITLE.current },
      bodyToken: { key: "disputes.assessmentState.current.body" },
      mayRenderVerdict: true,
      mayRenderRecommendation: true,
      mayOfferFilingAction: true,
    };
  }

  const reason = input.recalculationReason ?? null;
  const presence: AssessmentPresence =
    reason === "input_hash_mismatch" || reason === "policy_version_superseded"
      ? "stale"
      : "absent";

  return {
    presence,
    titleToken: { key: TITLE[presence] },
    bodyToken: { key: bodyKeyFor(reason) },
    // All three FALSE together, deliberately. There is no state in which it is
    // correct to show a strength band but hide the recommendation, or to hide
    // both and keep the submit button: each of the three is downstream of the
    // same missing assessment. `stale` is no more permissive than `absent` —
    // a number computed under a retired policy is not a number.
    mayRenderVerdict: false,
    mayRenderRecommendation: false,
    mayOfferFilingAction: false,
  };
}
