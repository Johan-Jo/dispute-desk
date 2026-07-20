import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Batch signal-writer contract. `upsertSignalRows` collapses a whole
 * backfill page (100 orders) into ONE upsert + one grouped miss-insert,
 * replacing the per-order round-trip loop that dominated per-page latency
 * on large historical imports (blume-box, 2026-07-20).
 *
 * These tests pin:
 *   1. one upsert call for the whole batch (not one per order),
 *   2. same (shop_id, shopify_order_id) conflict key,
 *   3. dedup on the conflict key (last wins) so PostgREST never sees the
 *      same row twice in one statement,
 *   4. misses flushed in a single grouped insert,
 *   5. empty input is a no-op (no DB call).
 */

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { upsertSignalRows } from "@/lib/fraudIntel/signalWriter";
import type { RawBackfillOrder } from "@/lib/shopify/queries/ordersForBackfill";

const mockGetServiceClient = vi.mocked(getServiceClient);

function rawOrder(id: string, overrides: Partial<RawBackfillOrder> = {}): RawBackfillOrder {
  return {
    id,
    name: "#1001",
    createdAt: "2026-05-20T12:00:00Z",
    processedAt: "2026-05-20T12:00:01Z",
    cancelledAt: null,
    cancelReason: null,
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "UNFULFILLED",
    test: false,
    paymentGatewayNames: ["shopify_payments"],
    clientIp: null,
    totalPriceSet: { shopMoney: { amount: "100.00", currencyCode: "USD" } },
    shippingAddress: { countryCode: "US" },
    billingAddress: { countryCode: "US", zip: "94110" },
    customer: { id: null, email: null },
    fulfillments: null,
    shopifyProtect: null,
    transactions: null,
    metafields: null,
    risk: null,
    ...overrides,
  };
}

/** Minimal Supabase-client stub that records upsert/insert payloads. */
function makeClientStub() {
  const upsertCalls: Array<{ rows: unknown[]; opts: unknown }> = [];
  const insertCalls: Array<{ table: string; rows: unknown[] }> = [];
  const client = {
    from(table: string) {
      return {
        upsert(rows: unknown[], opts: unknown) {
          upsertCalls.push({ rows, opts });
          return Promise.resolve({ error: null });
        },
        insert(rows: unknown[]) {
          insertCalls.push({ table, rows });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { client, upsertCalls, insertCalls };
}

describe("upsertSignalRows — batched page write", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes the whole page in ONE upsert with the (shop, order) conflict key", async () => {
    const { client, upsertCalls } = makeClientStub();
    mockGetServiceClient.mockReturnValue(client as never);

    await upsertSignalRows([
      { shopId: "shop-1", shopifyOrderId: "gid://shopify/Order/1", raw: rawOrder("gid://shopify/Order/1") },
      { shopId: "shop-1", shopifyOrderId: "gid://shopify/Order/2", raw: rawOrder("gid://shopify/Order/2") },
      { shopId: "shop-1", shopifyOrderId: "gid://shopify/Order/3", raw: rawOrder("gid://shopify/Order/3") },
    ]);

    expect(upsertCalls).toHaveLength(1);
    expect((upsertCalls[0].rows as unknown[]).length).toBe(3);
    expect(upsertCalls[0].opts).toEqual({ onConflict: "shop_id,shopify_order_id" });
  });

  it("dedups duplicate order ids within a page (last wins) so no row is touched twice", async () => {
    const { client, upsertCalls } = makeClientStub();
    mockGetServiceClient.mockReturnValue(client as never);

    await upsertSignalRows([
      { shopId: "shop-1", shopifyOrderId: "gid://shopify/Order/1", raw: rawOrder("gid://shopify/Order/1", { clientIp: "203.0.113.1" }) },
      { shopId: "shop-1", shopifyOrderId: "gid://shopify/Order/1", raw: rawOrder("gid://shopify/Order/1", { clientIp: "203.0.113.9" }) },
    ]);

    const rows = upsertCalls[0].rows as Array<{ client_ip: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].client_ip).toBe("203.0.113.9"); // last wins
  });

  it("flushes parse-misses across the page in a single grouped insert", async () => {
    const { client, insertCalls } = makeClientStub();
    mockGetServiceClient.mockReturnValue(client as never);

    const missOrder = (id: string) =>
      rawOrder(id, {
        risk: {
          recommendation: "INVESTIGATE",
          assessments: [
            {
              riskLevel: "MEDIUM",
              provider: { title: "shopify" },
              facts: [{ description: "A phrasing we have never seen", sentiment: "NEUTRAL" }],
            },
          ],
        },
      });

    await upsertSignalRows([
      { shopId: "shop-1", shopifyOrderId: "gid://shopify/Order/1", raw: missOrder("gid://shopify/Order/1") },
      { shopId: "shop-1", shopifyOrderId: "gid://shopify/Order/2", raw: missOrder("gid://shopify/Order/2") },
    ]);

    const missInserts = insertCalls.filter((c) => c.table === "fraud_intel_parse_misses");
    expect(missInserts).toHaveLength(1);
    expect(missInserts[0].rows).toHaveLength(2);
  });

  it("is a no-op on empty input (no client call)", async () => {
    mockGetServiceClient.mockImplementation(() => {
      throw new Error("getServiceClient should not be called for empty input");
    });
    await expect(upsertSignalRows([])).resolves.toBeUndefined();
  });
});
