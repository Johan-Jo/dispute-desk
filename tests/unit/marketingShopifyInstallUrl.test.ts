import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getMarketingShopifyAppInstallUrl } from "@/lib/marketing/shopifyInstallUrl";

describe("getMarketingShopifyAppInstallUrl", () => {
  const prevStore = process.env.NEXT_PUBLIC_SHOPIFY_APP_STORE_URL;
  const prevAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const prevCanonical = process.env.PUBLIC_CANONICAL_URL;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SHOPIFY_APP_STORE_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.PUBLIC_CANONICAL_URL;
  });

  afterEach(() => {
    if (prevStore === undefined) delete process.env.NEXT_PUBLIC_SHOPIFY_APP_STORE_URL;
    else process.env.NEXT_PUBLIC_SHOPIFY_APP_STORE_URL = prevStore;
    if (prevAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prevAppUrl;
    if (prevCanonical === undefined) delete process.env.PUBLIC_CANONICAL_URL;
    else process.env.PUBLIC_CANONICAL_URL = prevCanonical;
  });

  it("always uses /#pricing, even when NEXT_PUBLIC_SHOPIFY_APP_STORE_URL is set", () => {
    // We deliberately route install CTAs to the on-site direct-install pop-up
    // (shop domain → OAuth) and never to the App Store listing, so the env var
    // is intentionally ignored.
    process.env.NEXT_PUBLIC_SHOPIFY_APP_STORE_URL = "https://apps.shopify.com/disputedesk";
    expect(getMarketingShopifyAppInstallUrl()).toBe("https://disputedesk.app/#pricing");
  });

  it("uses /#pricing on public origin when App Store URL unset", () => {
    expect(getMarketingShopifyAppInstallUrl()).toBe(
      "https://disputedesk.app/#pricing"
    );
  });

  it("uses NEXT_PUBLIC_APP_URL for fallback base when set", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://preview.example.com";
    expect(getMarketingShopifyAppInstallUrl()).toBe(
      "https://preview.example.com/#pricing"
    );
  });
});
