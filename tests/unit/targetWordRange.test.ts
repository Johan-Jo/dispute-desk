import { describe, it, expect } from "vitest";
import {
  resolveTargetWordRange,
  normalizeSearchIntent,
  inferPageRoleFromContentType,
  isNarrowOrComparativePageRole,
  formatLengthGuidance,
} from "@/lib/resources/generation/targetWordRange";

/* ── Tier A (pillar) ─────────────────────────────────────────────────── */

describe("resolveTargetWordRange — Tier A (authority pillars)", () => {
  it("pillar_page + medium complexity → tier A base + medium uplift", () => {
    expect(
      resolveTargetWordRange({
        contentType: "pillar_page",
        pageRole: "pillar",
        complexity: "medium",
        searchIntent: "informational",
      })
    ).toBe("3700–5200 words");
  });

  it("pillar_page + high complexity reaches deep into Tier A", () => {
    expect(
      resolveTargetWordRange({
        contentType: "pillar_page",
        pageRole: "pillar",
        complexity: "high",
        searchIntent: "informational",
      })
    ).toBe("4000–5500 words");
  });

  it("commercial intent does NOT trim Tier A (pillars stay long)", () => {
    expect(
      resolveTargetWordRange({
        contentType: "pillar_page",
        pageRole: "pillar",
        complexity: "low",
        searchIntent: "commercial",
      })
    ).toBe("3500–5000 words");
  });

  it("isHubArticle=true promotes tier to A even when content_type is cluster_article", () => {
    expect(
      resolveTargetWordRange({
        contentType: "cluster_article",
        complexity: "medium",
        searchIntent: "informational",
        isHubArticle: true,
      })
    ).toBe("3700–5200 words");
  });

  it("explicit tier=A overrides content_type", () => {
    expect(
      resolveTargetWordRange({
        contentType: "cluster_article",
        complexity: "low",
        searchIntent: "informational",
        tier: "A",
      })
    ).toBe("3500–5000 words");
  });

  it("Tier A ceiling caps high-complexity high-uplift", () => {
    // base 3500–5000, +500 uplift → 4000–5500. Even pushing further would cap at 6000.
    const r = resolveTargetWordRange({
      contentType: "pillar_page",
      complexity: "high",
      searchIntent: "informational",
    });
    const max = Number(r.split("–")[1].split(" ")[0]);
    expect(max).toBeLessThanOrEqual(6000);
  });
});

/* ── Tier B (operational support) ───────────────────────────────────── */

describe("resolveTargetWordRange — Tier B (cluster / case study / legal update)", () => {
  it("cluster_article + medium → tier B base + medium uplift", () => {
    expect(
      resolveTargetWordRange({
        contentType: "cluster_article",
        complexity: "medium",
        searchIntent: "informational",
      })
    ).toBe("1900–2500 words");
  });

  it("cluster_article + high → tier B base + high uplift", () => {
    expect(
      resolveTargetWordRange({
        contentType: "cluster_article",
        complexity: "high",
        searchIntent: "informational",
      })
    ).toBe("2100–2700 words");
  });

  it("commercial intent trims max on narrow Tier B pages", () => {
    expect(
      resolveTargetWordRange({
        contentType: "cluster_article",
        pageRole: "support",
        complexity: "medium",
        searchIntent: "commercial",
      })
    ).toBe("1900–2400 words");
  });

  it("legal_update routes to Tier B", () => {
    expect(
      resolveTargetWordRange({
        contentType: "legal_update",
        complexity: "low",
        searchIntent: "informational",
      })
    ).toBe("1800–2400 words");
  });
});

/* ── Tier C (focused short-form) ────────────────────────────────────── */

describe("resolveTargetWordRange — Tier C (checklist / template / faq / glossary)", () => {
  it("checklist + medium → tier C base, with checklist page-role downward bump", () => {
    // Base [1000, 1400], +100 medium uplift → [1100, 1500], -200 checklist adjustment → [900, 1300]
    expect(
      resolveTargetWordRange({
        contentType: "checklist",
        complexity: "medium",
        searchIntent: "informational",
      })
    ).toBe("900–1300 words");
  });

  it("template + low → tier C base, with template downward bump", () => {
    expect(
      resolveTargetWordRange({
        contentType: "template",
        complexity: "low",
        searchIntent: "informational",
      })
    ).toBe("800–1200 words");
  });

  it("faq_entry + low → tier C base with faq downward bump", () => {
    expect(
      resolveTargetWordRange({
        contentType: "faq_entry",
        complexity: "low",
        searchIntent: "informational",
      })
    ).toBe("900–1300 words");
  });

  it("glossary_entry + low → tier C base (no page-role bump for glossary)", () => {
    expect(
      resolveTargetWordRange({
        contentType: "glossary_entry",
        complexity: "low",
        searchIntent: "informational",
      })
    ).toBe("1000–1400 words");
  });

  it("transactional intent trims Tier C ranges", () => {
    expect(
      resolveTargetWordRange({
        contentType: "checklist",
        complexity: "medium",
        searchIntent: "transactional",
      })
    ).toBe("800–1200 words");
  });
});

/* ── Explicit override + helpers ────────────────────────────────────── */

describe("resolveTargetWordRange — explicit overrides + helpers", () => {
  it("returns explicit brief.targetWordRange verbatim", () => {
    expect(
      resolveTargetWordRange({
        targetWordRange: "  1200–1600 words  ",
        contentType: "cluster_article",
        searchIntent: "informational",
      })
    ).toBe("1200–1600 words");
  });

  it("explicit tier=C overrides hub-pillar content type", () => {
    expect(
      resolveTargetWordRange({
        contentType: "pillar_page",
        complexity: "low",
        searchIntent: "informational",
        tier: "C",
      })
    ).toBe("1000–1400 words");
  });
});

describe("helpers", () => {
  it("normalizeSearchIntent maps info to informational", () => {
    expect(normalizeSearchIntent("info")).toBe("informational");
  });

  it("inferPageRoleFromContentType maps pillar_page", () => {
    expect(inferPageRoleFromContentType("pillar_page")).toBe("pillar");
  });

  it("inferPageRoleFromContentType maps checklist", () => {
    expect(inferPageRoleFromContentType("checklist")).toBe("checklist");
  });

  it("isNarrowOrComparativePageRole excludes pillar", () => {
    expect(isNarrowOrComparativePageRole("pillar")).toBe(false);
    expect(isNarrowOrComparativePageRole("support")).toBe(true);
  });
});

describe("formatLengthGuidance", () => {
  it("does not append non-English supplement for en-US", () => {
    const s = formatLengthGuidance("3700–5200 words", "en-US");
    expect(s).not.toContain("Non-English locale");
  });

  it("appends non-English supplement for pt-BR", () => {
    const s = formatLengthGuidance("3700–5200 words", "pt-BR");
    expect(s).toContain("Non-English locale");
    expect(s).toContain("3700–5200 words");
  });

  it("communicates pad-padding is forbidden in the base block", () => {
    const s = formatLengthGuidance("1800–2400 words", "en-US");
    expect(s).toMatch(/pad/i);
  });
});
