/**
 * Recommendation engine — produces the merchant-facing
 * "Recommendation:" sentence + optional helper line displayed on the
 * dispute Overview tab.
 *
 * Plan v3 §3.A.6 puts this logic in `lib/` so it lives next to the
 * rest of the argument engine, not inside a UI component. The only
 * consumer is `useDisputeWorkspace.ts`, which exposes the strings as
 * `derived.recommendationText` and `derived.recommendationHelperText`
 * for the OverviewTab to render verbatim.
 *
 * i18n (2026-05-24): outputs are now structured tokens
 * (`{ key, params }`) consumed by `useTranslations()` at render. The
 * legacy English-string fields (`text`, `helperText`) are still emitted
 * for back-compat (existing tests + any server consumers) but they MUST
 * NOT be rendered to merchants — the UI reads `textI18n` / `helperI18n`
 * and translates them.
 *
 * Inputs are pure derived state (no React, no DOM). Same input →
 * same output, like every other backend builder in `lib/`.
 */

import type { CaseStrengthLevel, I18nToken, MissingItemWithContext } from "./types";

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
  /** Top missing item (highest priority), or null when none. */
  topMissing: MissingItemWithContext | null;
  /** ISO timestamp of pack save_to_shopify, when submitted. */
  submittedAt: string | null;
}

export interface RecommendationOutput {
  /** Legacy English string. Kept for tests and any server consumers.
   *  NEVER render this directly in the embedded UI — use `textI18n`. */
  text: string;
  /** Legacy English helper line. Kept for tests. NEVER render in UI. */
  helperText: string | null;
  /** i18n token for `text`. Consume via `t(key, params)`. */
  textI18n: I18nToken;
  /** i18n token for `helperText`. null when no helper is shown. */
  helperI18n: I18nToken | null;
}

export function generateRecommendation(
  args: GenerateRecommendationInput,
): RecommendationOutput {
  const { submitted, strength, topMissing, submittedAt } = args;

  let text: string;
  let textI18n: I18nToken;
  let helperText: string | null = null;
  let helperI18n: I18nToken | null = null;

  if (submitted) {
    if (strength === "strong" || strength === "moderate") {
      text =
        "Recommendation: No further action is required. Your defense has been successfully submitted. We will notify you when the bank responds.";
      textI18n = { key: "disputes.recommendation.submitted.strongOrModerate" };
    } else {
      text =
        "Recommendation: Monitor this case. Consider strengthening evidence for future disputes.";
      textI18n = { key: "disputes.recommendation.submitted.weakOrInsufficient" };
    }
    if (submittedAt) {
      const daysElapsed = calendarDaysSince(submittedAt);
      const dayLabel =
        daysElapsed === 0
          ? "Submitted today"
          : `${daysElapsed} day${daysElapsed === 1 ? "" : "s"} since submission`;
      helperText = `${dayLabel}. The issuing bank typically responds within 30–75 days.`;
      helperI18n = {
        key: "disputes.recommendation.helperWithDays",
        params: { days: daysElapsed },
      };
    } else {
      helperText = "The issuing bank typically responds within 30–75 days.";
      helperI18n = { key: "disputes.recommendation.helperNoDate" };
    }
  } else if (strength === "strong") {
    text =
      "Recommendation: Submit now — your evidence is strong enough to defend this charge.";
    textI18n = { key: "disputes.recommendation.notSubmitted.strong" };
  } else if (strength === "moderate") {
    if (topMissing) {
      const label = topMissing.label.toLowerCase();
      text = `Recommendation: You can submit, but adding ${label} would meaningfully improve your odds.`;
      textI18n = {
        key: "disputes.recommendation.notSubmitted.moderateWithMissing",
        params: { label },
      };
    } else {
      text =
        "Recommendation: You can submit now, but a small amount of additional evidence would improve your odds.";
      textI18n = { key: "disputes.recommendation.notSubmitted.moderateNoMissing" };
    }
  } else {
    if (topMissing) {
      const label = topMissing.label.toLowerCase();
      text = `Recommendation: Add ${label} before submitting — the case is currently unlikely to win as-is.`;
      textI18n = {
        key: "disputes.recommendation.notSubmitted.weakWithMissing",
        params: { label },
      };
    } else {
      text =
        "Recommendation: Strengthen the evidence before submitting — the case is currently unlikely to win as-is.";
      textI18n = { key: "disputes.recommendation.notSubmitted.weakNoMissing" };
    }
  }

  return { text, helperText, textI18n, helperI18n };
}
