import type { DisputePhase } from "@/lib/rules/disputeReasons";
import type { AutomationMode } from "@/lib/rules/normalizeMode";

/**
 * Merchant-facing handling mode derived from the matched automation rule.
 * Mirrors the canonical AutomationMode exactly: the dispute was either
 * handled automatically ("auto") or prepared for merchant review ("review").
 */
export type HandlingMode = AutomationMode;

/**
 * Lifecycle metadata derived at query time for a dispute.
 * Phase A+B: visibility and defaults only — not full workflow branching.
 */
export interface DisputeLifecycleInfo {
  /** null = unknown (legacy data or API version without type field) */
  phase: DisputePhase | null;
  /** Reason family from DISPUTE_REASON_FAMILIES */
  family: string;
  /** Derived from matched automation rule mode */
  handling_mode: HandlingMode;
}
