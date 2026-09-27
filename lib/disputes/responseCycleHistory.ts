/**
 * Reconstruct past response cycles from what we recorded at the time, for
 * the one-off repair (plan B3/B4, scripts/shopify/reconcile-response-cycles.ts).
 *
 * Pure: takes the dispute's webhook payload history (or, when webhook history
 * was cleaned up, its dispute_events) plus the current row, and returns the
 * cycles to hand to `reconcile_response_cycle`. It never writes.
 *
 * The anchors MUST match what the live path (`applyDisputeSnapshot` →
 * `responseAnchorKey`) would derive for the same cycle, or one cycle becomes
 * two ledger rows. So the LAST reopen anchors on the dispute row exactly as
 * the live path does, whenever the row still describes that response.
 */

import {
  hasRealDeadline,
  responseAnchorKey,
  type PriorResponseRow,
  type ResponseCycleTrigger,
} from "./responseCycle";

/** One observed Shopify state, oldest first. */
export interface ObservedState {
  /** When we observed it (webhook received_at / dispute_event event_at). */
  at: string;
  status: string | null;
  type?: string | null;
  evidenceDueBy?: string | null;
  evidenceSentOn?: string | null;
}

export interface PlannedCycle {
  anchorKey: string;
  startedAt: string;
  trigger: ResponseCycleTrigger;
}

export interface HistoryPlan {
  cycles: PlannedCycle[];
  /** First observed chargeback after an inquiry, if any. */
  escalatedAt: string | null;
}

function toMs(ts: string | null | undefined): number {
  return ts ? new Date(ts).getTime() : NaN;
}

function anchorFromInstant(ts: string): string | null {
  return responseAnchorKey({
    status: null,
    due_at: null,
    submitted_at: ts,
    submission_state: null,
  });
}

/**
 * @param states   Observed states, any order (sorted here).
 * @param row      The dispute row as it is NOW (anchor fallback for the last
 *                 reopen, the same rule the live path uses).
 * @param requireDeadline  Webhook payloads carry `evidence_due_by`, so a
 *                 reopen needs a real deadline there. dispute_events do not
 *                 carry it; pass false for that source.
 */
export function planHistoryCycles(
  states: ObservedState[],
  row: PriorResponseRow,
  requireDeadline = true,
): HistoryPlan {
  return planHistoryCyclesAgainstLedger(states, row, [], requireDeadline);
}

/**
 * As `planHistoryCycles`, minus the cycles the ledger already holds.
 *
 * A reopen the live path (or an earlier repair run) already recorded may
 * carry a different anchor than history would now derive — after the reset
 * the row no longer holds the response it followed. So a planned cycle is
 * treated as ALREADY RECORDED when a ledger row started inside its window
 * [its start, the next planned start). This is what makes "live, then
 * history" land on the same single row as "history, then live".
 */
export function planHistoryCyclesAgainstLedger(
  states: ObservedState[],
  row: PriorResponseRow,
  existingStarts: string[],
  requireDeadline = true,
): HistoryPlan {
  const sorted = [...states].sort((a, b) => toMs(a.at) - toMs(b.at));
  const cycles: PlannedCycle[] = [];
  let escalatedAt: string | null = null;

  // The row's recorded response (the same fields the live path anchors on).
  // It can only belong to the reopen whose window contains it.
  const rowResponseTs = row.submitted_at ?? row.evidence_saved_to_shopify_at ?? null;
  const rowResponseMs = toMs(rowResponseTs);

  let prevStatus: string | null = null;
  let prevType: string | null = null;
  let lastSent: string | null = null;
  let windowStartMs = -Infinity;
  let escalatedSinceResponse = false;

  for (const s of sorted) {
    if (prevType === "inquiry" && s.type === "chargeback") {
      if (!escalatedAt) escalatedAt = s.at;
      escalatedSinceResponse = true;
    }

    // Only a RECORDED response counts (see `hasPriorResponse`): an
    // evidence_sent_on in the payload, or the row's recorded response when it
    // falls inside this window. Status flips alone are buyer/merchant
    // messaging on inquiries, not a response that a reopen could invalidate.
    if (s.evidenceSentOn) lastSent = s.evidenceSentOn;

    const transitionsIntoNeedsResponse =
      s.status === "needs_response" &&
      prevStatus !== null &&
      prevStatus !== "needs_response" &&
      (!requireDeadline || hasRealDeadline(s.evidenceDueBy));

    if (transitionsIntoNeedsResponse) {
      const sMs = toMs(s.at);
      const rowInWindow =
        rowResponseTs && rowResponseMs > windowStartMs && rowResponseMs <= sMs ? rowResponseTs : null;
      const anchorTs = lastSent ?? rowInWindow;
      const anchorKey = anchorTs ? anchorFromInstant(anchorTs) : null;
      if (anchorKey) {
        cycles.push({
          anchorKey,
          startedAt: s.at,
          trigger: escalatedSinceResponse ? "escalation" : "reopen",
        });
        lastSent = null;
        windowStartMs = sMs;
        escalatedSinceResponse = false;
      }
    }

    prevStatus = s.status;
    if (s.type) prevType = s.type;
  }

  // The live path anchors on the row (`responseAnchorKey`). Where the row's
  // recorded response belongs to a planned cycle, use exactly that key so the
  // two paths cannot disagree on formatting or precedence. Webhook payloads
  // often lack an evidence_sent_on the GraphQL sync did record (#99348).
  const liveAnchor = responseAnchorKey(row);
  if (liveAnchor && rowResponseTs) {
    for (let i = 0; i < cycles.length; i++) {
      const from = i === 0 ? -Infinity : toMs(cycles[i - 1]!.startedAt);
      if (rowResponseMs > from && rowResponseMs <= toMs(cycles[i]!.startedAt)) {
        cycles[i]!.anchorKey = liveAnchor;
      }
    }
  }

  const existing = existingStarts.map(toMs).filter(Number.isFinite);
  const fresh = cycles.filter((c, i) => {
    const from = toMs(c.startedAt);
    const to = i + 1 < cycles.length ? toMs(cycles[i + 1]!.startedAt) : Infinity;
    return !existing.some((e) => e >= from && e < to);
  });

  return { cycles: fresh, escalatedAt };
}
