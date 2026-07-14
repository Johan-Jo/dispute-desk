import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Regression for the 2026-07-14 surasvenne incident: a merchant with an
// existing (30-day) `shopify_shop` cookie never re-hits
// /api/auth/shopify/token-exchange through normal navigation — that
// bootstrap redirect only fires when the cookie is ABSENT. Shopify
// still hands the app a fresh id_token on embedded loads even when a
// session cookie already exists; middleware must use it once to give a
// legacy (non-expiring) offline token a chance to upgrade
// (docs/plans/expiring-offline-tokens.plan.md Stage 3). Without this,
// a shop whose token predates the migration is stuck forever — opening
// the app again (with a valid cookie) does nothing.

const mockGetUser = vi.fn().mockResolvedValue({ data: { user: null } });

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: mockGetUser } }),
}));

vi.mock("next-intl/middleware", () => ({
  default: () => () => {
    const { NextResponse } = require("next/server");
    return NextResponse.next();
  },
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

import { middleware } from "@/middleware";

const SHOP = "surasvenne.myshopify.com";
// Well-formed-looking JWT shape (three non-empty base64url segments) —
// `looksLikeSessionToken` only checks shape at the edge; real signature
// verification happens in the node-runtime token-exchange route.
const FAKE_ID_TOKEN = "aaa.bbb.ccc";

function appReq(query: string, cookies: Record<string, string>): NextRequest {
  const req = new NextRequest(new URL(`http://localhost/app/disputes${query}`), {
    headers: new Headers(),
  });
  for (const [k, v] of Object.entries(cookies)) req.cookies.set(k, v);
  return req;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: null } });
});

describe("middleware /app — Stage 3 token-expiring re-check", () => {
  it("redirects to token-exchange when a valid cookie exists but the shop was never confirmed on the expiring variant", async () => {
    const res = await middleware(
      appReq(`?shop=${SHOP}&id_token=${FAKE_ID_TOKEN}`, {
        shopify_shop: SHOP,
        shopify_shop_id: "shop-1",
        // no dd_token_expiring cookie — never confirmed
      }),
    );

    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toContain("/api/auth/shopify/token-exchange");
    expect(location).toContain(`id_token=${FAKE_ID_TOKEN}`);
    expect(location).toContain(`shop=${encodeURIComponent(SHOP)}`);
  });

  it("does NOT redirect once dd_token_expiring=1 is set — falls through to normal handling", async () => {
    const res = await middleware(
      appReq(`?shop=${SHOP}&id_token=${FAKE_ID_TOKEN}`, {
        shopify_shop: SHOP,
        shopify_shop_id: "shop-1",
        dd_token_expiring: "1",
      }),
    );

    const location = res.headers.get("location");
    expect(location ?? "").not.toContain("/api/auth/shopify/token-exchange");
  });

  it("does NOT redirect when there's no id_token on the request (plain in-app navigation)", async () => {
    const res = await middleware(
      appReq(`?shop=${SHOP}`, {
        shopify_shop: SHOP,
        shopify_shop_id: "shop-1",
      }),
    );

    const location = res.headers.get("location");
    expect(location ?? "").not.toContain("/api/auth/shopify/token-exchange");
  });

  it("does NOT redirect when dd_token_expiring is explicitly '0' AND there's no id_token (only a fresh id_token triggers the re-check)", async () => {
    const res = await middleware(
      appReq(`?shop=${SHOP}`, {
        shopify_shop: SHOP,
        shopify_shop_id: "shop-1",
        dd_token_expiring: "0",
      }),
    );

    const location = res.headers.get("location");
    expect(location ?? "").not.toContain("/api/auth/shopify/token-exchange");
  });

  it("does NOT redirect through token-exchange when the cookie's shop and the URL's ?shop= disagree (leaves it to the stale-cookie guard)", async () => {
    const res = await middleware(
      appReq(`?shop=other-store.myshopify.com&id_token=${FAKE_ID_TOKEN}`, {
        shopify_shop: SHOP,
        shopify_shop_id: "shop-1",
      }),
    );

    // The stale-cookie guard redirects to plain OAuth, not token-exchange.
    const location = res.headers.get("location");
    expect(location ?? "").not.toContain("/api/auth/shopify/token-exchange");
  });
});
