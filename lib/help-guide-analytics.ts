import type { HelpGuideId } from "@/lib/help-guides-config";

/**
 * Analytics for interactive help guides. Replace or extend with your project's
 * analytics API (e.g. segment, mixpanel, gtag).
 */
export function trackHelpGuideStarted(guideId: HelpGuideId): void {
  if (typeof window === "undefined") return;
  console.debug("[analytics] help_guide_started", { guideId });
}

export function trackHelpGuideCompleted(guideId: HelpGuideId): void {
  if (typeof window === "undefined") return;
  console.debug("[analytics] help_guide_completed", { guideId });
}

export function trackHelpGuideSkipped(
  guideId: HelpGuideId,
  stepIndex: number
): void {
  if (typeof window === "undefined") return;
  console.debug("[analytics] help_guide_skipped", { guideId, stepIndex });
}
