import { describe, it, expect } from "vitest";
import { assessGeneratedSimilarity } from "@/lib/resources/generation/similarity";
import type { SimilarContentReference } from "@/lib/resources/generation/prompts";

describe("assessGeneratedSimilarity", () => {
  const similar: SimilarContentReference[] = [
    {
      id: "1",
      locale: "en-US",
      title: "How merchants can prevent chargebacks effectively",
      slug: "prevent-chargebacks",
      excerpt: "Practical steps to reduce disputes before they escalate.",
      primaryKeyword: "chargeback",
      contentType: "cluster_article",
    },
  ];

  it("passes when distinct from corpus and slug free", () => {
    const r = assessGeneratedSimilarity(
      {
        title: "Shopify dispute evidence checklist for high-risk orders",
        excerpt: "A workflow for assembling representment documents under time pressure.",
        slug: "shopify-evidence-checklist",
      },
      similar,
      false
    );
    expect(r.ok).toBe(true);
  });

  it("fails on DB slug collision", () => {
    const r = assessGeneratedSimilarity(
      { title: "Unique title here", excerpt: "Unique excerpt.", slug: "taken-slug" },
      [],
      true
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("slug_collision");
  });

  it("fails when slug matches a similar reference", () => {
    const r = assessGeneratedSimilarity(
      {
        title: "Totally different article",
        excerpt: "Different body.",
        slug: "prevent-chargebacks",
      },
      similar,
      false
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("slug_collision");
  });

  it("fails when title is too similar (high word overlap)", () => {
    const r = assessGeneratedSimilarity(
      {
        title: "How merchants can prevent chargebacks successfully",
        excerpt: "Something unrelated to force title signal.",
        slug: "new-slug-only",
      },
      similar,
      false
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("title_too_similar");
  });

  it("fails when title+excerpt combo overlaps strongly", () => {
    const r = assessGeneratedSimilarity(
      {
        title: "How chargebacks escalate for merchants today",
        excerpt: "Practical steps to reduce disputes before they escalate.",
        slug: "another-slug",
      },
      similar,
      false
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("title_excerpt_too_similar");
  });
});
