import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { getPublicSiteBaseUrl, getEmbeddedAppUrl } from "@/lib/email/publicSiteUrl";

describe("getPublicSiteBaseUrl", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined);
    vi.stubEnv("PUBLIC_CANONICAL_URL", undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses NEXT_PUBLIC_APP_URL when set", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.com/");
    expect(getPublicSiteBaseUrl()).toBe("https://example.com");
  });

  it("uses PUBLIC_CANONICAL_URL when NEXT_PUBLIC is unset", () => {
    vi.stubEnv("PUBLIC_CANONICAL_URL", "https://canonical.example/");
    expect(getPublicSiteBaseUrl()).toBe("https://canonical.example");
  });

  it("defaults to disputedesk.app (never preview VERCEL_URL)", () => {
    vi.stubEnv("VERCEL_URL", "branch-abc-foo.vercel.app");
    expect(getPublicSiteBaseUrl()).toBe("https://disputedesk.app");
  });
});

describe("getEmbeddedAppUrl", () => {
  it("links to the app root with ?ddredirect=<path> (not a deep sub-path)", () => {
    // Email CTAs need the top-level Admin app URL so Shopify attaches host/shop;
    // the sub-path travels in ddredirect for the embedded root to navigate to.
    const url = getEmbeddedAppUrl(
      "surasvenne.myshopify.com",
      "disputes/39960467-4310-4943-a540-320050d9a4d6",
    );
    expect(url).toBe(
      "https://admin.shopify.com/store/surasvenne/apps/disputedesk-1?ddredirect=%2Fdisputes%2F39960467-4310-4943-a540-320050d9a4d6",
    );
  });

  it("encodes query strings inside the redirect target", () => {
    const url = getEmbeddedAppUrl(
      "shop.myshopify.com",
      "/disputes?filter=open&sort=due",
    );
    expect(url).toContain("ddredirect=");
    expect(url).toContain(encodeURIComponent("/disputes?filter=open&sort=due"));
  });

  it("falls back to the public app URL when shopDomain is missing", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://disputedesk.app");
    expect(getEmbeddedAppUrl(null, "disputes/123")).toBe(
      "https://disputedesk.app/app/disputes/123",
    );
    vi.unstubAllEnvs();
  });
});
