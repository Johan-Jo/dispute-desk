import { describe, it, expect } from "vitest";
import { shouldShowRecommendationBanner } from "../persistRecommendation";

describe("shouldShowRecommendationBanner", () => {
  it("never shows for a Free recommendation", () => {
    expect(shouldShowRecommendationBanner("free", null)).toBe(false);
    // Even an impossible dismissal state can't surface a Free banner.
    expect(shouldShowRecommendationBanner("free", "starter")).toBe(false);
  });

  it("shows a paid recommendation that was never dismissed", () => {
    expect(shouldShowRecommendationBanner("starter", null)).toBe(true);
    expect(shouldShowRecommendationBanner("growth", null)).toBe(true);
    expect(shouldShowRecommendationBanner("scale", null)).toBe(true);
  });

  it("hides a paid recommendation the merchant dismissed for that exact plan", () => {
    expect(shouldShowRecommendationBanner("starter", "starter")).toBe(false);
    expect(shouldShowRecommendationBanner("growth", "growth")).toBe(false);
  });

  it("re-surfaces when the recommendation escalates past the dismissed plan", () => {
    // Merchant dismissed Starter; volume grew and we now recommend Growth.
    // The dismissal no longer matches, so the banner returns.
    expect(shouldShowRecommendationBanner("growth", "starter")).toBe(true);
    expect(shouldShowRecommendationBanner("scale", "growth")).toBe(true);
  });

  it("re-surfaces when the recommendation de-escalates to a different paid plan", () => {
    // Symmetric: any change to a different plan is a fresh signal.
    expect(shouldShowRecommendationBanner("starter", "growth")).toBe(true);
  });
});
