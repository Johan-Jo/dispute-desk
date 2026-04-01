import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getMarketingShopifyAppInstallUrl } from "@/lib/marketing/shopifyInstallUrl";

describe("getMarketingShopifyAppInstallUrl", () => {
  const prev = process.env.NEXT_PUBLIC_SHOPIFY_APP_STORE_URL;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SHOPIFY_APP_STORE_URL;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_SHOPIFY_APP_STORE_URL;
    else process.env.NEXT_PUBLIC_SHOPIFY_APP_STORE_URL = prev;
  });

  it("uses env when set", () => {
    process.env.NEXT_PUBLIC_SHOPIFY_APP_STORE_URL = "https://apps.shopify.com/disputedesk";
    expect(getMarketingShopifyAppInstallUrl()).toBe("https://apps.shopify.com/disputedesk");
  });

  it("falls back to App Store search when unset", () => {
    expect(getMarketingShopifyAppInstallUrl()).toBe(
      "https://apps.shopify.com/search?q=DisputeDesk"
    );
  });
});
