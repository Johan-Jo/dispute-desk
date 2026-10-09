/**
 * The OAuth callback enqueues the 90-day daily-metrics backfill only for a
 * shop that already existed.
 *
 * On a brand-new shop the disputes are not synced yet, so the backfill would
 * write 90 days of zero chargebacks and the dashboard rate would read 0. A
 * new shop gets the backfill when its first Insights month records are
 * written (`maintainShopMonths`), on either install path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// The route reads SHOPIFY_APP_URL when the module loads.
vi.hoisted(() => {
  process.env.SHOPIFY_APP_URL = "https://disputedesk.app";
});

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/shopify/auth", () => ({
  verifyHmac: () => true,
  decodeOAuthState: () => ({ phase: "offline", source: "embedded", returnTo: "", plan: null }),
  exchangeCodeForToken: vi.fn().mockResolvedValue({ accessToken: "shpat", scope: "read_orders" }),
}));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/shopify/sessionStorage", () => ({ storeSession: vi.fn() }));
vi.mock("@/lib/shopify/registerDisputeWebhooks", () => ({
  registerDisputeWebhooks: vi.fn().mockResolvedValue({ ok: true, errors: [] }),
}));
vi.mock("@/lib/shopify/registerOrderWebhooks", () => ({
  registerOrderWebhooks: vi.fn().mockResolvedValue({ ok: true, errors: [] }),
}));
vi.mock("@/lib/liabilityShift/sessions/registerWebPixel", () => ({
  registerWebPixel: vi.fn().mockResolvedValue({ status: "exists" }),
}));
vi.mock("@/lib/disputes/backfillShopDailyMetrics", () => ({
  enqueueShopDailyMetricsBackfill: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/disputes/backfillOrders", () => ({
  enqueueShopOrdersBackfill: vi.fn().mockResolvedValue(null),
  resetBackfillIfScopeUpgraded: vi.fn().mockResolvedValue({ upgraded: false }),
}));
vi.mock("@/lib/shopify/shopDetails", () => ({ fetchShopDetails: vi.fn() }));
vi.mock("@/lib/shopify/persistShopCurrency", () => ({ persistShopCurrency: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/policies/ingestShopifyPolicies", () => ({ ingestShopifyPolicies: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/shopify/onNewShopCreated", () => ({ onNewShopCreated: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/analytics/metaInstall", () => ({ readMetaAttribution: () => null }));
vi.mock("@/lib/email/sendWelcome", () => ({ sendWelcomeEmail: vi.fn() }));
vi.mock("@/lib/rules/storeAutomation", () => ({ seedDefaultStoreAutomation: vi.fn() }));
vi.mock("@/lib/email/sendAdminNotification", () => ({ sendAdminSignupNotification: vi.fn() }));

import { getServiceClient } from "@/lib/supabase/server";
import { enqueueShopDailyMetricsBackfill } from "@/lib/disputes/backfillShopDailyMetrics";
import { enqueueShopOrdersBackfill } from "@/lib/disputes/backfillOrders";
import { GET } from "../route";
import { NextRequest } from "next/server";

function shopsTable(existing: { id: string } | null) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "insert", "update"]) chain[m] = () => chain;
  let inserted = false;
  chain.insert = () => {
    inserted = true;
    return chain;
  };
  chain.single = async () => ({ data: inserted ? { id: "shop-new" } : existing, error: null });
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve);
  return chain;
}

const request = () =>
  new NextRequest(new URL("https://disputedesk.app/api/auth/shopify/callback?shop=acme.myshopify.com&code=c&state=s"));

beforeEach(() => vi.clearAllMocks());

describe("GET /api/auth/shopify/callback — daily-metrics backfill", () => {
  it("is not enqueued for a brand-new shop; the order import still is", async () => {
    vi.mocked(getServiceClient).mockReturnValue(shopsTable(null) as never);
    const res = await GET(request());
    expect(res.status).toBe(307);
    await Promise.resolve();
    expect(enqueueShopDailyMetricsBackfill).not.toHaveBeenCalled();
    expect(enqueueShopOrdersBackfill).toHaveBeenCalledWith("shop-new");
  });

  it("is enqueued for a shop that already existed (re-install, re-auth)", async () => {
    vi.mocked(getServiceClient).mockReturnValue(shopsTable({ id: "shop-1" }) as never);
    await GET(request());
    expect(enqueueShopDailyMetricsBackfill).toHaveBeenCalledWith("shop-1");
  });
});
