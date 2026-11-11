import { describe, it, expect } from "vitest";
import { breakableUrls } from "../DefencePackageDocument";

const ZWSP = "​";

describe("breakableUrls", () => {
  it("adds a break point after each path slash of a long URL, nowhere else", () => {
    const url = "https://checkout.shopify.com/81625612622/policies/41968795982.html?locale=en";
    const out = breakableUrls(`Available at ${url}.`);
    expect(out).toBe(
      `Available at https://checkout.shopify.com/${ZWSP}81625612622/${ZWSP}policies/${ZWSP}41968795982.html?locale=en.`,
    );
    expect(out.replaceAll(ZWSP, "")).toBe(`Available at ${url}.`);
  });

  it("also breaks a long query string after each ampersand (carrier tracking links)", () => {
    const url = "https://www.dhl.com/us-en/home/tracking.html?submit=1&trackingid=4134605023&tracking-id=4134605023";
    const out = breakableUrls(`Carrier tracking record: ${url}`);
    expect(out).toContain(`submit=1&${ZWSP}trackingid=4134605023&${ZWSP}tracking-id=4134605023`);
    expect(out.replaceAll(ZWSP, "")).toBe(`Carrier tracking record: ${url}`);
  });

  it("leaves short URLs and plain prose untouched", () => {
    const text = "See https://shop.example/a/b and the order record.";
    expect(breakableUrls(text)).toBe(text);
  });
});
