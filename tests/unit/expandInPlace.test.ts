import { describe, it, expect } from "vitest";
import { reconstructBriefFromItem } from "@/lib/resources/generation/expandInPlace";
import { HUB_CONTENT_LOCALES } from "@/lib/resources/constants";

const item = {
  id: "item-1",
  content_type: "cluster_article",
  primary_pillar: "chargebacks",
  target_keyword: "shopify chargeback returns",
  search_intent: "informational",
  is_hub_article: false,
};

describe("reconstructBriefFromItem", () => {
  it("prefers the en-US title + excerpt when present", () => {
    const brief = reconstructBriefFromItem(item, {
      id: "loc-1",
      locale: "en-US",
      slug: "handling-incomplete-return-chargebacks",
      title: "Handling chargebacks when returns are incomplete",
      excerpt: "What to do when a return stalls.",
    });
    expect(brief.proposedTitle).toBe("Handling chargebacks when returns are incomplete");
    expect(brief.summary).toBe("What to do when a return stalls.");
    expect(brief.contentType).toBe("cluster_article");
    expect(brief.primaryPillar).toBe("chargebacks");
    expect(brief.targetLocales).toEqual([...HUB_CONTENT_LOCALES]);
  });

  it("falls back to target_keyword when there is no en-US localization", () => {
    const brief = reconstructBriefFromItem(item, undefined);
    expect(brief.proposedTitle).toBe("shopify chargeback returns");
    expect(brief.summary).toBeNull();
    expect(brief.targetLocales).toHaveLength(6);
  });
});
