/**
 * Canonical automation-mode type and normalization.
 *
 * DisputeDesk supports exactly two merchant-facing automation modes:
 *
 *   - "auto"   → build evidence pack AND submit automatically
 *   - "review" → build evidence pack, do NOT submit; merchant must review/submit
 *
 * Legacy stored rule values are normalized here at read boundaries:
 *
 *   - "auto_pack" → "auto"
 *   - "notify"    → "review"
 *   - "manual"    → "review"
 *   - "review"    → "review"
 *   - anything else (including missing/null/unknown) → "review"
 *
 * This is the ONE place legacy values are handled. All write paths must emit
 * only "auto" | "review"; the zod schema at the API boundary enforces that.
 *
 * Runtime states (needs_review, parked_for_review, submission_state,
 * pack_build_failed, …) are NOT modes and must not be conflated with this type.
 */

export type AutomationMode = "auto" | "review";

/** Union of every historical value that has ever appeared in `rules.action.mode`. */
export type LegacyRuleMode = "auto_pack" | "notify" | "manual" | "review";

/**
 * Resolve any stored/unknown value to the canonical two-mode union.
 * Default for unknown / missing inputs is "review" (never silently drop).
 */
export function normalizeMode(raw: unknown): AutomationMode {
  if (raw === "auto" || raw === "auto_pack") return "auto";
  return "review";
}
