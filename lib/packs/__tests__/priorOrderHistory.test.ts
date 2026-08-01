/**
 * loadPriorOrderHistory — the verification the pack never used to do.
 *
 * The asymmetry under test: "has prior disputes" needs one row to prove,
 * "is dispute-free" needs full coverage. Anything short of that is null
 * (unknown), and the collector then omits the flag entirely.
 */

import { describe, expect, it, vi } from "vitest";
import { loadPriorOrderHistory } from "../priorOrderHistory";

/** Minimal PostgREST-shaped stub: `.from(t).select().eq().eq().limit()`
 *  and `.from(t).select().eq().in()` both resolve to `{ data, error }`. */
function makeSb(tables: {
  shopify_orders?: { data: unknown[] | null; error?: { message: string } | null };
  disputes?: { data: unknown[] | null; error?: { message: string } | null };
}) {
  const builder = (result: { data: unknown[] | null; error?: { message: string } | null }) => {
    const chain: Record<string, unknown> = {};
    const ret = () => chain;
    chain.select = ret;
    chain.eq = ret;
    chain.in = () => Promise.resolve({ data: result.data, error: result.error ?? null });
    chain.limit = () => Promise.resolve({ data: result.data, error: result.error ?? null });
    return chain;
  };
  return {
    from: (table: string) =>
      builder(
        table === "disputes"
          ? (tables.disputes ?? { data: [], error: null })
          : (tables.shopify_orders ?? { data: [], error: null }),
      ),
  } as never;
}

const BASE = {
  shopId: "shop-1",
  orderGid: "gid://shopify/Order/900",
  customerGid: "gid://shopify/Customer/1",
  disputedProcessedAt: "2026-07-03T04:19:53Z",
};

describe("loadPriorOrderHistory", () => {
  it("marks the history NOT dispute-free when a prior order was charged back", async () => {
    // The blume-box shape: nine orders, two already disputed.
    const r = await loadPriorOrderHistory({
      sb: makeSb({
        shopify_orders: {
          data: [
            { shopify_order_id: "gid://shopify/Order/100", processed_at: "2026-06-29T09:43:20Z" },
            { shopify_order_id: "gid://shopify/Order/200", processed_at: "2026-07-02T07:22:38Z" },
            { shopify_order_id: "gid://shopify/Order/300", processed_at: "2026-07-02T07:23:46Z" },
            { shopify_order_id: BASE.orderGid, processed_at: BASE.disputedProcessedAt },
          ],
          error: null,
        },
        disputes: {
          data: [
            { order_gid: "gid://shopify/Order/200" },
            { order_gid: "gid://shopify/Order/300" },
          ],
          error: null,
        },
      }),
      ...BASE,
      shopifyTotalOrders: 4,
    });
    expect(r?.priorOrders).toBe(3);
    expect(r?.disputedPriorOrders).toBe(2);
    expect(r?.priorUndisputedOrders).toBe(1);
    expect(r?.disputeFreeHistory).toBe(false);
  });

  it("confirms dispute-free ONLY with full coverage", async () => {
    const r = await loadPriorOrderHistory({
      sb: makeSb({
        shopify_orders: {
          data: [
            { shopify_order_id: "gid://shopify/Order/100", processed_at: "2026-01-02T00:00:00Z" },
            { shopify_order_id: "gid://shopify/Order/200", processed_at: "2026-02-02T00:00:00Z" },
            { shopify_order_id: BASE.orderGid, processed_at: BASE.disputedProcessedAt },
          ],
          error: null,
        },
        disputes: { data: [], error: null },
      }),
      ...BASE,
      shopifyTotalOrders: 3,
    });
    expect(r?.disputeFreeHistory).toBe(true);
    expect(r?.priorUndisputedOrders).toBe(2);
  });

  it("returns UNKNOWN when our order coverage is partial", async () => {
    // Shopify says 11 prior orders; we ingested 2. The nine we never saw
    // could each carry a chargeback — we must not claim clean.
    const r = await loadPriorOrderHistory({
      sb: makeSb({
        shopify_orders: {
          data: [
            { shopify_order_id: "gid://shopify/Order/100", processed_at: "2026-01-02T00:00:00Z" },
            { shopify_order_id: "gid://shopify/Order/200", processed_at: "2026-02-02T00:00:00Z" },
          ],
          error: null,
        },
        disputes: { data: [], error: null },
      }),
      ...BASE,
      shopifyTotalOrders: 12,
    });
    expect(r?.disputeFreeHistory).toBeNull();
    expect(r?.priorOrders).toBe(2);
  });

  // Regression — blume-box 0f53431d (order #352552, placed 07:22). The
  // account's other chargebacks sit on orders placed 07:23 and the next
  // day, so scoping the dispute-free CLAIM to strictly-prior orders
  // called a three-chargeback account "dispute-free" — and that claim
  // was half of what scored the case Strong.
  it("a chargeback on a LATER order still falsifies the dispute-free claim", async () => {
    const r = await loadPriorOrderHistory({
      sb: makeSb({
        shopify_orders: {
          data: [
            { shopify_order_id: "gid://shopify/Order/100", processed_at: "2026-07-02T05:03:32Z" },
            { shopify_order_id: BASE.orderGid, processed_at: BASE.disputedProcessedAt },
            // One minute later — and charged back.
            { shopify_order_id: "gid://shopify/Order/999", processed_at: "2026-07-03T04:19:53Z" },
          ],
          error: null,
        },
        disputes: { data: [{ order_gid: "gid://shopify/Order/999" }], error: null },
      }),
      ...BASE,
      disputedProcessedAt: "2026-07-02T07:22:38Z",
      shopifyTotalOrders: 3,
    });
    // The COUNT stays time-scoped and honest: one order came before.
    expect(r?.priorOrders).toBe(1);
    expect(r?.disputedPriorOrders).toBe(0);
    // The CLAIM is not time-scoped.
    expect(r?.disputeFreeHistory).toBe(false);
  });

  it("the disputed order itself never counts against its own account", async () => {
    // Otherwise every dispute would trivially read "has_disputes".
    const r = await loadPriorOrderHistory({
      sb: makeSb({
        shopify_orders: {
          data: [
            { shopify_order_id: "gid://shopify/Order/100", processed_at: "2026-01-02T00:00:00Z" },
            { shopify_order_id: BASE.orderGid, processed_at: BASE.disputedProcessedAt },
          ],
          error: null,
        },
        disputes: { data: [], error: null },
      }),
      ...BASE,
      shopifyTotalOrders: 2,
    });
    expect(r?.disputeFreeHistory).toBe(true);
  });

  it("a known chargeback beats partial coverage — false, not unknown", async () => {
    const r = await loadPriorOrderHistory({
      sb: makeSb({
        shopify_orders: {
          data: [
            { shopify_order_id: "gid://shopify/Order/100", processed_at: "2026-01-02T00:00:00Z" },
          ],
          error: null,
        },
        disputes: { data: [{ order_gid: "gid://shopify/Order/100" }], error: null },
      }),
      ...BASE,
      shopifyTotalOrders: 20,
    });
    expect(r?.disputeFreeHistory).toBe(false);
  });

  // Regression — the coverage test must compare ALL of the customer's
  // orders against Shopify's numberOfOrders, not strictly-before priors
  // against numberOfOrders-1. Measured on prod 2026-08-01: 11 of 14
  // "partial coverage" verdicts were this mistake, on shops whose order
  // ingest was 100% complete.
  it("a customer who ordered again LATER still counts as full coverage", async () => {
    const r = await loadPriorOrderHistory({
      sb: makeSb({
        shopify_orders: {
          data: [
            { shopify_order_id: "gid://shopify/Order/100", processed_at: "2026-06-01T00:00:00Z" },
            { shopify_order_id: BASE.orderGid, processed_at: BASE.disputedProcessedAt },
            { shopify_order_id: "gid://shopify/Order/999", processed_at: "2026-07-20T00:00:00Z" },
          ],
          error: null,
        },
        disputes: { data: [], error: null },
      }),
      ...BASE,
      // Shopify counts all three; only one is genuinely prior.
      shopifyTotalOrders: 3,
    });
    expect(r?.priorOrders).toBe(1);
    expect(r?.disputeFreeHistory).toBe(true);
  });

  it("orders placed AFTER the disputed one are not 'prior'", async () => {
    const r = await loadPriorOrderHistory({
      sb: makeSb({
        shopify_orders: {
          data: [
            { shopify_order_id: "gid://shopify/Order/100", processed_at: "2026-07-03T04:14:26Z" },
            { shopify_order_id: BASE.orderGid, processed_at: BASE.disputedProcessedAt },
            // Two minutes later — Shopify's numberOfOrders counts it, we don't.
            { shopify_order_id: "gid://shopify/Order/999", processed_at: "2026-07-03T04:21:01Z" },
          ],
          error: null,
        },
        disputes: { data: [], error: null },
      }),
      ...BASE,
      shopifyTotalOrders: 3,
    });
    expect(r?.priorOrders).toBe(1);
  });

  it("guest checkout yields null (nothing to verify)", async () => {
    const r = await loadPriorOrderHistory({
      sb: makeSb({}),
      ...BASE,
      customerGid: null,
      shopifyTotalOrders: 3,
    });
    expect(r).toBeNull();
  });

  it("a failed read yields null, never an optimistic clean verdict", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await loadPriorOrderHistory({
      sb: makeSb({
        shopify_orders: { data: null, error: { message: "boom" } },
      }),
      ...BASE,
      shopifyTotalOrders: 3,
    });
    expect(r).toBeNull();
    warn.mockRestore();
  });

  it("reports a verified ZERO when the account has no prior orders", async () => {
    // Emitting 0 is the point: it stops effectivePriorOrders falling
    // back to `totalOrders - 1`, which counts later orders as history.
    const r = await loadPriorOrderHistory({
      sb: makeSb({
        shopify_orders: {
          data: [
            { shopify_order_id: BASE.orderGid, processed_at: BASE.disputedProcessedAt },
            { shopify_order_id: "gid://shopify/Order/999", processed_at: "2026-07-20T00:00:00Z" },
          ],
          error: null,
        },
      }),
      ...BASE,
      shopifyTotalOrders: 2,
    });
    expect(r?.priorOrders).toBe(0);
    expect(r?.priorUndisputedOrders).toBe(0);
    expect(r?.disputeFreeHistory).toBe(true);
  });

  it("no priors AND partial coverage stays unknown", async () => {
    const r = await loadPriorOrderHistory({
      sb: makeSb({
        shopify_orders: {
          data: [{ shopify_order_id: BASE.orderGid, processed_at: BASE.disputedProcessedAt }],
          error: null,
        },
      }),
      ...BASE,
      shopifyTotalOrders: 6,
    });
    expect(r?.priorOrders).toBe(0);
    expect(r?.disputeFreeHistory).toBeNull();
  });
});
