import { describe, it, expect } from "vitest";
import { decideAlert } from "@/lib/signal-radar/alerts";

function input(over: Partial<Parameters<typeof decideAlert>[0]["analysis"]> = {}) {
  return {
    analysis: {
      category: "transparency_frustration" as const,
      signal_score: 8,
      source_confidence_score: 8,
      dispute_relevance: false,
      ...over,
    },
    platform: "reddit",
    subreddit: "r/shopify",
    cluster_key: "abc123",
  };
}

describe("decideAlert", () => {
  it("fires immediate for transparency_frustration with score >= 6", () => {
    const d = decideAlert(input({ signal_score: 6 }));
    expect(d.kind).toBe("immediate");
    expect(d.category_dedup_key).toBe(
      "immediate:transparency_frustration:reddit:r/shopify"
    );
    expect(d.cluster_dedup_key).toBe("immediate:cluster:abc123");
    expect(d.category_cooldown_hours).toBe(4);
  });

  it("transparency_frustration below 6 is digest", () => {
    const d = decideAlert(input({ signal_score: 5 }));
    expect(d.kind).toBe("digest");
  });

  it("fires migration_intent at score 6 with no category cooldown", () => {
    const d = decideAlert(
      input({ category: "migration_intent", signal_score: 6 })
    );
    expect(d.kind).toBe("immediate");
    expect(d.category_cooldown_hours).toBeNull();
    expect(d.cluster_cooldown_hours).toBe(24);
    expect(d.reason).toBe("migration_intent");
  });

  it("requires score >= 7 for reserve_fear", () => {
    const lower = decideAlert(input({ category: "reserve_fear", signal_score: 6 }));
    expect(lower.kind).toBe("digest");
    const higher = decideAlert(input({ category: "reserve_fear", signal_score: 7 }));
    expect(higher.kind).toBe("immediate");
  });

  it("fires immediate for competitor_frustration at score >= 6", () => {
    const d = decideAlert(
      input({ category: "competitor_frustration", signal_score: 6 })
    );
    expect(d.kind).toBe("immediate");
  });

  it("source_confidence_score < 5 falls through to digest regardless of category", () => {
    const d = decideAlert(
      input({ category: "migration_intent", signal_score: 10, source_confidence_score: 4 })
    );
    expect(d.kind).toBe("digest");
    expect(d.reason).toBe("below_confidence_gate");
  });

  it("general_discussion without dispute relevance is digest even at high score", () => {
    const d = decideAlert(input({ category: "general_discussion", signal_score: 10 }));
    expect(d.kind).toBe("digest");
  });

  it("fires dispute_pain_high_signal for a dispute-relevant non-alert category at score >= 7", () => {
    const d = decideAlert(
      input({
        category: "operational_overload",
        signal_score: 7,
        dispute_relevance: true,
      })
    );
    expect(d.kind).toBe("immediate");
    expect(d.reason).toBe("dispute_pain_high_signal");
    expect(d.category_cooldown_hours).toBe(4);
    // Dedup key still keys off the item's actual category.
    expect(d.category_dedup_key).toBe(
      "immediate:operational_overload:reddit:r/shopify"
    );
  });

  it("dispute-relevant but below score 7 stays digest", () => {
    const d = decideAlert(
      input({
        category: "evidence_confusion",
        signal_score: 6,
        dispute_relevance: true,
      })
    );
    expect(d.kind).toBe("digest");
  });

  it("dispute-relevant high score still gated by confidence < 5", () => {
    const d = decideAlert(
      input({
        category: "operational_overload",
        signal_score: 9,
        dispute_relevance: true,
        source_confidence_score: 4,
      })
    );
    expect(d.kind).toBe("digest");
    expect(d.reason).toBe("below_confidence_gate");
  });

  it("emits null cluster_dedup_key when cluster_key is null", () => {
    const d = decideAlert({
      analysis: {
        category: "transparency_frustration",
        signal_score: 9,
        source_confidence_score: 8,
        dispute_relevance: false,
      },
      platform: "reddit",
      subreddit: "r/shopify",
      cluster_key: null,
    });
    expect(d.cluster_dedup_key).toBeNull();
  });

  it("uses '_' as subreddit placeholder when null", () => {
    const d = decideAlert({
      analysis: {
        category: "transparency_frustration",
        signal_score: 9,
        source_confidence_score: 8,
        dispute_relevance: false,
      },
      platform: "shopify_community",
      subreddit: null,
      cluster_key: "x",
    });
    expect(d.category_dedup_key).toBe(
      "immediate:transparency_frustration:shopify_community:_"
    );
  });
});
