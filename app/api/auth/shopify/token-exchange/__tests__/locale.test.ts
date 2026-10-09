/**
 * The token-exchange route persists the language the merchant selected in
 * Shopify Admin to `shops.locale`, which every request-less email sender
 * reads. Regression for the 2026-10-09 Hem & Trend install (Swedish store
 * stored as the `en-US` column default, welcome email sent in English).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/shopify/sessionStorage", () => ({
  storeSession: vi.fn(),
  loadSession: vi.fn(),
}));
vi.mock("@/lib/shopify/sessionToken", () => ({
  verifySessionToken: vi.fn(),
}));
vi.mock("@/lib/shopify/registerDisputeWebhooks", () => ({
  registerDisputeWebhooks: vi.fn().mockResolvedValue({ ok: true, errors: [] }),
}));
vi.mock("@/lib/shopify/persistShopCurrency", () => ({
  persistShopCurrency: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/shopify/onNewShopCreated", () => ({
  onNewShopCreated: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { loadSession } from "@/lib/shopify/sessionStorage";
import { verifySessionToken } from "@/lib/shopify/sessionToken";
import { onNewShopCreated } from "@/lib/shopify/onNewShopCreated";
import { GET } from "../route";
import { NextRequest } from "next/server";

const inserts: Record<string, unknown>[] = [];
const updates: Record<string, unknown>[] = [];
const eqCalls: [string, unknown][] = [];

function makeShopsTable(shopRow: { id: string } | null) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select"]) chain[m] = () => chain;
  chain.eq = (col: string, val: unknown) => {
    eqCalls.push([col, val]);
    return chain;
  };
  chain.insert = (row: Record<string, unknown>) => {
    inserts.push(row);
    return chain;
  };
  chain.update = (row: Record<string, unknown>) => {
    updates.push(row);
    return chain;
  };
  chain.maybeSingle = async () => ({ data: shopRow, error: null });
  chain.single = async () => ({ data: shopRow ?? { id: "shop-new" }, error: null });
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null }).then(resolve);
  return chain;
}

function makeRequest(query: string): NextRequest {
  const url = `https://disputedesk.app/api/auth/shopify/token-exchange?id_token=tok&shop=acme.myshopify.com&host=h${query}`;
  return new NextRequest(new URL(url));
}

beforeEach(() => {
  vi.clearAllMocks();
  inserts.length = 0;
  updates.length = 0;
  eqCalls.length = 0;
  vi.mocked(verifySessionToken).mockReturnValue({ shopDomain: "acme.myshopify.com" } as never);
  vi.mocked(loadSession).mockResolvedValue(null);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
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
});

describe("GET /api/auth/shopify/token-exchange — merchant locale", () => {
  it("stores Shopify's locale on a new shop and passes it to the welcome email", async () => {
    vi.mocked(getServiceClient).mockReturnValue(makeShopsTable(null) as never);

    await GET(makeRequest("&locale=sv&return_to=%2Fapp"));

    expect(inserts).toEqual([{ shop_domain: "acme.myshopify.com", locale: "sv" }]);
    expect(onNewShopCreated).toHaveBeenCalledWith(expect.objectContaining({ locale: "sv" }));
  });

  it("reads the locale out of return_to when it was not forwarded", async () => {
    vi.mocked(getServiceClient).mockReturnValue(makeShopsTable(null) as never);

    await GET(
      makeRequest(
        `&return_to=${encodeURIComponent("/app?shop=acme.myshopify.com&locale=de")}`,
      ),
    );

    expect(inserts).toEqual([{ shop_domain: "acme.myshopify.com", locale: "de" }]);
  });

  it("stores English when Shopify's language is one we don't ship", async () => {
    vi.mocked(getServiceClient).mockReturnValue(makeShopsTable(null) as never);

    await GET(makeRequest("&locale=da&return_to=%2Fapp"));

    expect(inserts).toEqual([{ shop_domain: "acme.myshopify.com", locale: "en" }]);
  });

  // The locale is the logged-in user's, and this route re-runs hourly: a staff
  // member with an English Admin must not flip a captured store locale.
  it("fills an existing shop's locale only where it is still the column default", async () => {
    vi.mocked(getServiceClient).mockReturnValue(makeShopsTable({ id: "shop-1" }) as never);

    await GET(makeRequest("&locale=sv&return_to=%2Fapp"));

    expect(updates[0]).not.toHaveProperty("locale");
    expect(updates[1]).toEqual({ locale: "sv" });
    expect(eqCalls).toContainEqual(["locale", "en-US"]);
  });

  it("writes no locale for an existing shop when Shopify sent none", async () => {
    vi.mocked(getServiceClient).mockReturnValue(makeShopsTable({ id: "shop-1" }) as never);

    await GET(makeRequest("&return_to=%2Fapp"));

    expect(updates).toHaveLength(1);
    expect(updates[0]).not.toHaveProperty("locale");
    expect(inserts).toEqual([]);
  });

  it("an empty locale param does not hide the one in return_to", async () => {
    vi.mocked(getServiceClient).mockReturnValue(makeShopsTable(null) as never);

    await GET(makeRequest(`&locale=&return_to=${encodeURIComponent("/app?locale=fr")}`));

    expect(inserts).toEqual([{ shop_domain: "acme.myshopify.com", locale: "fr" }]);
  });
});
