import type { DisputePhase } from "@/lib/rules/disputeReasons";

export type HandlingMode = "automated" | "review" | "manual";

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
