/**
 * Single source of truth for autopilot Tier-A safeguards (PR 5).
 *
 * Two questions about every archive row reaching the autopilot:
 *   1. May we generate at all? (`isArchiveAutopilotEligible`)
 *      Tier A archives are skipped unless the admin has set
 *      `autopilot_approved = true` on the row — pillars are too important
 *      to ship cold.
 *   2. What workflow_status should the resulting content_item start in?
 *      (`autopilotInitialWorkflowStatus`)
 *      Tier A items hold at `in-editorial-review` so the publish queue
 *      cron does not auto-publish them; admin reviews and promotes.
 */

import { resolveTier, type ContentTier } from "./tiers";

export interface AutopilotArchiveSignals {
  contentType: string | null | undefined;
  tier_override?: string | null;
  is_hub_article?: boolean | null;
  autopilot_approved?: boolean | null;
}

export function archiveTier(signals: AutopilotArchiveSignals): ContentTier {
  return resolveTier({
    tier: signals.tier_override ?? null,
    contentType: signals.contentType,
    isHubArticle: signals.is_hub_article ?? null,
  });
}

/**
 * Returns true when the autopilot picker may select this archive row.
 * Tier A is gated behind `autopilot_approved = true`; Tier B/C are always
 * eligible (rate-limited externally by cms_settings).
 */
export function isArchiveAutopilotEligible(signals: AutopilotArchiveSignals): boolean {
  const tier = archiveTier(signals);
  if (tier === "A") {
    return signals.autopilot_approved === true;
  }
  return true;
}

/**
 * Initial workflow_status for an autopilot-generated content_item.
 * Tier A holds at `in-editorial-review`; Tier B/C continue scheduling
 * straight to publish queue.
 */
export function autopilotInitialWorkflowStatus(
  signals: AutopilotArchiveSignals
): "scheduled" | "in-editorial-review" {
  const tier = archiveTier(signals);
  return tier === "A" ? "in-editorial-review" : "scheduled";
}

/**
 * True when the autopilot pipeline should SKIP the publish-queue enqueue
 * for this brief — i.e. the article must wait for a human review before
 * going live. Currently only Tier A.
 */
export function shouldSkipAutopilotPublish(signals: AutopilotArchiveSignals): boolean {
  return archiveTier(signals) === "A";
}
