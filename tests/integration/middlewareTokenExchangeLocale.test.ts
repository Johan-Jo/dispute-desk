import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Regression for the 2026-10-09 Hem & Trend install: Shopify's `locale` (the
// merchant's Admin language) was only carried inside `return_to`, so the
// token-exchange route never saw it and the shop was stored with the `en-US`
// column default — a Swedish store welcomed in English. Both middleware
// redirects to token-exchange must forward it as its own parameter.

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

const SHOP = "hem-trend.myshopify.com";
const FAKE_ID_TOKEN = "aaa.bbb.ccc";

function appReq(query: string, cookies: Record<string, string>): NextRequest {
  const req = new NextRequest(new URL(`http://localhost/app${query}`), {
    headers: new Headers(),
  });
  for (const [k, v] of Object.entries(cookies)) req.cookies.set(k, v);
  return req;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: null } });
});

describe("middleware /app — forwards Shopify's locale to token-exchange", () => {
  it("forwards locale on the first-load (no cookie) redirect", async () => {
    const res = await middleware(
      appReq(`?shop=${SHOP}&id_token=${FAKE_ID_TOKEN}&locale=sv`, {}),
    );

    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/api/auth/shopify/token-exchange");
    expect(location.searchParams.get("locale")).toBe("sv");
  });

  it("forwards locale on the Stage 3 re-check redirect", async () => {
    const res = await middleware(
      appReq(`?shop=${SHOP}&id_token=${FAKE_ID_TOKEN}&locale=de`, {
        shopify_shop: SHOP,
        shopify_shop_id: "shop-1",
      }),
    );

    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/api/auth/shopify/token-exchange");
    expect(location.searchParams.get("locale")).toBe("de");
  });

  it("omits locale when Shopify sent none", async () => {
    const res = await middleware(
      appReq(`?shop=${SHOP}&id_token=${FAKE_ID_TOKEN}`, {}),
    );

    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/api/auth/shopify/token-exchange");
    expect(location.searchParams.has("locale")).toBe(false);
  });
});
