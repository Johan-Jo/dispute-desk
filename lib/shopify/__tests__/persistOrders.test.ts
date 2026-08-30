/**
 * Tests for `persistOrders` — the shared writer behind the orders/*
 * webhook ingest, the daily reconcile cron and the historical backfill.
 *
 * The load-bearing case here is **round-trip count on the update path**.
 * Before 2026-08-30 this function issued one UPDATE per existing order
 * and one risk-hash SELECT per order. That is invisible on a first-time
 * import (all INSERTs, already batched) and pathological on a re-ingest:
 * measured at ~476 ms/order, i.e. 47.6 s to persist a 100-order page that
 * took 2.6 s to fetch from Shopify. A backfill/repair is entirely
 * UPDATEs, so it paid that cost on every row.
 *
 * Counting calls is therefore not an implementation detail in these
 * tests — it is the regression being guarded. A future refactor that
 * reintroduces a per-order loop must fail here.
 *
 * Coverage:
 *   1. Inserts stay batched (one insert call, no upsert).
 *   2. Updates are ONE upsert call regardless of batch size.
 *   3. Risk-hash lookup is ONE query for the whole batch, not per order.
 *   4. The update payload omits risk_*_initial (module contract 1) but
 *      carries the NOT NULL columns, so a conflict miss can still insert.
 *   5. Hash dedup still drops only hashes already stored for that same
 *      order, and still dedups within a single batch.
 *   6. Mixed insert/update batches report accurate counts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { persistOrders } from "../persistOrders";
import type {
  ShopifyOrderRow,
  ShopifyOrderRiskAssessmentRow,
} from "@/lib/shopify/queries/ordersForBackfill";

const mockGetClient = vi.mocked(getServiceClient);

const SHOP = "11111111-1111-1111-1111-111111111111";

function makeOrder(id: string, over: Partial<ShopifyOrderRow> = {}) {
  return {
    shop_id: SHOP,
    shopify_order_id: id,
    shopify_order_number: `#${id}`,
    processed_at: "2026-06-01T00:00:00Z",
    created_at_shopify: "2026-06-01T00:00:00Z",
    cancelled_at: null,
    fulfilled_at: null,
    currency: "EUR",
    order_total: 42,
    country: "DE",
    is_cross_border: false,
    distance_bucket: null,
    payment_gateway: "shopify_payments",
    financial_status: "PAID",
    fulfillment_status: "FULFILLED",
    cancel_reason: null,
    risk_level_initial: "LOW",
    risk_recommendation_initial: "ACCEPT",
    risk_provider_initial: "Shopify",
    fraud_protection_level: null,
    payment_method: "paypal",
    three_ds_authenticated: null,
    delivery_status: null,
    delivered_at_tracking: null,
    signed_by_name: null,
    tracking_source: null,
    customer_email: null,
    customer_shopify_id: null,
    ...over,
  } as unknown as ShopifyOrderRow;
}

function makeAssessment(orderId: string, hash: string) {
  return {
    shop_id: SHOP,
    shopify_order_id: orderId,
    risk_payload_hash: hash,
  } as unknown as ShopifyOrderRiskAssessmentRow;
}

interface Calls {
  ordersSelect: number;
  ordersInsert: number;
  ordersUpsert: number;
  assessSelect: number;
  assessInsert: number;
  upsertPayloads: Array<Record<string, unknown>[]>;
  upsertOptions: unknown[];
}

/** Minimal supabase-js double. `existingOrderIds` decides which orders
 *  the existence lookup reports as already stored; `existingHashes` is
 *  the stored (order -> hashes) map for the risk-assessment gate. */
function buildSb(opts: {
  existingOrderIds?: string[];
  existingHashes?: Array<{ shopify_order_id: string; risk_payload_hash: string }>;
}) {
  const calls: Calls = {
    ordersSelect: 0,
    ordersInsert: 0,
    ordersUpsert: 0,
    assessSelect: 0,
    assessInsert: 0,
    upsertPayloads: [],
    upsertOptions: [],
  };

  const sb = {
    from: (table: string) => {
      if (table === "shopify_orders") {
        return {
          select: () => {
            calls.ordersSelect++;
            const chain = {
              eq: () => chain,
              in: () =>
                Promise.resolve({
                  data: (opts.existingOrderIds ?? []).map((id) => ({
                    shopify_order_id: id,
                  })),
                  error: null,
                }),
            };
            return chain;
          },
          insert: (rows: Record<string, unknown>[]) => {
            calls.ordersInsert++;
            void rows;
            return Promise.resolve({ error: null });
          },
          upsert: (rows: Record<string, unknown>[], options: unknown) => {
            calls.ordersUpsert++;
            calls.upsertPayloads.push(rows);
            calls.upsertOptions.push(options);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "shopify_order_risk_assessments") {
        return {
          select: () => {
            calls.assessSelect++;
            const chain = {
              eq: () => chain,
              in: () => chain,
              not: () =>
                Promise.resolve({
                  data: opts.existingHashes ?? [],
                  error: null,
                }),
            };
            return chain;
          },
          insert: (rows: Record<string, unknown>[]) => {
            calls.assessInsert++;
            void rows;
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  return { sb, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("persistOrders — write batching", () => {
  it("issues exactly one upsert for 50 existing orders, not one per order", async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `gid://o/${i}`);
    const { sb, calls } = buildSb({ existingOrderIds: ids });
    mockGetClient.mockReturnValue(sb as never);

    const res = await persistOrders(
      SHOP,
      ids.map((id) => makeOrder(id)),
      [],
    );

    expect(calls.ordersUpsert).toBe(1);
    expect(calls.ordersInsert).toBe(0);
    expect(res.ordersUpdated).toBe(50);
    expect(res.ordersInserted).toBe(0);
    // The whole batch travels in the single call.
    expect(calls.upsertPayloads[0]).toHaveLength(50);
  });

  it("targets the (shop_id, shopify_order_id) unique constraint", async () => {
    const { sb, calls } = buildSb({ existingOrderIds: ["gid://o/1"] });
    mockGetClient.mockReturnValue(sb as never);

    await persistOrders(SHOP, [makeOrder("gid://o/1")], []);

    expect(calls.upsertOptions[0]).toEqual({
      onConflict: "shop_id,shopify_order_id",
    });
  });

  it("never asserts risk_*_initial on the update path (module contract 1)", async () => {
    const { sb, calls } = buildSb({ existingOrderIds: ["gid://o/1"] });
    mockGetClient.mockReturnValue(sb as never);

    await persistOrders(SHOP, [makeOrder("gid://o/1")], []);

    const row = calls.upsertPayloads[0][0];
    expect(row).not.toHaveProperty("risk_level_initial");
    expect(row).not.toHaveProperty("risk_recommendation_initial");
    expect(row).not.toHaveProperty("risk_provider_initial");
    // `id` too — the conflict target resolves the row.
    expect(row).not.toHaveProperty("id");
  });

  it("carries the NOT NULL columns so a conflict miss can still insert", async () => {
    // If the row is deleted between the existence lookup and the write,
    // the upsert INSERTs. created_at_shopify / currency / order_total are
    // NOT NULL with no default, so omitting them would throw.
    const { sb, calls } = buildSb({ existingOrderIds: ["gid://o/1"] });
    mockGetClient.mockReturnValue(sb as never);

    await persistOrders(SHOP, [makeOrder("gid://o/1")], []);

    const row = calls.upsertPayloads[0][0];
    expect(row.created_at_shopify).toBe("2026-06-01T00:00:00Z");
    expect(row.currency).toBe("EUR");
    expect(row.order_total).toBe(42);
    expect(row.shop_id).toBe(SHOP);
    expect(row.shopify_order_id).toBe("gid://o/1");
  });

  it("keeps inserts batched and separate from updates", async () => {
    const { sb, calls } = buildSb({ existingOrderIds: ["gid://o/1"] });
    mockGetClient.mockReturnValue(sb as never);

    const res = await persistOrders(
      SHOP,
      [makeOrder("gid://o/1"), makeOrder("gid://o/2"), makeOrder("gid://o/3")],
      [],
    );

    expect(calls.ordersInsert).toBe(1);
    expect(calls.ordersUpsert).toBe(1);
    expect(res.ordersInserted).toBe(2);
    expect(res.ordersUpdated).toBe(1);
  });
});

describe("persistOrders — risk assessment hash gate", () => {
  it("looks up existing hashes once for the batch, not once per order", async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `gid://o/${i}`);
    const { sb, calls } = buildSb({ existingOrderIds: ids });
    mockGetClient.mockReturnValue(sb as never);

    await persistOrders(
      SHOP,
      ids.map((id) => makeOrder(id)),
      ids.map((id) => makeAssessment(id, `hash-${id}`)),
    );

    expect(calls.assessSelect).toBe(1);
  });

  it("drops an incoming hash only when stored for that same order", async () => {
    const { sb, calls } = buildSb({
      existingOrderIds: ["gid://o/1", "gid://o/2"],
      // o/1 already has hash-A. o/2 does not — same hash, different order.
      existingHashes: [
        { shopify_order_id: "gid://o/1", risk_payload_hash: "hash-A" },
      ],
    });
    mockGetClient.mockReturnValue(sb as never);

    const res = await persistOrders(
      SHOP,
      [makeOrder("gid://o/1"), makeOrder("gid://o/2")],
      [makeAssessment("gid://o/1", "hash-A"), makeAssessment("gid://o/2", "hash-A")],
    );

    // o/1's is a duplicate; o/2's is genuinely new despite the same hash.
    expect(res.assessmentsSkippedUnchanged).toBe(1);
    expect(res.assessmentsInserted).toBe(1);
    expect(calls.assessInsert).toBe(1);
  });

  it("dedups repeated hashes within a single batch", async () => {
    const { sb } = buildSb({ existingOrderIds: ["gid://o/1"] });
    mockGetClient.mockReturnValue(sb as never);

    const res = await persistOrders(
      SHOP,
      [makeOrder("gid://o/1")],
      [makeAssessment("gid://o/1", "h"), makeAssessment("gid://o/1", "h")],
    );

    expect(res.assessmentsInserted).toBe(1);
    expect(res.assessmentsSkippedUnchanged).toBe(1);
  });

  it("appends rows that carry no hash (legacy call sites)", async () => {
    const { sb } = buildSb({ existingOrderIds: ["gid://o/1"] });
    mockGetClient.mockReturnValue(sb as never);

    const res = await persistOrders(
      SHOP,
      [makeOrder("gid://o/1")],
      [makeAssessment("gid://o/1", "")],
    );

    expect(res.assessmentsInserted).toBe(1);
    expect(res.assessmentsSkippedUnchanged).toBe(0);
  });
});

describe("persistOrders — no-op", () => {
  it("writes nothing when given no orders and no assessments", async () => {
    const { sb, calls } = buildSb({});
    mockGetClient.mockReturnValue(sb as never);

    const res = await persistOrders(SHOP, [], []);

    expect(calls.ordersSelect).toBe(0);
    expect(calls.ordersUpsert).toBe(0);
    expect(calls.ordersInsert).toBe(0);
    expect(res).toEqual({
      ordersInserted: 0,
      ordersUpdated: 0,
      assessmentsInserted: 0,
      assessmentsSkippedUnchanged: 0,
    });
  });
});
