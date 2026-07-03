/**
 * Due-date sanity helper.
 *
 * A historical-import batch (cay-collective, 2026-07-02) wrote `due_at` as Unix
 * epoch (`1969-12-31` / `1970-01-01`, `epoch ≈ -86400`) for closed disputes that
 * have no evidence deadline, instead of `null`. That surfaced as a bogus "Dec 30"
 * deadline on the dashboard. The root cause is fixed at the writer + a backfill
 * nulls the bad rows, but this guard is a defensive belt so ANY epoch-ish value
 * (past or future import) is treated as "no deadline" in the UI rather than
 * rendered as a real date.
 *
 * A legitimate Shopify evidence deadline is always in the modern era; anything
 * before 2000 is a coercion artifact, not a real due date.
 */

const MIN_MEANINGFUL_MS = Date.UTC(2000, 0, 1);

/**
 * Returns the ISO string if it parses to a real, modern date; otherwise null.
 * Null/empty/epoch-artifact values all collapse to null.
 */
export function sanitizeDueAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < MIN_MEANINGFUL_MS) return null;
  return iso;
}

/** True when the value is a real, modern due date worth displaying. */
export function hasMeaningfulDueAt(iso: string | null | undefined): boolean {
  return sanitizeDueAt(iso) !== null;
}
