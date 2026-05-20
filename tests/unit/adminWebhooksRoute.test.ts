/**
 * Tests for /api/admin/webhooks.
 *
 * Two endpoints share the GET handler: the row listing and the 24h aggregate
 * stats (?aggregate=1). Both are service-role queries — these tests verify
 * the query shapes and the bucket/percentile aggregation logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

import { GET } from "@/app/api/admin/webhooks/route";
import { getServiceClient } from "@/lib/supabase/server";

const mockGetServiceClient = vi.mocked(getServiceClient);

/** Lazy thenable that delivers `resolved` when awaited but also supports
 *  Supabase-style chained filter calls (.eq, .ilike, .gte, .lt, .order). */
function lazyChain(resolved: unknown) {
  const chain: Record<string, unknown> = {
    then: (onFulfilled: (v: unknown) => unknown) => Promise.resolve(resolved).then(onFulfilled),
  };
  for (const method of ["eq", "ilike", "gte", "lt", "order", "range", "select"]) {
    chain[method] = vi.fn().mockImplementation(() => chain);
  }
  return chain;
}

function buildRequest(qs: string) {
  const url = new URL(`https://x/${qs}`);
  const req = { nextUrl: url } as unknown as Parameters<typeof GET>[0];
  return req;
}

describe("GET /api/admin/webhooks (listing)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the row listing with total + pagination", async () => {
    const rows = [
      {
        id: "row-1",
        shop_id: "shop-1",
        event_id: "evt-1",
        topic: "disputes/update",
        shopify_object_id: "gid://shopify/DisputeEvidence/1",
        received_at: "2026-05-19T12:00:00Z",
        processed_at: "2026-05-19T12:00:00Z",
        outcome: "applied",
        error_message: null,
        processing_ms: 142,
      },
    ];
    const chain = lazyChain({ data: rows, error: null, count: 1 });
    const from = vi.fn().mockReturnValue(chain);
    mockGetServiceClient.mockReturnValue({ from } as never);

    const res = await GET(buildRequest("?topic=disputes/update"));
    const body = await res.json();

    expect(body).toMatchObject({ total: 1, limit: 100, offset: 0 });
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ outcome: "applied" });
  });
});

describe("GET /api/admin/webhooks?aggregate=1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("buckets outcomes + topics, computes p50/p95 latency, reports cron-only count", async () => {
    const aggregateRows = [
      { topic: "disputes/update", outcome: "applied", processing_ms: 100, received_at: "x", shopify_object_id: "a", shop_id: "shop-1" },
      { topic: "disputes/update", outcome: "applied", processing_ms: 200, received_at: "x", shopify_object_id: "b", shop_id: "shop-1" },
      { topic: "disputes/update", outcome: "applied", processing_ms: 300, received_at: "x", shopify_object_id: "c", shop_id: "shop-1" },
      { topic: "disputes/update", outcome: "duplicate_event", processing_ms: null, received_at: "x", shopify_object_id: "d", shop_id: "shop-1" },
      { topic: "disputes/create", outcome: "error", processing_ms: 50, received_at: "x", shopify_object_id: "e", shop_id: "shop-2" },
    ];

    const auditRows = [
      {
        dispute_id: "dispute-a",
        created_at: "2026-05-19T12:00:00Z",
        event_payload: { source: "cron" },
      },
      {
        dispute_id: "dispute-b",
        created_at: "2026-05-19T12:30:00Z",
        event_payload: { source: "webhook" },
      },
    ];

    let webhookCallIdx = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const from = vi.fn().mockImplementation((table: string): any => {
      if (table === "webhook_events") {
        // First call is the aggregate select; subsequent calls are the
        // per-cron-row "preceding webhook?" count.
        webhookCallIdx++;
        if (webhookCallIdx === 1) {
          return lazyChain({ data: aggregateRows, error: null });
        }
        return lazyChain({ count: 0, error: null });
      }
      if (table === "audit_events") {
        return lazyChain({ data: auditRows, error: null });
      }
      throw new Error(`unexpected table: ${table}`);
    });
    mockGetServiceClient.mockReturnValue({ from } as never);

    const res = await GET(buildRequest("?aggregate=1"));
    const body = await res.json();

    expect(body).toMatchObject({
      total: 5,
      byOutcome: { applied: 3, duplicate_event: 1, error: 1 },
      byTopic: { "disputes/update": 4, "disputes/create": 1 },
    });
    // p50 of [50, 100, 200, 300] → index 2 → 200
    expect(body.p50).toBe(200);
    expect(typeof body.p95).toBe("number");

    expect(body.cronOnlyReconciliations).toBe(1);
  });

  it("returns 0 cron-only reconciliations when no audit events exist", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const from = vi.fn().mockImplementation((table: string): any => {
      if (table === "webhook_events") return lazyChain({ data: [], error: null });
      if (table === "audit_events") return lazyChain({ data: [], error: null });
      throw new Error(`unexpected table: ${table}`);
    });
    mockGetServiceClient.mockReturnValue({ from } as never);

    const res = await GET(buildRequest("?aggregate=1"));
    const body = await res.json();
    expect(body.cronOnlyReconciliations).toBe(0);
    expect(body.total).toBe(0);
  });
});
