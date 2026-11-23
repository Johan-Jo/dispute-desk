import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestShopifyGraphQL } from "../graphql";
import {
  classifyShopify403,
  isPossibleAllowlist403,
  ShopifyIpNotAllowlistedError,
  SHOPIFY_IP_403_TAG,
} from "../ipAllowlist403";
import { detectAuthInvalidReason } from "../sessions/getShopBackgroundSession";

const session = { shopDomain: "demo.myshopify.com", accessToken: "shpat_secret" };

function mockFetchOnce(status: number, body: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(body, { status })),
  );
}

describe("ipAllowlist403 classifier", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("treats any non-scope 403 as a possible allowlist block", () => {
    expect(isPossibleAllowlist403(403, "")).toBe(true);
    expect(isPossibleAllowlist403(403, "<html>Forbidden</html>")).toBe(true);
    expect(isPossibleAllowlist403(403, '{"errors":"Access denied"}')).toBe(true);
  });

  it("does not treat a scope verdict, or other statuses, as an allowlist block", () => {
    expect(isPossibleAllowlist403(403, "This action requires merchant approval for read_orders")).toBe(false);
    expect(isPossibleAllowlist403(401, "")).toBe(false);
    expect(isPossibleAllowlist403(200, "")).toBe(false);
  });

  it("logs one structured line with status, class, shop, endpoint and correlation id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = classifyShopify403(
      "https://demo.myshopify.com/admin/api/2026-01/shopify_payments/disputes/12345/dispute_file_uploads.json",
      "<html>blocked</html>",
      "save-job-9",
    );
    expect(err).toBeInstanceOf(ShopifyIpNotAllowlistedError);
    expect(warn).toHaveBeenCalledTimes(1);
    const [tag, json] = warn.mock.calls[0] as [string, string];
    expect(tag).toBe(SHOPIFY_IP_403_TAG);
    expect(JSON.parse(json)).toEqual({
      status: 403,
      classification: "possible_ip_allowlist_403",
      shop: "demo.myshopify.com",
      endpoint: "/admin/api/2026-01/shopify_payments/disputes/:id/dispute_file_uploads.json",
      bodyBytes: 20,
      bodyKind: "html",
      correlationId: "save-job-9",
    });
  });

  it("never puts Shopify's response body, a token, or a numeric id in the log or the error", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = JSON.stringify({ errors: "jane.doe@example.com order #98765 shpat_secret_token" });
    const err = classifyShopify403(
      "https://demo.myshopify.com/admin/api/2026-01/orders/98765.json",
      body,
    ) as ShopifyIpNotAllowlistedError;
    const everything = JSON.stringify(warn.mock.calls) + err.message + JSON.stringify(err);
    expect(everything).not.toContain("jane.doe");
    expect(everything).not.toContain("shpat_");
    expect(everything).not.toContain("98765");
  });
});

describe("requestShopifyGraphQL on 403", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("throws ShopifyIpNotAllowlistedError for a JSON 'Access denied' 403 instead of returning an auth-invalid-looking envelope", async () => {
    mockFetchOnce(403, JSON.stringify({ errors: "Access denied" }));
    await expect(
      requestShopifyGraphQL({ session, query: "{ shop { id } }" }),
    ).rejects.toBeInstanceOf(ShopifyIpNotAllowlistedError);
  });

  it("throws the typed error (not a SyntaxError) for a non-JSON 403 body", async () => {
    mockFetchOnce(403, "<html>403 Forbidden</html>");
    await expect(
      requestShopifyGraphQL({ session, query: "{ shop { id } }" }),
    ).rejects.toBeInstanceOf(ShopifyIpNotAllowlistedError);
  });

  it("keeps the envelope for a 403 that is a scope verdict", async () => {
    mockFetchOnce(403, JSON.stringify({ errors: "requires merchant approval for read_orders" }));
    const res = await requestShopifyGraphQL({ session, query: "{ shop { id } }" });
    expect(res.errors?.[0]?.message).toContain("merchant approval");
  });

  it("leaves a real 401 and a 200 untouched", async () => {
    mockFetchOnce(401, JSON.stringify({ errors: "Invalid API key or access token" }));
    const res401 = await requestShopifyGraphQL({ session, query: "{ shop { id } }" });
    expect(detectAuthInvalidReason(res401)).toMatch(/invalid api key/i);

    mockFetchOnce(200, JSON.stringify({ data: { shop: { id: "1" } } }));
    const ok = await requestShopifyGraphQL<{ shop: { id: string } }>({
      session,
      query: "{ shop { id } }",
    });
    expect(ok.data?.shop.id).toBe("1");
  });
});
