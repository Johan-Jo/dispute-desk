/**
 * The dispute header names the ORDER, and links to it.
 *
 * It rendered `dispute.id.slice(0, 8).toUpperCase()` — "Dispute #E8E0E4FC",
 * the first eight characters of our internal UUID. That string exists nowhere
 * in Shopify, nowhere on the order, and is searchable nowhere. It also LOOKS
 * like an order number (same `#` prefix, similar length), so it invites a
 * lookup that cannot succeed — a merchant checking why disputed orders showed
 * no shipment could not get from the dispute back to the order. The list view
 * had shown `order_name` all along, so clicking a row lost the identifier.
 *
 * THE ID IN THE URL IS NOT THE ORDER NUMBER, and that is Shopify's design, not
 * a defect: orders are addressed by internal id (`7429305204929`) and
 * displayed by name (`#352798`). The link and the label differ on purpose.
 */

import { describe, it, expect } from "vitest";
import { getShopifyOrderUrl, getShopifyDisputeUrl } from "@/lib/shopify/shopifyAdminUrl";

describe("getShopifyOrderUrl", () => {
  it("builds the admin URL from the order GID", () => {
    expect(
      getShopifyOrderUrl("blume-box.myshopify.com", "gid://shopify/Order/7429154701505"),
    ).toBe("https://admin.shopify.com/store/blume-box/orders/7429154701505");
  });

  it("the numeric id need not match the order NAME — different identifiers", () => {
    // Order 7429305204929 displays as #352798 in Shopify.
    const url = getShopifyOrderUrl("blume-box.myshopify.com", "gid://shopify/Order/7429305204929");
    expect(url).toContain("/orders/7429305204929");
    expect(url).not.toContain("352798");
  });

  it("tolerates a scheme and a trailing path on the shop domain", () => {
    expect(
      getShopifyOrderUrl("https://blume-box.myshopify.com/admin", "gid://shopify/Order/123"),
    ).toBe("https://admin.shopify.com/store/blume-box/orders/123");
  });

  for (const [label, gid] of [
    ["null", null],
    ["undefined", undefined],
    ["empty", ""],
    ["no numeric tail", "gid://shopify/Order/"],
    ["non-numeric tail", "gid://shopify/Order/not-an-id"],
  ] as Array<[string, string | null | undefined]>) {
    it(`returns null for a ${label} GID — callers render plain text, not a dead link`, () => {
      expect(getShopifyOrderUrl("blume-box.myshopify.com", gid)).toBeNull();
    });
  }

  it("returns null without a shop domain", () => {
    expect(getShopifyOrderUrl(null, "gid://shopify/Order/123")).toBeNull();
    expect(getShopifyOrderUrl("", "gid://shopify/Order/123")).toBeNull();
  });

  it("does not disturb the dispute-evidence URL it sits beside", () => {
    expect(
      getShopifyDisputeUrl("blume-box.myshopify.com", "gid://shopify/ShopifyPaymentsDisputeEvidence/11079844033"),
    ).toBe(
      "https://admin.shopify.com/store/blume-box/payments/dispute_evidences/11079844033",
    );
  });
});
