/**
 * Auto-save gate: determines whether a pack should be automatically
 * pushed to Shopify based on store settings, completeness, and blockers.
 */

import type { ShopSettings } from "./settings";
import type { SubmissionReadiness } from "@/lib/types/evidenceItem";

export type GateDecision =
  | { action: "auto_save" }
  | { action: "park_for_review"; reason: string }
  | { action: "block"; reasons: string[] };

interface GateInput {
  settings: ShopSettings;
  completenessScore: number;
  blockers: string[];
  isApproved: boolean;
  /** V2: when present, uses readiness instead of blockers for gating. */
  submissionReadiness?: SubmissionReadiness;
}

export function evaluateAutoSaveGate(input: GateInput): GateDecision {
  const { settings, completenessScore, blockers, isApproved, submissionReadiness } = input;

  if (!settings.auto_save_enabled) {
    return { action: "block", reasons: ["Auto-save is disabled for this store"] };
  }

  const blockReasons: string[] = [];

  if (completenessScore < settings.auto_save_min_score) {
    blockReasons.push(
      `Completeness score ${completenessScore}% is below threshold ${settings.auto_save_min_score}%`
    );
  }

  // V2 readiness-aware: only hard-block when readiness is "blocked"
  // (not for "ready_with_warnings"). Falls back to legacy blocker count.
  if (settings.enforce_no_blockers) {
    if (submissionReadiness !== undefined) {
      if (submissionReadiness === "blocked") {
        blockReasons.push("Submission is blocked — required evidence missing");
      }
    } else if (blockers.length > 0) {
      blockReasons.push(
        `${blockers.length} blocker(s) remain: ${blockers.join(", ")}`
      );
    }
  }

  if (blockReasons.length > 0) {
    return { action: "block", reasons: blockReasons };
  }

  if (settings.require_review_before_save && !isApproved) {
    return {
      action: "park_for_review",
      reason: "Review required before auto-save",
    };
  }

  return { action: "auto_save" };
}
