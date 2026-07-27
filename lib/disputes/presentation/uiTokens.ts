/**
 * Shared visual treatments for the presentation model — one place for
 * every merchant-surface color decision, transcribed from the approved
 * mockups (Dashboard.html / Disputes.html / "Dispute Detail.html" —
 * their OP / EV / ATT maps and row-emphasis classes). Dashboard, list,
 * and detail all read these tokens; no surface hardcodes its own
 * status colors (plan §2, design-system consistency).
 *
 * Emphasis follows MERCHANT ATTENTION, never activity/weakness:
 * warning/error treatments are reserved for a genuine reason to act.
 */

import type {
  EvidenceStrength,
  MerchantAttention,
  OperationalLifecycle,
} from "./types";

export interface ChipTokens {
  /** Chip background. */
  bg: string;
  /** Chip text. */
  fg: string;
  /** Leading dot (omit the dot when undefined). */
  dot?: string;
}

/** Operational-lifecycle chip treatment (mockup `OP` map). Calm blues
 *  and indigos for DisputeDesk's own work; red only for `lost`. */
export const LIFECYCLE_CHIP: Record<OperationalLifecycle, ChipTokens> = {
  building_evidence: { bg: "#E0F2FE", fg: "#075985", dot: "#0284C7" },
  monitoring: { bg: "#E0F2FE", fg: "#075985", dot: "#0284C7" },
  pack_prepared: { bg: "#E0E7FF", fg: "#3730A3", dot: "#4F46E5" },
  saved_to_shopify: { bg: "#E0E7FF", fg: "#3730A3", dot: "#4F46E5" },
  under_review: { bg: "#F1F2F3", fg: "#4B5563", dot: "#6B7280" },
  won: { bg: "#D1FAE5", fg: "#065F46", dot: "#059669" },
  lost: { bg: "#FEE2E2", fg: "#991B1B", dot: "#DC2626" },
  closed: { bg: "#F1F2F3", fg: "#4B5563", dot: "#9CA3AF" },
};

/** Evidence-strength chip treatment (mockup `EV` map). Neutral —
 *  weakness is never alarming (`not_assessed`/`weak` are grey, not
 *  red). The list surface uses `fg` as plain text color. */
export const STRENGTH_CHIP: Record<EvidenceStrength, ChipTokens> = {
  strong: { bg: "#D1FAE5", fg: "#065F46" },
  moderate: { bg: "#FEF3C7", fg: "#92400E" },
  weak: { bg: "#F3F4F6", fg: "#4B5563" },
  not_assessed: { bg: "#F3F4F6", fg: "#4B5563" },
};

/** Merchant-attention pill treatment (mockup `ATT` map + plan §5
 *  graded hierarchy — `blocking` is the amber rung the mockup reserves
 *  for genuine warnings). */
export const ATTENTION_CHIP: Record<MerchantAttention, ChipTokens> = {
  none: { bg: "#F1F2F3", fg: "#4B5563", dot: "#9CA3AF" },
  opportunity: { bg: "#E0F2FE", fg: "#075985", dot: "#0284C7" },
  recommended: { bg: "#E0F2FE", fg: "#075985", dot: "#0284C7" },
  requested: { bg: "#DBEAFE", fg: "#1E40AF", dot: "#1D4ED8" },
  blocking: { bg: "#FEF3C7", fg: "#92400E", dot: "#D97706" },
  technical_error: { bg: "#FEE2E2", fg: "#991B1B", dot: "#DC2626" },
};

export interface RowEmphasisTokens {
  /** Row background tint. */
  bg: string;
  /** Left-edge stripe color (inset box-shadow / border). */
  stripe: string;
}

/**
 * Row emphasis — driven by attention ONLY (plan §5 graded hierarchy):
 *   opportunity/recommended → light optional tint
 *   requested               → clear Action-required treatment
 *   blocking                → stronger warning treatment
 *   technical_error         → error treatment
 * `none` → no emphasis. Never highlight for active/weak/editable/
 * monitoring/saved.
 *
 * A deadline risk on a case already carrying `blocking`/`requested`
 * raises it to the `blocking` treatment — deadline risk is emphasis,
 * never a standalone attention value.
 */
export const ATTENTION_ROW_EMPHASIS: Partial<
  Record<MerchantAttention, RowEmphasisTokens>
> = {
  opportunity: { bg: "#F6F9FF", stripe: "#93C5FD" },
  recommended: { bg: "#F6F9FF", stripe: "#93C5FD" },
  // Clear Action-required treatment — visibly stronger than the light
  // optional tint (plan §5.4: a concrete merchant task must not read
  // like a suggestion). Saturated tint + dark stripe.
  requested: { bg: "#DBEAFE", stripe: "#1D4ED8" },
  blocking: { bg: "#FFFAF1", stripe: "#D97706" },
  technical_error: { bg: "#FEF6F5", stripe: "#DC2626" },
};

/** Outcome pill treatment (list "Outcome" column). */
export const OUTCOME_CHIP: Record<string, ChipTokens> = {
  won: { bg: "#D1FAE5", fg: "#065F46" },
  lost: { bg: "#FEE2E2", fg: "#991B1B" },
  closed: { bg: "#F1F2F3", fg: "#4B5563" },
  pending: { bg: "#F1F2F3", fg: "#4B5563" },
};
