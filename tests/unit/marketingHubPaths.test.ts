import { describe, it, expect } from "vitest";
import { isMarketingHubPath } from "@/lib/middleware/marketingHubPaths";

describe("isMarketingHubPath", () => {
  it("matches unprefixed hub roots and nested paths", () => {
    expect(isMarketingHubPath("/resources")).toBe(true);
    expect(isMarketingHubPath("/resources/chargebacks/foo")).toBe(true);
    expect(isMarketingHubPath("/templates")).toBe(true);
    expect(isMarketingHubPath("/glossary/a")).toBe(true);
    expect(isMarketingHubPath("/case-studies/x")).toBe(true);
    expect(isMarketingHubPath("/blog/post")).toBe(true);
  });

  it("matches locale-prefixed hub paths", () => {
    expect(isMarketingHubPath("/sv/resources")).toBe(true);
    expect(isMarketingHubPath("/de/templates/slug")).toBe(true);
  });

  it("does not match marketing home or embedded app", () => {
    expect(isMarketingHubPath("/")).toBe(false);
    expect(isMarketingHubPath("/app/disputes")).toBe(false);
    expect(isMarketingHubPath("/portal/dashboard")).toBe(false);
    expect(isMarketingHubPath("/auth/sign-in")).toBe(false);
  });
});
