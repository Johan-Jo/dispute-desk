/**
 * Saves the platform never confirmed forwarding.
 *
 * ── The gap ──
 *
 * `submission_state` reaches `submitted_confirmed` only when a dispute snapshot
 * carries Shopify's `evidenceSentOn` (see `applyDisputeSnapshot.ts`). Until
 * then a dispute sits at `saved_to_shopify`: we attached the evidence and
 * verified the readback, and nothing tells us the platform passed it on.
 *
 * Nothing was watching that state. `defence-package-deadline-submit` scans
 * `evidence_saved_to_shopify_at IS NULL` — the disputes where we have not filed
 * — so a dispute that HAS been saved is invisible to it by construction. Two
 * prod disputes went all the way to a decision that way (cay-collective, won;
 * surasvenne, lost), and the post-outcome analyser could only report them
 * afterwards, which is the wrong end of the deadline to learn it.
 *
 * ── What this does and does not claim ──
 *
 * An unconfirmed save is NOT proof that nothing reached the issuer. Shopify may
 * forward without reporting promptly, and one of the two cases was won. The
 * honest statement is that we cannot show it was forwarded, and that is worth
 * surfacing while the deadline can still be met.
 *
 * Hence the grace window: a save made minutes ago has not failed, it is simply
 * young. Only a save old enough that confirmation should have arrived is worth
 * anyone's attention.
 */

/** How long a save may go unconfirmed before it is worth reporting. */
export const CONFIRMATION_GRACE_HOURS = 24;

/** Inside this many hours of the deadline, an unconfirmed save is urgent. */
export const DUE_SOON_HOURS = 48;

export interface DisputeSaveRow {
  id: string;
  shop_id: string;
  evidence_saved_to_shopify_at: string | null;
  submitted_at: string | null;
  submission_state: string | null;
  due_at: string | null;
  final_outcome: string | null;
}

export type UnconfirmedSeverity = "past_deadline" | "due_soon" | "watch";

export interface UnconfirmedSave {
  disputeId: string;
  shopId: string;
  savedAt: string;
  dueAt: string | null;
  hoursSinceSave: number;
  hoursToDeadline: number | null;
  severity: UnconfirmedSeverity;
}

const HOUR = 3600_000;

function hoursBetween(from: number, to: number): number {
  return (to - from) / HOUR;
}

/**
 * Which saved-but-unconfirmed disputes are worth reporting, most urgent first.
 *
 * Pure so the thresholds can be exercised without a database or a clock.
 */
export function classifyUnconfirmedSaves(
  rows: readonly DisputeSaveRow[],
  now: Date,
): UnconfirmedSave[] {
  const nowMs = now.getTime();
  const out: UnconfirmedSave[] = [];

  for (const r of rows) {
    // Already confirmed forwarded — nothing to say.
    if (r.submitted_at) continue;
    if (r.submission_state === "submitted_confirmed") continue;
    // A decided dispute is past the point where surfacing helps; the
    // post-outcome analyser owns those.
    if (r.final_outcome) continue;
    if (!r.evidence_saved_to_shopify_at) continue;

    const savedMs = Date.parse(r.evidence_saved_to_shopify_at);
    if (Number.isNaN(savedMs)) continue;

    const hoursSinceSave = hoursBetween(savedMs, nowMs);
    // A young save has not failed. It is young.
    if (hoursSinceSave < CONFIRMATION_GRACE_HOURS) continue;

    const dueMs = r.due_at ? Date.parse(r.due_at) : NaN;
    const hoursToDeadline = Number.isNaN(dueMs) ? null : hoursBetween(nowMs, dueMs);

    let severity: UnconfirmedSeverity = "watch";
    if (hoursToDeadline !== null) {
      if (hoursToDeadline < 0) severity = "past_deadline";
      else if (hoursToDeadline <= DUE_SOON_HOURS) severity = "due_soon";
    }

    out.push({
      disputeId: r.id,
      shopId: r.shop_id,
      savedAt: r.evidence_saved_to_shopify_at,
      dueAt: r.due_at,
      hoursSinceSave: Math.round(hoursSinceSave),
      hoursToDeadline: hoursToDeadline === null ? null : Math.round(hoursToDeadline),
      severity,
    });
  }

  // Urgency order, then the longest-waiting first inside each band.
  const RANK: Record<UnconfirmedSeverity, number> = {
    past_deadline: 0,
    due_soon: 1,
    watch: 2,
  };
  return out.sort((a, b) => {
    const r = RANK[a.severity] - RANK[b.severity];
    if (r !== 0) return r;
    return b.hoursSinceSave - a.hoursSinceSave;
  });
}

/** Counts for the audit payload, so a run is legible without re-querying. */
export function summariseUnconfirmed(
  saves: readonly UnconfirmedSave[],
): Record<UnconfirmedSeverity, number> {
  const out: Record<UnconfirmedSeverity, number> = {
    past_deadline: 0,
    due_soon: 0,
    watch: 0,
  };
  for (const s of saves) out[s.severity] += 1;
  return out;
}
