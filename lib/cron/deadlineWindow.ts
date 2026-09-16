/**
 * Deadline selection window for the two deadline crons — ONE definition,
 * shared, so the rebuild (06:00 UTC) and submit (08:00 UTC) routes cannot
 * drift apart.
 *
 * ── The bug this replaces ─────────────────────────────────────────────
 *
 * Both routes used to select `due_at` within the CALENDAR DAY in UTC:
 *
 *   startOfToday = Date.UTC(y, m, d, 0, 0, 0)
 *   endOfToday   = startOfToday + 24h
 *
 * while running at a fixed hour. For any deadline EARLIER than that hour
 * the window is useless in both directions:
 *
 *   - the run on the day BEFORE cannot see it (it is outside that day), and
 *   - the run on the day ITSELF fires after it has already expired.
 *
 * Dispute 4b81afe1 (#98141), due 2026-09-17 03:00 UTC, made it concrete:
 * the 09-16 08:00 run's window was [09-16 00:00 .. 09-17 00:00) — miss;
 * the 09-17 08:00 run's window was [09-17 00:00 .. 09-18 00:00) — hit, but
 * five hours after Shopify closed the response window.
 *
 * Measured on prod 2026-09-16: 321 disputes carry an 03:00 UTC deadline
 * (the second most common hour in the book), 319 of which were never
 * filed. That number is EXPOSURE, not losses — 201 of the 321 were won
 * anyway, most being inquiries Shopify resolves without merchant
 * evidence. But the mechanism is real and silent.
 *
 * The comment above the old code described a ROLLING window ("due today or
 * before tomorrow's 08:00 UTC"). The code implemented a calendar day. This
 * module implements what the comment always said.
 *
 * ── The rule ──────────────────────────────────────────────────────────
 *
 *   [ now , now + 24h + margin )
 *
 * Two properties it must keep:
 *
 *   1. NEVER select an already-expired deadline. Filing after expiry is
 *      wasted work and writes audit noise that cannot succeed. The lower
 *      bound is `now`, not the start of the day.
 *   2. The horizon must EXCEED the cron interval, so every deadline is
 *      seen by at least one run before it expires. With a daily cron the
 *      horizon must be > 24h; the margin absorbs a late or skipped run.
 *      Re-selection is harmless — both routes filter on
 *      `evidence_saved_to_shopify_at IS NULL`.
 *
 * The rebuild cron leads the submit cron by a wider margin, preserving the
 * existing 06:00 → 08:00 ordering intent: a pack should be rebuilt before
 * it is filed, never after.
 */

/** Extra horizon beyond 24h for the SUBMIT cron (08:00 UTC daily). Absorbs
 *  a late or skipped run without reaching so far forward that deadlines are
 *  picked up days early. */
export const SUBMIT_WINDOW_MARGIN_MS = 2 * 60 * 60 * 1000;

/** The REBUILD cron (06:00 UTC daily) leads by a further 2h, so anything
 *  the submit cron will consider tomorrow has already had a rebuild pass. */
export const REBUILD_WINDOW_MARGIN_MS = 4 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DeadlineWindow {
  /** Inclusive lower bound — always `now`, never earlier. */
  from: Date;
  /** Exclusive upper bound. */
  to: Date;
}

/**
 * Rolling selection window starting at `now`.
 *
 * @param now     current time (injected so tests can pin it)
 * @param marginMs extra horizon beyond 24h — use the SUBMIT_/REBUILD_
 *                 constants rather than a literal, so the two routes'
 *                 relative ordering stays visible in one place.
 */
export function deadlineWindow(now: Date, marginMs: number): DeadlineWindow {
  return {
    from: new Date(now.getTime()),
    to: new Date(now.getTime() + DAY_MS + marginMs),
  };
}
