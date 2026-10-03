/**
 * A dispute Shopify has already decided or closed takes no more evidence.
 *
 * `due_at` is never cleared on close, so a deadline query that reads only the
 * due date still reaches a decided dispute. cay-collective #15538 was won on
 * 2026-09-25 and carried `review_state = "approved"`; on its due date
 * (2026-10-03) the deadline cron picked it up through the approved arm of its
 * status filter, found no package to file, and told the merchant and the admin
 * that "DisputeDesk filed nothing".
 *
 * A reopened dispute has both columns cleared (the earlier result moves to
 * `previous_final_outcome`), so it is open again here.
 */
export function isDecidedDispute(d: {
  final_outcome?: string | null;
  closed_at?: string | null;
}): boolean {
  return d.final_outcome != null || d.closed_at != null;
}
