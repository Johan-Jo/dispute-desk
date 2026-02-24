/**
 * Auto-save gate: determines whether a pack should be automatically
 * pushed to Shopify based on store settings, completeness, and blockers.
 */

import type { ShopSettings } from "./settings";

export type GateDecision =
  | { action: "auto_save" }
  | { action: "park_for_review"; reason: string }
  | { action: "block"; reasons: string[] };

interface GateInput {
  settings: ShopSettings;
  completenessScore: number;
  blockers: string[];
  isApproved: boolean;
}

export function evaluateAutoSaveGate(input: GateInput): GateDecision {
  const { settings, completenessScore, blockers, isApproved } = input;

  if (!settings.auto_save_enabled) {
    return { action: "block", reasons: ["Auto-save is disabled for this store"] };
  }

  const blockReasons: string[] = [];

  if (completenessScore < settings.auto_save_min_score) {
    blockReasons.push(
      `Completeness score ${completenessScore}% is below threshold ${settings.auto_save_min_score}%`
    );
  }

  if (settings.enforce_no_blockers && blockers.length > 0) {
    blockReasons.push(
      `${blockers.length} blocker(s) remain: ${blockers.join(", ")}`
    );
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
