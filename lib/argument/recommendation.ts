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
 * Inputs are pure derived state (no React, no DOM). Same input →
 * same output, like every other backend builder in `lib/`.
 */

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
  /** Top missing item (highest priority), or null when none. */
  topMissing: MissingItemWithContext | null;
  /** ISO timestamp of pack save_to_shopify, when submitted. */
  submittedAt: string | null;
}

export interface RecommendationOutput {
  /** The bold merchant-facing "Recommendation:"-prefixed sentence. */
  text: string;
  /** Optional secondary line (post-submit days-elapsed + bank window).
   *  null when not applicable. */
  helperText: string | null;
}

export function generateRecommendation(
  args: GenerateRecommendationInput,
): RecommendationOutput {
  const { submitted, strength, topMissing, submittedAt } = args;

  let text: string;
  let helperText: string | null = null;

  if (submitted) {
    if (strength === "strong" || strength === "moderate") {
      text =
        "Recommendation: No further action is required. Your defense has been successfully submitted. We will notify you when the bank responds.";
    } else {
      text =
        "Recommendation: Monitor this case. Consider strengthening evidence for future disputes.";
    }
    if (submittedAt) {
      const daysElapsed = calendarDaysSince(submittedAt);
      const dayLabel =
        daysElapsed === 0
          ? "Submitted today"
          : `${daysElapsed} day${daysElapsed === 1 ? "" : "s"} since submission`;
      helperText = `${dayLabel}. The issuing bank typically responds within 30–75 days.`;
    } else {
      helperText = "The issuing bank typically responds within 30–75 days.";
    }
  } else if (strength === "strong") {
    text =
      "Recommendation: Submit now — your evidence is strong enough to defend this charge.";
  } else if (strength === "moderate") {
    text = topMissing
      ? `Recommendation: You can submit, but adding ${topMissing.label.toLowerCase()} would meaningfully improve your odds.`
      : "Recommendation: You can submit now, but a small amount of additional evidence would improve your odds.";
  } else {
    text = topMissing
      ? `Recommendation: Add ${topMissing.label.toLowerCase()} before submitting — the case is currently unlikely to win as-is.`
      : "Recommendation: Strengthen the evidence before submitting — the case is currently unlikely to win as-is.";
  }

  return { text, helperText };
}
