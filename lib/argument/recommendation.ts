/**
 * Recommendation engine — produces the merchant-facing
 * "Recommendation:" token + optional helper token displayed on the
 * dispute Overview tab.
 *
 * Plan v3 §3.A.6 puts this logic in `lib/` so it lives next to the
 * rest of the argument engine, not inside a UI component. The only
 * consumer is `useDisputeWorkspace.ts`, which resolves the tokens via
 * `resolveToken` and exposes the resulting `Localized` strings as
 * `derived.recommendationText` and `derived.recommendationHelperText`.
 *
 * No English strings are emitted from this module — UI rendering is
 * the sole responsibility of the translator layer.
 */

import type { I18nKeyParam, I18nToken } from "@/lib/i18n/token";
import type { CaseStrengthLevel, MissingItemWithContext } from "./types";

/** Calendar-day distance between an ISO timestamp and now (local time). */
function calendarDaysSince(iso: string): number {
  const from = new Date(iso);
  const fromDay = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today.getTime() - fromDay.getTime()) / (1000 * 60 * 60 * 24)));
}

export interface GenerateRecommendationInput {
  /** True when the pack has already been saved to Shopify. */
  submitted: boolean;
  /** Categorical strength from `calculateCaseStrength`. */
  strength: CaseStrengthLevel;
  /** Top missing item (highest priority), or null when none. The
   *  resolver uses `topMissing.labelToken` (set by Phase 3) when
   *  present; otherwise falls back to the raw `label` for back-compat
   *  with consumers that haven't been migrated yet. */
  topMissing: MissingItemWithContext | null;
  /** ISO timestamp of pack save_to_shopify, when submitted. */
  submittedAt: string | null;
}

export interface RecommendationOutput {
  /** Token for the recommendation sentence. Consume via
   *  `resolveToken(rootTranslator, textI18n)`. */
  textI18n: I18nToken;
  /** Token for the helper line. null when no helper is shown. */
  helperI18n: I18nToken | null;
}

/** Build the missing-label param. Prefers the structured token when
 *  the consumer is past Phase 3; falls back to the literal label
 *  otherwise. Lowercased so the sentence reads naturally. */
function missingLabelParam(topMissing: MissingItemWithContext): I18nKeyParam | string {
  // Forward-compat path: once `MissingItemWithContext` carries a
  // `labelToken`, recommend.ts wraps it as an I18nKeyParam so the
  // outer template gets a translated label spliced in.
  const maybeToken = (topMissing as MissingItemWithContext & { labelToken?: { key: string } }).labelToken;
  if (maybeToken && typeof maybeToken.key === "string") {
    return { type: "i18n-key", key: maybeToken.key };
  }
  return topMissing.label.toLowerCase();
}

export function generateRecommendation(
  args: GenerateRecommendationInput,
): RecommendationOutput {
  const { submitted, strength, topMissing, submittedAt } = args;

  let textI18n: I18nToken;
  let helperI18n: I18nToken | null = null;

  if (submitted) {
    textI18n =
      strength === "strong" || strength === "moderate"
        ? { key: "disputes.recommendation.submitted.strongOrModerate" }
        : { key: "disputes.recommendation.submitted.weakOrInsufficient" };
    if (submittedAt) {
      const daysElapsed = calendarDaysSince(submittedAt);
      helperI18n = {
        key: "disputes.recommendation.helperWithDays",
        params: { days: daysElapsed },
      };
    } else {
      helperI18n = { key: "disputes.recommendation.helperNoDate" };
    }
  } else if (strength === "strong") {
    textI18n = { key: "disputes.recommendation.notSubmitted.strong" };
  } else if (strength === "moderate") {
    textI18n = topMissing
      ? {
          key: "disputes.recommendation.notSubmitted.moderateWithMissing",
          params: { label: missingLabelParam(topMissing) },
        }
      : { key: "disputes.recommendation.notSubmitted.moderateNoMissing" };
  } else {
    textI18n = topMissing
      ? {
          key: "disputes.recommendation.notSubmitted.weakWithMissing",
          params: { label: missingLabelParam(topMissing) },
        }
      : { key: "disputes.recommendation.notSubmitted.weakNoMissing" };
  }

  return { textI18n, helperI18n };
}
