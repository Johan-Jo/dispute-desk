/**
 * A dispute Shopify reopens after an outcome.
 *
 * Shopify can move a decided dispute back to `needs_response` or
 * `under_review` (a chargeback after a won inquiry, a won chargeback the bank
 * takes further). The sync used to treat any non-final status after an
 * outcome as stale and drop it, so the dispute stayed "won" in DisputeDesk
 * while Shopify showed it open (Mein Maison #94534, #94448, #99123, #92590,
 * 2026-09-29). Stale snapshots are already rejected by `shopify_updated_at`,
 * so a non-final status on a fresh snapshot is a real reopen.
 */

export const FINAL_STATUSES: ReadonlySet<string> = new Set(["won", "lost", "charge_refunded", "accepted"]);

export function isReopenAfterClose(args: {
  existingFinalOutcome: string | null | undefined;
  newStatus: string | null | undefined;
}): boolean {
  if (!args.existingFinalOutcome || args.existingFinalOutcome === "pending") return false;
  if (!args.newStatus) return false;
  return !FINAL_STATUSES.has(args.newStatus.toLowerCase());
}

/** The columns a reopen clears, and where the previous outcome is kept. */
export function reopenAfterCloseUpdate(existingFinalOutcome: string, at: string): Record<string, unknown> {
  return {
    final_outcome: null,
    closed_at: null,
    outcome_amount_recovered: null,
    outcome_amount_lost: null,
    outcome_source: null,
    outcome_confidence: null,
    previous_final_outcome: existingFinalOutcome,
    reopened_after_close_at: at,
  };
}

/**
 * Suffix for outcome ledger/effect keys after a reopen, so a second outcome
 * gets its own event and email instead of being deduplicated against the
 * first. Empty for a dispute that was never reopened (keys unchanged).
 */
export function outcomeKeySuffix(reopenedAfterCloseAt: string | null | undefined): string {
  if (!reopenedAfterCloseAt) return "";
  const ms = new Date(reopenedAfterCloseAt).getTime();
  return Number.isFinite(ms) ? `:after_reopen_${new Date(ms).toISOString().slice(0, 19)}Z` : "";
}

/**
 * Whether an open dispute shows the "Reopened" badge: Shopify reopened it
 * after an outcome, or asked for a new response after one was given
 * (response cycle 2+). A decided dispute never shows it.
 */
export function isReopenedOpenDispute(d: {
  final_outcome?: string | null;
  closed_at?: string | null;
  response_cycle?: number | null;
  reopened_after_close_at?: string | null;
}): boolean {
  if ((d.final_outcome && d.final_outcome !== "pending") || d.closed_at) return false;
  return (d.response_cycle ?? 1) >= 2 || d.reopened_after_close_at != null;
}
