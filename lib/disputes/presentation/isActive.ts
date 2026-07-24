/**
 * Active-inventory membership — the verified allow-list, NOT a
 * `final_outcome === null` test.
 *
 * "No final outcome yet" is not proven equivalent to active: a dispute
 * can be administratively closed/withdrawn/expired with a null outcome
 * (plan §5/§12V). The allow-list below is the long-standing verified
 * definition (previously private to lib/disputes/metrics.ts) and
 * deliberately INCLUDES the under-review family — a dispute is active
 * until an outcome is received, so under-review cases appear in both
 * the "Active disputes" KPI and the "Under review" operational bucket.
 *
 * Dormant-inquiry exclusion (lib/disputes/dormantInquiry.ts) is applied
 * by callers that have the phase/due_at/initiated_at fields.
 */

/** `normalized_status` values that count as active inventory. */
export const ACTIVE_NORMALIZED_STATUSES: readonly string[] = [
  "new",
  "in_progress",
  "needs_review",
  "ready_to_submit",
  "action_needed",
  "submitted",
  "submitted_to_shopify",
  "waiting_on_issuer", // legacy value — still counted if present on old rows
  "submitted_to_bank",
];

const ACTIVE_SET = new Set(ACTIVE_NORMALIZED_STATUSES);

export function isActiveNormalizedStatus(
  normalizedStatus: string | null | undefined,
): boolean {
  return ACTIVE_SET.has(String(normalizedStatus ?? "new"));
}
