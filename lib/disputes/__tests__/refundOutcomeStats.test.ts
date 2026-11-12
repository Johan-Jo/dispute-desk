/**
 * The definition behind "X of Y inquiries that were refunded closed in your favour".
 * Shapes follow the whj8db-1q cases of 2026-11-04 / 11-12: refund clicked, inquiry opens inside the pending
 * day, refund settles, the inquiry closes seconds later.
 */
import { describe, expect, it } from "vitest";
import { computeRefundOutcomeStats, MIN_REFUND_STATS_CASES, quotableRefundStats, type RefundOutcomeRow } from "../refundOutcomeStats";

const row = (patch: Partial<RefundOutcomeRow> = {}): RefundOutcomeRow => ({
  outcome: "won",
  initiatedAt: "2026-11-11T20:00:00Z",
  closedAt: "2026-11-12T13:47:17Z",
  escalatedAt: null,
  settlements: [{ settledAt: "2026-11-12T13:47:04Z", amount: 529 }],
  ...patch,
});

describe("computeRefundOutcomeStats", () => {
  it("a refund that settled after the inquiry opened, closing it seconds later, is a refunded win", () => {
    const s = computeRefundOutcomeStats([row()]);
    expect(s.refunded).toEqual({ won: 1, decided: 1 });
    expect(s.unrefunded).toEqual({ escalated: 0, total: 0 });
  });

  it("a refund that settled BEFORE the inquiry opened did not close it: the inquiry counts as unrefunded", () => {
    const s = computeRefundOutcomeStats([row({ settlements: [{ settledAt: "2026-11-05T10:00:00Z", amount: 100 }] })]);
    expect(s.refunded.decided).toBe(0);
    expect(s.unrefunded.total).toBe(1);
  });

  it("a refund that settled after the inquiry ended does not count either (#23568: refunded after the chargeback was won)", () => {
    const s = computeRefundOutcomeStats([row({ settlements: [{ settledAt: "2026-11-13T15:19:11Z", amount: 630 }] })]);
    expect(s.refunded.decided).toBe(0);
    expect(s.unrefunded.total).toBe(1);
  });

  it("a settlement within 5 minutes after the close still counts (clock skew), 6 minutes does not", () => {
    expect(computeRefundOutcomeStats([row({ settlements: [{ settledAt: "2026-11-12T13:52:00Z", amount: 1 }] })]).refunded.decided).toBe(1);
    expect(computeRefundOutcomeStats([row({ settlements: [{ settledAt: "2026-11-12T13:53:30Z", amount: 1 }] })]).refunded.decided).toBe(0);
  });

  it("refunded but escalated anyway is decided and not a win: the figure is not inflated", () => {
    const s = computeRefundOutcomeStats([
      row({ outcome: null, closedAt: null, escalatedAt: "2026-11-12T14:00:00Z", settlements: [{ settledAt: "2026-11-12T13:00:00Z", amount: 100 }] }),
    ]);
    expect(s.refunded).toEqual({ won: 0, decided: 1 });
  });

  it("refunded then lost is decided, not won", () => {
    expect(computeRefundOutcomeStats([row({ outcome: "lost" })]).refunded).toEqual({ won: 0, decided: 1 });
  });

  it("unrefunded: escalated ones are counted against the total, and a no-refund WIN is in the total but not escalated", () => {
    const s = computeRefundOutcomeStats([
      row({ settlements: [], outcome: null, closedAt: null, escalatedAt: "2026-12-10T10:00:00Z" }),
      row({ settlements: [], outcome: "won", closedAt: "2026-11-12T13:47:17Z" }),
      row({ settlements: [], outcome: "lost" }),
    ]);
    expect(s.unrefunded).toEqual({ escalated: 1, total: 3 });
  });

  it("a row never read from Shopify, an open one and one without dates are excluded, never assumed unrefunded", () => {
    const s = computeRefundOutcomeStats([
      row({ settlements: null }),
      row({ outcome: null, closedAt: null, escalatedAt: null }),
      row({ initiatedAt: null }),
      row({ closedAt: null }),
    ]);
    expect(s).toEqual({ refunded: { won: 0, decided: 0 }, unrefunded: { escalated: 0, total: 0 } });
  });
});

describe("quotableRefundStats", () => {
  it("offers a figure only from the minimum number of cases", () => {
    const nine = computeRefundOutcomeStats(Array.from({ length: MIN_REFUND_STATS_CASES - 1 }, () => row()));
    expect(quotableRefundStats(nine).refunded).toBeNull();
    const ten = computeRefundOutcomeStats(Array.from({ length: MIN_REFUND_STATS_CASES }, () => row()));
    expect(quotableRefundStats(ten).refunded).toEqual({ won: 10, decided: 10 });
    expect(quotableRefundStats(ten).unrefunded).toBeNull();
  });
});
