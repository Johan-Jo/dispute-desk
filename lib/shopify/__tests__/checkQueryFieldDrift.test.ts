/**
 * Tests for `checkShopifyQueryFieldDrift` — the runtime dry-run
 * drift checker that complements the static deny-list guard in
 * `queries/__tests__/schemaDriftGuard.test.ts`.
 *
 * Coverage targets:
 *   1. classifyError parses both the `extensions.code = undefinedField`
 *      signal AND the message-regex fallback.
 *   2. State machine: clean → drift → same drift → different drift →
 *      clean → resolved. Each transition writes the right audit row
 *      AND fires the matching mailer exactly once.
 *   3. A transport failure on one query does not mask drift on others.
 *   4. No connected shop short-circuits with `skipped: no_connected_shop`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/shopify/makeAuthedRequest", () => ({
  makeAuthedRequest: vi.fn(),
}));
vi.mock("@/lib/email/sendQueryFieldDriftAlert", () => ({
  sendQueryFieldDriftAlert: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/email/sendQueryFieldDriftResolvedAlert", () => ({
  sendQueryFieldDriftResolvedAlert: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/shopify/queries/registry", () => ({
  DRY_RUN_QUERIES: [
    {
      name: "FAKE_DISPUTE_QUERY",
      type: "query",
      body: "query Fake { dispute(id: $id) { id } }",
      stubVariables: { id: "gid://shopify/ShopifyPaymentsDispute/0" },
      dryRun: true,
    },
    {
      name: "FAKE_ORDER_QUERY",
      type: "query",
      body: "query Fake2 { node(id: $id) { __typename } }",
      stubVariables: { id: "gid://shopify/Order/0" },
      dryRun: true,
    },
  ],
}));

import { getServiceClient } from "@/lib/supabase/server";
import { makeAuthedRequest } from "@/lib/shopify/makeAuthedRequest";
import { sendQueryFieldDriftAlert } from "@/lib/email/sendQueryFieldDriftAlert";
import { sendQueryFieldDriftResolvedAlert } from "@/lib/email/sendQueryFieldDriftResolvedAlert";
import { checkShopifyQueryFieldDrift } from "../checkQueryFieldDrift";

const mockGetClient = vi.mocked(getServiceClient);
const mockRequest = vi.mocked(makeAuthedRequest);
const mockAlert = vi.mocked(sendQueryFieldDriftAlert);
const mockResolvedAlert = vi.mocked(sendQueryFieldDriftResolvedAlert);

/* ── Supabase mock factory ───────────────────────────────────────── */

interface SbState {
  session: { shop_id: string; shops: { shop_domain: string } } | null;
  lastAudit: { event_type: string; event_payload: Record<string, unknown> } | null;
  inserted: Array<{ table: string; row: Record<string, unknown> }>;
}

function buildSb(state: SbState) {
  const sb = {
    from: vi.fn((table: string) => {
      if (table === "shop_sessions") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: vi.fn().mockResolvedValue({ data: state.session }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "audit_events") {
        const handle = {
          select: () => ({
            in: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: state.lastAudit }),
                }),
              }),
            }),
          }),
          insert: vi.fn().mockImplementation(async (row: Record<string, unknown>) => {
            state.inserted.push({ table: "audit_events", row });
            return { data: null, error: null };
          }),
        };
        return handle;
      }
      return {};
    }),
  };
  return sb;
}

/* ── Helpers ─────────────────────────────────────────────────────── */

function undefinedFieldErr(field: string, type: string) {
  return {
    message: `Field '${field}' doesn't exist on type '${type}'`,
    extensions: { code: "undefinedField", typeName: type, fieldName: field },
  };
}

function regexOnlyUndefinedFieldErr(field: string, type: string) {
  // Shape Shopify might use in a future API rev: no extensions.code,
  // only the well-known message. The regex fallback should still catch.
  return {
    message: `Field '${field}' doesn't exist on type '${type}'`,
  };
}

function unrelatedErr() {
  return {
    message: "Throttled",
    extensions: { code: "THROTTLED" },
  };
}

const CONNECTED_SESSION = {
  shop_id: "shop-1",
  shops: { shop_domain: "demo-store.myshopify.com" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

/* ── Tests ───────────────────────────────────────────────────────── */

describe("checkShopifyQueryFieldDrift", () => {
  it("skips when no offline session exists", async () => {
    mockGetClient.mockReturnValue(
      buildSb({ session: null, lastAudit: null, inserted: [] }) as never,
    );
    const result = await checkShopifyQueryFieldDrift();
    expect(result).toEqual({ ok: true, skipped: "no_connected_shop" });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("returns drift:false on a fully clean run with no prior drift", async () => {
    const state: SbState = {
      session: CONNECTED_SESSION,
      lastAudit: null,
      inserted: [],
    };
    mockGetClient.mockReturnValue(buildSb(state) as never);
    mockRequest.mockResolvedValue({ data: { node: null } } as never);

    const result = await checkShopifyQueryFieldDrift();

    expect(result.ok).toBe(true);
    if (!result.ok || "skipped" in result) throw new Error("unexpected shape");
    expect(result).toMatchObject({
      drift: false,
      checkedShopDomain: "demo-store.myshopify.com",
      queriesChecked: 2,
    });
    expect(mockAlert).not.toHaveBeenCalled();
    expect(mockResolvedAlert).not.toHaveBeenCalled();
    expect(state.inserted).toHaveLength(0);
  });

  it("detects drift, writes audit, and fires alert exactly once", async () => {
    const state: SbState = {
      session: CONNECTED_SESSION,
      lastAudit: null,
      inserted: [],
    };
    mockGetClient.mockReturnValue(buildSb(state) as never);
    mockRequest
      .mockResolvedValueOnce({
        errors: [undefinedFieldErr("cartToken", "Order")],
      } as never)
      .mockResolvedValueOnce({
        errors: [regexOnlyUndefinedFieldErr("metafields", "Fulfillment")],
      } as never);

    const result = await checkShopifyQueryFieldDrift();

    expect(result.ok).toBe(true);
    if (!result.ok || "skipped" in result || !("drift" in result) || !result.drift) {
      throw new Error("expected drift:true result");
    }
    expect("alertSent" in result && result.alertSent).toBe(true);
    expect(result.driftRows).toEqual([
      {
        query: "FAKE_DISPUTE_QUERY",
        type: "Order",
        field: "cartToken",
        message: "Field 'cartToken' doesn't exist on type 'Order'",
      },
      {
        query: "FAKE_ORDER_QUERY",
        type: "Fulfillment",
        field: "metafields",
        message: "Field 'metafields' doesn't exist on type 'Fulfillment'",
      },
    ]);
    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0].row).toMatchObject({
      event_type: "shopify_query_field_drift",
    });
  });

  it("dedups: identical drift to last audit fires no new alert", async () => {
    const priorDrift = [
      {
        query: "FAKE_DISPUTE_QUERY",
        type: "Order",
        field: "cartToken",
        message: "Field 'cartToken' doesn't exist on type 'Order'",
      },
    ];
    const state: SbState = {
      session: CONNECTED_SESSION,
      lastAudit: {
        event_type: "shopify_query_field_drift",
        event_payload: { drift_rows: priorDrift },
      },
      inserted: [],
    };
    mockGetClient.mockReturnValue(buildSb(state) as never);
    mockRequest
      .mockResolvedValueOnce({
        errors: [undefinedFieldErr("cartToken", "Order")],
      } as never)
      .mockResolvedValueOnce({ data: {} } as never);

    const result = await checkShopifyQueryFieldDrift();

    expect(result.ok).toBe(true);
    if (!result.ok || "skipped" in result || !("dedup" in result)) {
      throw new Error("expected dedup result");
    }
    expect(result.dedup).toBe("already_alerted");
    expect(mockAlert).not.toHaveBeenCalled();
    expect(state.inserted).toHaveLength(0);
  });

  it("re-alerts when the drift set changes (new field affected)", async () => {
    const priorDrift = [
      {
        query: "FAKE_DISPUTE_QUERY",
        type: "Order",
        field: "cartToken",
        message: "Field 'cartToken' doesn't exist on type 'Order'",
      },
    ];
    const state: SbState = {
      session: CONNECTED_SESSION,
      lastAudit: {
        event_type: "shopify_query_field_drift",
        event_payload: { drift_rows: priorDrift },
      },
      inserted: [],
    };
    mockGetClient.mockReturnValue(buildSb(state) as never);
    mockRequest
      .mockResolvedValueOnce({
        errors: [
          undefinedFieldErr("cartToken", "Order"),
          undefinedFieldErr("submittedAt", "ShopifyPaymentsDisputeEvidence"),
        ],
      } as never)
      .mockResolvedValueOnce({ data: {} } as never);

    const result = await checkShopifyQueryFieldDrift();
    if (!result.ok || "skipped" in result || !("drift" in result) || !result.drift) {
      throw new Error("expected drift:true alertSent");
    }
    expect("alertSent" in result && result.alertSent).toBe(true);
    expect(mockAlert).toHaveBeenCalledTimes(1);
  });

  it("emits resolved alert when prior drift now passes clean", async () => {
    const priorDrift = [
      {
        query: "FAKE_DISPUTE_QUERY",
        type: "Order",
        field: "cartToken",
        message: "Field 'cartToken' doesn't exist on type 'Order'",
      },
    ];
    const state: SbState = {
      session: CONNECTED_SESSION,
      lastAudit: {
        event_type: "shopify_query_field_drift",
        event_payload: { drift_rows: priorDrift },
      },
      inserted: [],
    };
    mockGetClient.mockReturnValue(buildSb(state) as never);
    mockRequest.mockResolvedValue({ data: {} } as never);

    const result = await checkShopifyQueryFieldDrift();
    if (!result.ok || "skipped" in result || !("drift" in result) || result.drift) {
      throw new Error("expected drift:false resolved:true");
    }
    expect("resolved" in result && result.resolved).toBe(true);
    expect(mockResolvedAlert).toHaveBeenCalledTimes(1);
    expect(state.inserted[0].row).toMatchObject({
      event_type: "shopify_query_field_drift_resolved",
    });
  });

  it("ignores unrelated errors (throttling, network) — only undefinedField counts", async () => {
    const state: SbState = {
      session: CONNECTED_SESSION,
      lastAudit: null,
      inserted: [],
    };
    mockGetClient.mockReturnValue(buildSb(state) as never);
    mockRequest
      .mockResolvedValueOnce({ errors: [unrelatedErr()] } as never)
      .mockResolvedValueOnce({ data: {} } as never);

    const result = await checkShopifyQueryFieldDrift();
    if (!result.ok || "skipped" in result) throw new Error("unexpected");
    expect("drift" in result && result.drift).toBe(false);
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it("transport failure on one query does not mask drift on others", async () => {
    const state: SbState = {
      session: CONNECTED_SESSION,
      lastAudit: null,
      inserted: [],
    };
    mockGetClient.mockReturnValue(buildSb(state) as never);
    mockRequest
      .mockRejectedValueOnce(new Error("fetch timeout"))
      .mockResolvedValueOnce({
        errors: [undefinedFieldErr("metafields", "Fulfillment")],
      } as never);

    const result = await checkShopifyQueryFieldDrift();
    if (!result.ok || "skipped" in result || !("drift" in result) || !result.drift) {
      throw new Error("expected drift:true from second query");
    }
    expect(result.driftRows).toEqual([
      {
        query: "FAKE_ORDER_QUERY",
        type: "Fulfillment",
        field: "metafields",
        message: "Field 'metafields' doesn't exist on type 'Fulfillment'",
      },
    ]);
    expect(mockAlert).toHaveBeenCalledTimes(1);
  });
});
