import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockSupabaseClient,
  setTableResult,
} from "@/tests/helpers/supabaseMock";

vi.mock("@/lib/shopify/sessionStorage", () => ({
  loadSession: vi.fn(),
}));

vi.mock("@/lib/shopify/registerDisputeWebhooks", () => ({
  registerDisputeWebhooks: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

import { evaluateReadiness } from "@/lib/setup/readiness";
import { loadSession } from "@/lib/shopify/sessionStorage";
import { registerDisputeWebhooks } from "@/lib/shopify/registerDisputeWebhooks";
import { getServiceClient } from "@/lib/supabase/server";

const mockLoadSession = vi.mocked(loadSession);
const mockRegisterWebhooks = vi.mocked(registerDisputeWebhooks);
const mockGetServiceClient = vi.mocked(getServiceClient);

function setupSupabaseWithShop(shopDomain: string | null) {
  const client = createMockSupabaseClient();
  if (shopDomain) {
    setTableResult(client, "shops", { id: "shop-1", shop_domain: shopDomain });
  } else {
    setTableResult(client, "shops", null);
  }
  mockGetServiceClient.mockReturnValue(client as any);
}

describe("evaluateReadiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSupabaseWithShop(null);
  });

  it("returns all needs_action when no session exists", async () => {
    mockLoadSession.mockResolvedValue(null);

    const result = await evaluateReadiness("shop-1");

    expect(result.rows).toHaveLength(5);
    expect(result.hasBlockers).toBe(true);
    expect(result.allReady).toBe(false);

    const connected = result.rows.find((r) => r.id === "shopify_connected");
    expect(connected?.status).toBe("needs_action");
    expect(connected?.blocking).toBe(true);
  });

  it("returns all ready when session has all scopes and services work", async () => {
    mockLoadSession.mockResolvedValue({
      accessToken: "tok",
      shopDomain: "test.myshopify.com",
      scopes: "read_orders,read_shopify_payments_disputes,write_shopify_payments_dispute_evidences",
    } as any);

    mockRegisterWebhooks.mockResolvedValue({ ok: true, created: [], existing: [] } as any);
    setupSupabaseWithShop("test.myshopify.com");

    const result = await evaluateReadiness("shop-1");

    expect(result.allReady).toBe(true);
    expect(result.hasBlockers).toBe(false);
    expect(result.hasPending).toBe(false);
    expect(result.rows.every((r) => r.status === "ready")).toBe(true);
  });

  it("marks dispute_access as needs_action when scope is missing", async () => {
    mockLoadSession.mockResolvedValue({
      accessToken: "tok",
      shopDomain: "test.myshopify.com",
      scopes: "read_orders,write_shopify_payments_dispute_evidences",
    } as any);

    mockRegisterWebhooks.mockResolvedValue({ ok: true, created: [], existing: [] } as any);
    setupSupabaseWithShop("test.myshopify.com");

    const result = await evaluateReadiness("shop-1");

    const disputeAccess = result.rows.find((r) => r.id === "dispute_access");
    expect(disputeAccess?.status).toBe("needs_action");
    expect(result.hasBlockers).toBe(true);
  });

  it("marks webhooks as syncing when registration fails", async () => {
    mockLoadSession.mockResolvedValue({
      accessToken: "tok",
      shopDomain: "test.myshopify.com",
      scopes: "read_shopify_payments_disputes,write_shopify_payments_dispute_evidences",
    } as any);

    mockRegisterWebhooks.mockRejectedValue(new Error("network"));
    setupSupabaseWithShop("test.myshopify.com");

    const result = await evaluateReadiness("shop-1");

    const webhooks = result.rows.find((r) => r.id === "webhooks_active");
    expect(webhooks?.status).toBe("syncing");
    expect(webhooks?.blocking).toBe(false);
    expect(result.hasBlockers).toBe(false);
  });

  it("returns 5 rows with expected IDs", async () => {
    mockLoadSession.mockResolvedValue(null);

    const result = await evaluateReadiness("shop-1");

    const ids = result.rows.map((r) => r.id);
    expect(ids).toEqual([
      "shopify_connected",
      "dispute_access",
      "evidence_access",
      "webhooks_active",
      "store_data",
    ]);
  });

  it("marks store_data as syncing when shop row is missing", async () => {
    mockLoadSession.mockResolvedValue({
      accessToken: "tok",
      shopDomain: "test.myshopify.com",
      scopes: "read_shopify_payments_disputes,write_shopify_payments_dispute_evidences",
    } as any);
    mockRegisterWebhooks.mockResolvedValue({ ok: true, created: [], existing: [] } as any);
    setupSupabaseWithShop(null);

    const result = await evaluateReadiness("shop-1");

    const storeData = result.rows.find((r) => r.id === "store_data");
    expect(storeData?.status).toBe("syncing");
  });
});
