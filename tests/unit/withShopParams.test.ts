import { describe, it, expect } from "vitest";
import { withShopParams } from "@/lib/withShopParams";

describe("withShopParams", () => {
  it("appends shop and host from URLSearchParams", () => {
    const sp = new URLSearchParams({ shop: "test.myshopify.com", host: "abc123" });
    const result = withShopParams("/app/setup/permissions", sp);
    expect(result).toBe("/app/setup/permissions?shop=test.myshopify.com&host=abc123");
  });

  it("appends only shop when host is missing", () => {
    const sp = new URLSearchParams({ shop: "test.myshopify.com" });
    const result = withShopParams("/app/setup", sp);
    expect(result).toBe("/app/setup?shop=test.myshopify.com");
  });

  it("appends only host when shop is missing", () => {
    const sp = new URLSearchParams({ host: "abc123" });
    const result = withShopParams("/app", sp);
    expect(result).toBe("/app?host=abc123");
  });

  it("returns plain pathname when neither param is present", () => {
    const sp = new URLSearchParams();
    const result = withShopParams("/app/setup", sp);
    expect(result).toBe("/app/setup");
  });

  it("ignores extra params in the source URLSearchParams", () => {
    const sp = new URLSearchParams({ shop: "s.myshopify.com", host: "h1", extra: "ignored" });
    const result = withShopParams("/test", sp);
    expect(result).toBe("/test?shop=s.myshopify.com&host=h1");
  });

  it("works with Record<string,string> input", () => {
    const result = withShopParams("/app", { shop: "s.myshopify.com", host: "h1" });
    expect(result).toBe("/app?shop=s.myshopify.com&host=h1");
  });

  it("works with empty Record input", () => {
    const result = withShopParams("/app", {});
    expect(result).toBe("/app");
  });
});
