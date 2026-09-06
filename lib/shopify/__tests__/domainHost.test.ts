import { describe, it, expect } from "vitest";
import { toDomainHost, displayShopDomain } from "../domainHost";

describe("toDomainHost", () => {
  it("strips the scheme and trailing slash Shopify sends", () => {
    // The literal shape of `Shop.primaryDomain.url`.
    expect(toDomainHost("https://meinmaison.com/")).toBe("meinmaison.com");
  });

  it("keeps the myshopify host when the shop has no custom domain", () => {
    // Not a fallback — for such a shop this IS its primary domain, so the
    // stored value equals `shop_domain` and the UI shows one line.
    expect(toDomainHost("https://6a8848-dd.myshopify.com")).toBe(
      "6a8848-dd.myshopify.com",
    );
  });

  it("lowercases, so the stored value compares to shop_domain directly", () => {
    expect(toDomainHost("https://MeinMaison.com")).toBe("meinmaison.com");
  });

  it("drops path, query and port noise", () => {
    expect(toDomainHost("https://shop.example.com/collections/all?x=1")).toBe(
      "shop.example.com",
    );
  });

  it("tolerates a bare host rather than discarding a usable value", () => {
    expect(toDomainHost("meinmaison.com")).toBe("meinmaison.com");
  });

  it("returns null for empty/absent input so nothing is written", () => {
    expect(toDomainHost(null)).toBeNull();
    expect(toDomainHost(undefined)).toBeNull();
    expect(toDomainHost("   ")).toBeNull();
  });

  it("returns null on an unparseable value instead of throwing", () => {
    // A throw here would abort persistShopCurrency and lose the currency and
    // name writes too.
    expect(toDomainHost("http://")).toBeNull();
  });
});

describe("displayShopDomain", () => {
  it("prefers the real storefront domain", () => {
    expect(
      displayShopDomain({
        primary_domain: "meinmaison.com",
        shop_domain: "6a8848-dd.myshopify.com",
      }),
    ).toBe("meinmaison.com");
  });

  it("falls back to the alias for shops predating the backfill", () => {
    expect(
      displayShopDomain({ primary_domain: null, shop_domain: "isj-153.myshopify.com" }),
    ).toBe("isj-153.myshopify.com");
  });

  it("falls back when the column holds only whitespace", () => {
    expect(
      displayShopDomain({ primary_domain: "  ", shop_domain: "isj-153.myshopify.com" }),
    ).toBe("isj-153.myshopify.com");
  });

  it("works on a row that omits the column entirely", () => {
    expect(displayShopDomain({ shop_domain: "isj-153.myshopify.com" })).toBe(
      "isj-153.myshopify.com",
    );
  });
});
