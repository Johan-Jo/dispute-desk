/**
 * A Session Token Exchange install starts the historical order import.
 *
 * Until 2026-10-09 only the OAuth callback did. A shop installed through
 * token exchange (whj8db-1q) had its import started by the first view of the
 * Insights page instead — and would never have been imported had nobody
 * opened it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/shopify/sessionStorage", () => ({ storeSession: vi.fn(), loadSession: vi.fn() }));
vi.mock("@/lib/shopify/sessionToken", () => ({ verifySessionToken: vi.fn() }));
vi.mock("@/lib/shopify/registerDisputeWebhooks", () => ({
  registerDisputeWebhooks: vi.fn().mockResolvedValue({ ok: true, errors: [] }),
}));
vi.mock("@/lib/shopify/persistShopCurrency", () => ({ persistShopCurrency: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/shopify/onNewShopCreated", () => ({ onNewShopCreated: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/shopify/sessions/refreshOfflineToken", () => ({ needsRefresh: vi.fn() }));
vi.mock("@/lib/disputes/backfillOrders", () => ({ enqueueShopOrdersBackfill: vi.fn() }));

import { getServiceClient } from "@/lib/supabase/server";
import { loadSession, storeSession } from "@/lib/shopify/sessionStorage";
import { verifySessionToken } from "@/lib/shopify/sessionToken";
import { needsRefresh } from "@/lib/shopify/sessions/refreshOfflineToken";
import { enqueueShopOrdersBackfill } from "@/lib/disputes/backfillOrders";
import { GET } from "../route";
import { NextRequest } from "next/server";

const mockEnqueue = vi.mocked(enqueueShopOrdersBackfill);

function shopsTable(shopRow: { id: string } | null) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "insert", "update"]) chain[m] = () => chain;
  chain.maybeSingle = async () => ({ data: shopRow, error: null });
  chain.single = async () => ({ data: shopRow ?? { id: "shop-new" }, error: null });
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve);
  return chain;
}

const request = () =>
  new NextRequest(
    new URL("https://disputedesk.app/api/auth/shopify/token-exchange?id_token=tok&shop=acme.myshopify.com&host=h&return_to=%2Fapp"),
  );

const exchange = (ok: boolean) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 400,
      text: async () => "",
      json: async () => ({
        access_token: "shpat_new",
        scope: "read_orders",
        expires_in: 3600,
        refresh_token: "shprt_new",
        refresh_token_expires_in: 7_776_000,
      }),
    })),
  );

const EXISTING = { tokenExpiring: true } as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifySessionToken).mockReturnValue({ shopDomain: "acme.myshopify.com" } as never);
  vi.mocked(getServiceClient).mockReturnValue(shopsTable(null) as never);
  vi.mocked(loadSession).mockResolvedValue(null);
  vi.mocked(needsRefresh).mockReturnValue(false);
  mockEnqueue.mockResolvedValue("job-1");
  exchange(true);
});

describe("GET /api/auth/shopify/token-exchange — order import", () => {
  it("starts the import on the first successful exchange, after the session is stored", async () => {
    const order: string[] = [];
    vi.mocked(storeSession).mockImplementation(async () => {
      order.push("session");
    });
    mockEnqueue.mockImplementation(async () => {
      order.push("import");
      return "job-1";
    });
    await GET(request());
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith("shop-new");
    expect(order).toEqual(["session", "import"]);
  });

  it("does not enqueue when the shop already had a session — fresh, or refreshed in this request", async () => {
    vi.mocked(getServiceClient).mockReturnValue(shopsTable({ id: "shop-1" }) as never);
    vi.mocked(loadSession).mockResolvedValue(EXISTING);
    await GET(request());
    vi.mocked(needsRefresh).mockReturnValue(true); // re-exchanges, but is not a first session
    await GET(request());
    expect(storeSession).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("does not enqueue when Shopify rejects the exchange, and does on the retry that succeeds", async () => {
    exchange(false);
    await GET(request());
    expect(mockEnqueue).not.toHaveBeenCalled();

    // The retry finds the shop row the failed attempt created, still with no session.
    vi.mocked(getServiceClient).mockReturnValue(shopsTable({ id: "shop-new" }) as never);
    exchange(true);
    await GET(request());
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });

  it("an enqueue that throws does not break the install", async () => {
    mockEnqueue.mockRejectedValue(new Error("db down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await GET(request());
    expect(res.status).toBeLessThan(500);
    expect(storeSession).toHaveBeenCalled();
    warn.mockRestore();
  });
});
