import { describe, it, expect } from "vitest";
import { shopIdentityMatches } from "@/lib/middleware/shopMatch";

describe("shopIdentityMatches", () => {
  it("matches when both values are equal", () => {
    expect(
      shopIdentityMatches("sharpdesk.myshopify.com", "sharpdesk.myshopify.com")
    ).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(
      shopIdentityMatches("Sharpdesk.MyShopify.com", "sharpdesk.myshopify.com")
    ).toBe(true);
  });

  it("does NOT match when the cookie points at a different shop than the URL param", () => {
    // The core bug: cookie is from the previously-opened store, URL is the
    // newly-opened store. Must be detected as a mismatch so middleware re-auths.
    expect(
      shopIdentityMatches("sharpdesk.myshopify.com", "surasvenne.myshopify.com")
    ).toBe(false);
  });

  it("treats a missing URL shop as 'no claim to check' (match)", () => {
    expect(shopIdentityMatches("sharpdesk.myshopify.com", null)).toBe(true);
    expect(shopIdentityMatches("sharpdesk.myshopify.com", undefined)).toBe(true);
    expect(shopIdentityMatches("sharpdesk.myshopify.com", "")).toBe(true);
  });

  it("treats a missing cookie as 'nothing to compare against' (match — handled elsewhere)", () => {
    expect(shopIdentityMatches(null, "surasvenne.myshopify.com")).toBe(true);
    expect(shopIdentityMatches(undefined, "surasvenne.myshopify.com")).toBe(true);
    expect(shopIdentityMatches("", "surasvenne.myshopify.com")).toBe(true);
  });
});
