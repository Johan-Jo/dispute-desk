/**
 * One order, several real disputes — marked, not left looking like a duplicate.
 *
 * THE REPORT (2026-09-03). Two rows in the list read `#92389 · Lisa Oestereich
 * · Product Not Received`, differing only in amount (€55.95 / €50.36). That
 * looks exactly like duplicate ingest, and was reported as such.
 *
 * IT WAS NOT A BUG. Verified against Shopify's Admin API: order #92389 was paid
 * in TWO card transactions (55.95 + 50.36 = 106.31, the order total, two line
 * items), and the cardholder disputed both. Shopify returns two distinct
 * disputes — 14263058766 and 14263025998 — each NEEDS_RESPONSE, each carrying
 * its own transaction's amount, filed 2½ minutes apart. Both need their own
 * response by the same deadline.
 *
 * Platform-wide: 31 orders carry multiple disputes (63 total; 3 with two OPEN
 * at once). EVERY one has distinct dispute GIDs and distinct amounts — the
 * split-payment shape. A true duplicate would repeat an amount; none do.
 *
 * So the defect was never in the data, only in a list that keys a row visually
 * on the order and leaves the reader to infer the rest.
 */

import { describe, expect, it } from "vitest";
import {
  orderDisputeCounts,
  type Dispute,
} from "@/app/(embedded)/app/disputes/disputeListHelpers";

function d(over: Partial<Dispute> & { id: string }): Dispute {
  return {
    order_gid: null,
    order_name: null,
    ...over,
  } as Dispute;
}

/** #92389 exactly as it sits in prod. */
const ORDER_92389 = "gid://shopify/Order/8680215380302";
const SPLIT_PAYMENT = [
  d({ id: "18eeeb7e", order_gid: ORDER_92389, order_name: "#92389" }),
  d({ id: "a01dc3a9", order_gid: ORDER_92389, order_name: "#92389" }),
];

describe("#92389 — two real disputes on one order", () => {
  it("marks both rows with their position", () => {
    const counts = orderDisputeCounts(SPLIT_PAYMENT);
    expect(counts.get("18eeeb7e")).toEqual({ index: 1, total: 2 });
    expect(counts.get("a01dc3a9")).toEqual({ index: 2, total: 2 });
  });

  it("keeps list order, so the marker matches what the reader sees", () => {
    const reversed = [...SPLIT_PAYMENT].reverse();
    const counts = orderDisputeCounts(reversed);
    expect(counts.get("a01dc3a9")!.index).toBe(1);
    expect(counts.get("18eeeb7e")!.index).toBe(2);
  });
});

describe("only genuine siblings are marked", () => {
  it("a lone dispute on an order gets no marker", () => {
    const counts = orderDisputeCounts([
      d({ id: "solo", order_gid: "gid://shopify/Order/1", order_name: "#1" }),
    ]);
    expect(counts.size).toBe(0);
  });

  it("different orders are never merged, even on a shared display name", () => {
    // `order_name` is a display string; `order_gid` is the identity. Grouping
    // on the name alone would fabricate a relationship between real orders.
    const counts = orderDisputeCounts([
      d({ id: "a", order_gid: "gid://shopify/Order/1", order_name: "#100" }),
      d({ id: "b", order_gid: "gid://shopify/Order/2", order_name: "#100" }),
    ]);
    expect(counts.size).toBe(0);
  });

  it("falls back to the name only when no gid exists", () => {
    const counts = orderDisputeCounts([
      d({ id: "a", order_name: "#77" }),
      d({ id: "b", order_name: "#77" }),
    ]);
    expect(counts.get("a")).toEqual({ index: 1, total: 2 });
  });

  it("rows with no order identity at all are skipped, never grouped together", () => {
    // Two unidentifiable rows share nothing; treating null as a key would
    // group every such row into one fictitious order.
    const counts = orderDisputeCounts([d({ id: "a" }), d({ id: "b" })]);
    expect(counts.size).toBe(0);
  });

  it("handles three or more on one order", () => {
    const counts = orderDisputeCounts([
      d({ id: "a", order_gid: "g", order_name: "#5" }),
      d({ id: "b", order_gid: "g", order_name: "#5" }),
      d({ id: "c", order_gid: "g", order_name: "#5" }),
    ]);
    expect(counts.get("c")).toEqual({ index: 3, total: 3 });
  });

  it("marks siblings without disturbing unrelated rows in the same list", () => {
    const counts = orderDisputeCounts([
      ...SPLIT_PAYMENT,
      d({ id: "other", order_gid: "gid://shopify/Order/999", order_name: "#999" }),
    ]);
    expect(counts.has("other")).toBe(false);
    expect(counts.size).toBe(2);
  });

  it("is empty for an empty list", () => {
    expect(orderDisputeCounts([]).size).toBe(0);
  });
});
