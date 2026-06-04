import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Regression for the Sharp desk "not connected" incident (2026-06-04):
// the embedded `shopify_shop_id` cookie (sameSite=none; partitioned, CHIPS)
// is sometimes not sent with the readiness fetch inside the Shopify Admin
// iframe. Without it middleware used to 401 the setup connection check even
// for a fully-connected shop. The fix resolves the real shop by the
// Shopify-asserted `?shop=<domain>` for `/api/setup/readiness` ONLY.

const mockGetUser = vi.fn().mockResolvedValue({ data: { user: null } });
const mockShopMaybeSingle = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: mockGetUser } }),
}));

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mockShopMaybeSingle }),
      }),
    }),
  }),
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

function readinessReq(query: string): NextRequest {
  // Embedded API path with no shopify_shop / shopify_shop_id cookies.
  return new NextRequest(
    new URL(`http://localhost/api/setup/readiness${query}`),
    { headers: new Headers() },
  );
}

function readinessReqWithCookies(
  query: string,
  cookies: Record<string, string>,
): NextRequest {
  const req = new NextRequest(
    new URL(`http://localhost/api/setup/readiness${query}`),
    { headers: new Headers() },
  );
  for (const [k, v] of Object.entries(cookies)) req.cookies.set(k, v);
  return req;
}

describe("middleware /api/setup/readiness domain fallback (no cookie)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: null } });
  });

  it("OVERRIDES a stale shopify_shop_id cookie with the live shop resolved by domain", async () => {
    // Reproduces the Sharp desk incident: the browser still carries a
    // shopify_shop_id cookie pointing at a deleted/old shop (survives
    // uninstall/reinstall). Without the override, evaluateReadiness(staleId)
    // finds no session and reports a connected shop as "not connected".
    mockShopMaybeSingle.mockResolvedValue({
      data: { id: "live-shop-uuid" },
      error: null,
    });
    const res = await middleware(
      readinessReqWithCookies("?shop=sharpdesk.myshopify.com", {
        shopify_shop: "sharpdesk.myshopify.com",
        shopify_shop_id: "stale-deleted-shop-uuid",
      }),
    );
    expect(res.status).not.toBe(401);
    expect(mockShopMaybeSingle).toHaveBeenCalledTimes(1);
    const fwdShopId =
      res.headers.get("x-middleware-request-x-shop-id") ??
      res.headers.get("x-shop-id");
    expect(fwdShopId).toBe("live-shop-uuid");
  });

  it("resolves the shop by ?shop= domain and lets the request through", async () => {
    mockShopMaybeSingle.mockResolvedValue({
      data: { id: "real-shop-uuid" },
      error: null,
    });

    const res = await middleware(
      readinessReq("?shop=sharpdesk.myshopify.com"),
    );

    // Passes through (NextResponse.next) rather than the 401 SESSION_REQUIRED
    // JSON. The resolved x-shop-id/x-shop-domain are set on the FORWARDED
    // request headers (NextResponse.next({ request })), surfaced via the
    // `x-middleware-override-headers` / `x-middleware-request-*` mechanism.
    expect(res.status).not.toBe(401);
    // The shop lookup ran with the asserted domain.
    expect(mockShopMaybeSingle).toHaveBeenCalledTimes(1);
    // Forwarded request headers carry the resolved shop (Next encodes these as
    // x-middleware-request-* on the response).
    const fwdShopId =
      res.headers.get("x-middleware-request-x-shop-id") ??
      res.headers.get("x-shop-id");
    expect(fwdShopId).toBe("real-shop-uuid");
  });

  it("401s when no ?shop= is provided (nothing to resolve)", async () => {
    const res = await middleware(readinessReq(""));
    expect(res.status).toBe(401);
    expect(mockShopMaybeSingle).not.toHaveBeenCalled();
  });

  it("401s for an unknown shop domain (no row) — no data leak", async () => {
    mockShopMaybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await middleware(
      readinessReq("?shop=evil-store.myshopify.com"),
    );
    expect(res.status).toBe(401);
  });

  it("401s for a non-myshopify domain (rejected before any DB lookup)", async () => {
    const res = await middleware(readinessReq("?shop=evil.com"));
    expect(res.status).toBe(401);
    expect(mockShopMaybeSingle).not.toHaveBeenCalled();
  });

  it("resolves the shop from the App Bridge ?host= when ?shop= is absent", async () => {
    mockShopMaybeSingle.mockResolvedValue({
      data: { id: "real-shop-uuid" },
      error: null,
    });
    // base64 of "admin.shopify.com/store/sharpdesk"
    const host = "YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvc2hhcnBkZXNr";
    const res = await middleware(readinessReq(`?host=${host}`));
    expect(res.status).not.toBe(401);
    expect(mockShopMaybeSingle).toHaveBeenCalledTimes(1);
    const fwdShopId =
      res.headers.get("x-middleware-request-x-shop-id") ??
      res.headers.get("x-shop-id");
    expect(fwdShopId).toBe("real-shop-uuid");
  });

  it("401s for a ?host= that decodes to an unknown store (no row)", async () => {
    mockShopMaybeSingle.mockResolvedValue({ data: null, error: null });
    // base64 of "admin.shopify.com/store/evilshop"
    const host = "YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvZXZpbHNob3A=";
    const res = await middleware(readinessReq(`?host=${host}`));
    expect(res.status).toBe(401);
  });

  it("resolves a setup-step POST from the Referer host and overrides a stale cookie", async () => {
    // /api/setup/step carries no ?shop=/?host= in its URL. With a stale
    // shopify_shop_id cookie, the shop_setup INSERT used to 500 on the FK.
    // Middleware must resolve the live shop from the Referer's host.
    mockShopMaybeSingle.mockResolvedValue({
      data: { id: "live-shop-uuid" },
      error: null,
    });
    const req = new NextRequest(new URL("http://localhost/api/setup/step"), {
      method: "POST",
      headers: new Headers({
        referer:
          "https://disputedesk.app/app/setup/store_profile?host=YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvc2hhcnBkZXNr",
      }),
    });
    req.cookies.set("shopify_shop", "sharpdesk.myshopify.com");
    req.cookies.set("shopify_shop_id", "stale-deleted-shop-uuid");
    const res = await middleware(req);
    expect(res.status).not.toBe(401);
    expect(mockShopMaybeSingle).toHaveBeenCalledTimes(1);
    const fwdShopId =
      res.headers.get("x-middleware-request-x-shop-id") ??
      res.headers.get("x-shop-id");
    expect(fwdShopId).toBe("live-shop-uuid");
  });

  it("does NOT override from Referer when the shopify_shop cookie domain disagrees", async () => {
    // Cross-shop guard: a forged Referer for shop B must not redirect a write
    // when the cookie asserts shop A.
    const req = new NextRequest(new URL("http://localhost/api/setup/step"), {
      method: "POST",
      headers: new Headers({
        referer:
          "https://disputedesk.app/app/setup/store_profile?host=YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvc2hhcnBkZXNr",
      }),
    });
    req.cookies.set("shopify_shop", "otherstore.myshopify.com");
    req.cookies.set("shopify_shop_id", "stale-deleted-shop-uuid");
    const res = await middleware(req);
    // No override — the shop lookup never runs.
    expect(mockShopMaybeSingle).not.toHaveBeenCalled();
  });

  it("does NOT apply the domain fallback to other portal APIs", async () => {
    // /api/disputes carries the same ?shop= but must stay 401 — the fallback
    // is scoped strictly to /api/setup/readiness.
    const res = await middleware(
      new NextRequest(
        new URL("http://localhost/api/disputes?shop=sharpdesk.myshopify.com"),
        { headers: new Headers() },
      ),
    );
    expect(res.status).toBe(401);
    expect(mockShopMaybeSingle).not.toHaveBeenCalled();
  });
});
