/**
 * Read-time filter for spurious `due_date_changed` timeline/activity events.
 *
 * `dispute_events` is append-only (a DB trigger rejects UPDATE/DELETE), so
 * bad events can't be deleted — they're hidden at the read boundary instead.
 * Two classes of spurious event exist:
 *
 *  1. Same-instant: an early sync compared raw ISO strings, so a Shopify
 *     response with a non-UTC offset produced a "change" against our stored
 *     UTC value for the same instant. (old_due_at and new_due_at are equal ms.)
 *
 *  2. Epoch target: Shopify returns `evidenceDueBy = 1970-01-01` (epoch) for
 *     some disputes; before the ingestion fix (sanitizeDueAt) the sync wrote it
 *     and emitted a "Due date changed to 1969-12-31" event. These flooded the
 *     activity feed for cay-collective on 2026-07-03.
 *
 * The ingestion fix stops NEW events of class 2; this hides the ones already
 * written (and any future same-instant edge).
 */

/** Any due date parsing to before this is an epoch/coercion artifact. */
const MIN_MEANINGFUL_MS = Date.UTC(2000, 0, 1);

interface DueDateEventLike {
  event_type?: string | null;
  metadata_json?: { old_due_at?: string | null; new_due_at?: string | null } | null;
}

/**
 * True when a `due_date_changed` event should be HIDDEN from timeline/activity
 * feeds. Non-due-date events always return false (keep them).
 */
export function isSpuriousDueDateEvent(e: DueDateEventLike): boolean {
  if (e.event_type !== "due_date_changed") return false;
  const meta = e.metadata_json ?? {};
  const newMs = meta.new_due_at ? new Date(meta.new_due_at).getTime() : null;

  // Class 2: the new due date is an epoch/pre-2000 artifact.
  if (newMs !== null && Number.isFinite(newMs) && newMs < MIN_MEANINGFUL_MS) {
    return true;
  }

  // Class 1: old and new represent the same instant (timezone-only "change").
  if (meta.old_due_at && meta.new_due_at) {
    const oldMs = new Date(meta.old_due_at).getTime();
    if (
      Number.isFinite(oldMs) &&
      newMs !== null &&
      Number.isFinite(newMs) &&
      oldMs === newMs
    ) {
      return true;
    }
  }

  return false;
}

interface ActivityEventLike {
  event_type?: string | null;
  metadata_json?:
    | { reason?: string | null; old_due_at?: string | null; new_due_at?: string | null }
    | null;
}

/**
 * True when a `pack_blocked` event is the OBSOLETE tier-gate variant
 * (`reason: "feature_blocked"`). Auto-build is no longer tier-gated — free tier
 * builds against its credit ledger — so these events (65 written for
 * cay-collective during the 2026-07-02 historical import: "Auto-build is a paid
 * feature. Upgrade to Starter…") are stale and misleading. dispute_events is
 * append-only, so hide them at read time. Legitimate `pack_blocked` events
 * (quota_exceeded, auto_build_off) still show.
 */
export function isObsoletePackBlockedEvent(e: ActivityEventLike): boolean {
  if (e.event_type !== "pack_blocked") return false;
  return (e.metadata_json?.reason ?? null) === "feature_blocked";
}

/** Combined activity-feed hide predicate (spurious due-date + obsolete blocks). */
export function isHiddenActivityEvent(e: ActivityEventLike): boolean {
  return isSpuriousDueDateEvent(e) || isObsoletePackBlockedEvent(e);
}
