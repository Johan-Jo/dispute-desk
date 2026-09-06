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

  it("drops a leading www for display", () => {
    // Shopify reports `www.blume.com` as the primary domain and the column
    // stores it that way; only the rendering is tidied.
    expect(
      displayShopDomain({
        primary_domain: "www.blume.com",
        shop_domain: "blume-box.myshopify.com",
      }),
    ).toBe("blume.com");
  });

  it("only strips a LEADING www, never a www inside the name", () => {
    expect(
      displayShopDomain({ primary_domain: "wwwmart.com", shop_domain: "x.myshopify.com" }),
    ).toBe("wwwmart.com");
    expect(
      displayShopDomain({ primary_domain: "shop.wwwx.com", shop_domain: "x.myshopify.com" }),
    ).toBe("shop.wwwx.com");
  });

  it("still differs from the alias after stripping, so the alias line renders", () => {
    // The pages decide whether to show the myshopify line by comparing the
    // DISPLAYED value to shop_domain — stripping must not collapse them.
    const shop = {
      primary_domain: "www.blume.com",
      shop_domain: "blume-box.myshopify.com",
    };
    expect(displayShopDomain(shop)).not.toBe(shop.shop_domain);
  });

  it("equals the alias for a shop with no custom domain, so no second line", () => {
    const shop = {
      primary_domain: "surasvenne.myshopify.com",
      shop_domain: "surasvenne.myshopify.com",
    };
    expect(displayShopDomain(shop)).toBe(shop.shop_domain);
  });

  it("works on a row that omits the column entirely", () => {
    expect(displayShopDomain({ shop_domain: "isj-153.myshopify.com" })).toBe(
      "isj-153.myshopify.com",
    );
  });
});
