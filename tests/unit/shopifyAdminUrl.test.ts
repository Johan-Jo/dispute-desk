import { describe, expect, it } from "vitest";
import { getShopifyDisputeUrl } from "@/lib/shopify/shopifyAdminUrl";

/**
 * Regression: the "Submit now in Shopify Admin" CTA previously produced
 * https://{shop_domain}/admin/payments/dispute_evidences/{dispute_gid_numeric}
 * — wrong in two ways: (1) URL format has moved to admin.shopify.com/store/…,
 * (2) the numeric ID must be the ShopifyPaymentsDisputeEvidence's, not the
 * ShopifyPaymentsDispute's. Callers that passed dispute_gid got a dead page.
 */
describe("getShopifyDisputeUrl", () => {
  it("returns the canonical admin.shopify.com URL with the evidence numeric id", () => {
    const url = getShopifyDisputeUrl(
      "surasvenne.myshopify.com",
      "gid://shopify/ShopifyPaymentsDisputeEvidence/10484056121",
    );
    expect(url).toBe(
      "https://admin.shopify.com/store/surasvenne/payments/dispute_evidences/10484056121",
    );
  });

  it("accepts shop handle without .myshopify.com suffix", () => {
    const url = getShopifyDisputeUrl(
      "surasvenne",
      "gid://shopify/ShopifyPaymentsDisputeEvidence/10484056121",
    );
    expect(url).toBe(
      "https://admin.shopify.com/store/surasvenne/payments/dispute_evidences/10484056121",
    );
  });

  it("returns null when disputeEvidenceGid is missing — callers must hide the CTA", () => {
    expect(getShopifyDisputeUrl("surasvenne.myshopify.com", null)).toBeNull();
    expect(getShopifyDisputeUrl("surasvenne.myshopify.com", undefined)).toBeNull();
    expect(getShopifyDisputeUrl("surasvenne.myshopify.com", "")).toBeNull();
  });

  it("returns null when shopDomain cannot produce a handle", () => {
    expect(
      getShopifyDisputeUrl("", "gid://shopify/ShopifyPaymentsDisputeEvidence/1"),
    ).toBeNull();
  });
});
