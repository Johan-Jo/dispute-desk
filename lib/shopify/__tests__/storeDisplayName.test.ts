import { describe, it, expect } from "vitest";
import { storeDisplayName } from "../storeDisplayName";

describe("storeDisplayName", () => {
  it("returns the merchant's store name", () => {
    expect(
      storeDisplayName({ shop_name: "  Mein Maison ", primary_domain: "meinmaison.com" }),
    ).toBe("Mein Maison");
  });

  it("falls back to the custom storefront domain when no name is on record", () => {
    expect(storeDisplayName({ shop_name: null, primary_domain: "www.blume.com" })).toBe(
      "blume.com",
    );
  });

  it("never returns a myshopify host", () => {
    expect(
      storeDisplayName({ shop_name: "", primary_domain: "whj8db-1q.myshopify.com" }),
    ).toBeNull();
    expect(storeDisplayName({ shop_name: null, primary_domain: null })).toBeNull();
    expect(storeDisplayName(null)).toBeNull();
  });
});
