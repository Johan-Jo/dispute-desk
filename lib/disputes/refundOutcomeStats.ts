/**
 * What happened to this store's inquiries that were refunded, and to the ones that were not. ONE definition.
 *
 * The refund email may say "In your store, X of Y inquiries that were refunded closed in your favour", but
 * only from numbers a reader can reproduce, per store, from rows we keep. This is that arithmetic and nothing
 * else: no I/O, no copy.
 *
 * DEFINITIONS (docs/plans/pending-refund-advice.plan.md section 7)
 *  - Inquiry-origin: a dispute that was an inquiry (it closed as one, or escalated from one).
 *  - It ENDED when it closed (`closedAt`) or escalated to a chargeback (`escalatedAt`); an inquiry still open is
 *    not counted.
 *  - It was REFUNDED when a refund SETTLED after the inquiry opened and no later than 5 minutes after it ended
 *    (a refund settled BEFORE it opened did not close it: whj8db #23750). A refund started before the inquiry
 *    but settling after it opened counts: that is the usual shape (the customer disputes inside the ~24 h
 *    pending day). `settledAt` is `Refund.updatedAt` of a SUCCESS refund (lib/disputes/refundState.ts).
 *  - refunded.decided: refunded inquiries that ended (closed won/lost, or escalated anyway); refunded.won: those
 *    that closed in the merchant's favour. An inquiry that was refunded and still escalated is a "decided"
 *    that is not a win: the number is not inflated.
 *  - unrefunded.total: inquiries that ended with no refund settled in that window; unrefunded.escalated: those
 *    that became chargebacks. (Some inquiries also close WON with no refund at all: they are in `total` and
 *    not in `escalated`, so the figure is not made to look worse than it is.)
 *  - A row never read from Shopify (`settlements` null) is excluded, never assumed unrefunded.
 *
 * Below MIN_CASES a figure is not offered: a small sample says nothing about a store.
 */

export const MIN_REFUND_STATS_CASES = 10;
const SETTLE_SLACK_MS = 5 * 60 * 1000;

export interface RefundOutcomeRow {
  /** Shopify outcome when the dispute closed; null while open. */
  outcome: "won" | "lost" | null;
  initiatedAt: string | null;
  closedAt: string | null;
  /** `disputes.escalated_from_inquiry_at`. */
  escalatedAt: string | null;
  /** `dispute_refund_state.settlements`; null = never read. */
  settlements: Array<{ settledAt: string; amount: number }> | null;
}

export interface RefundOutcomeStats {
  refunded: { won: number; decided: number };
  unrefunded: { escalated: number; total: number };
}

const ts = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : Number.NaN);

export function computeRefundOutcomeStats(rows: RefundOutcomeRow[]): RefundOutcomeStats {
  const out: RefundOutcomeStats = { refunded: { won: 0, decided: 0 }, unrefunded: { escalated: 0, total: 0 } };

  for (const r of rows) {
    if (r.settlements === null) continue;
    const escalated = r.escalatedAt !== null;
    const endAt = ts(escalated ? r.escalatedAt : r.closedAt);
    const initiated = ts(r.initiatedAt);
    if (!Number.isFinite(endAt) || !Number.isFinite(initiated)) continue;
    // Closed rows must carry an outcome; an escalated one has ended by escalating.
    if (!escalated && r.outcome === null) continue;

    const refunded = r.settlements.some((s) => {
      const t = ts(s.settledAt);
      return Number.isFinite(t) && t > initiated && t <= endAt + SETTLE_SLACK_MS;
    });

    if (refunded) {
      out.refunded.decided++;
      if (!escalated && r.outcome === "won") out.refunded.won++;
    } else {
      out.unrefunded.total++;
      if (escalated) out.unrefunded.escalated++;
    }
  }
  return out;
}

/** The figures a store has enough cases to quote; each is omitted below the minimum. */
export function quotableRefundStats(s: RefundOutcomeStats): {
  refunded: RefundOutcomeStats["refunded"] | null;
  unrefunded: RefundOutcomeStats["unrefunded"] | null;
} {
  return {
    refunded: s.refunded.decided >= MIN_REFUND_STATS_CASES ? s.refunded : null,
    unrefunded: s.unrefunded.total >= MIN_REFUND_STATS_CASES ? s.unrefunded : null,
  };
}
