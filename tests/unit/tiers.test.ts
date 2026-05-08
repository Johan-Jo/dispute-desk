import { describe, it, expect } from "vitest";
import {
  ARCHETYPE_REQUIREMENTS,
  TIER_RANGES,
  inferArchetypeFromContentType,
  inferTierFromContentType,
  normalizeArchetype,
  normalizeTier,
  resolveArchetype,
  resolveTier,
  tierMaximumWords,
  tierMinimumWords,
} from "@/lib/resources/generation/tiers";

describe("inferTierFromContentType", () => {
  it("pillar_page → A", () => {
    expect(inferTierFromContentType("pillar_page")).toBe("A");
  });

  it("isHubArticle=true forces A regardless of content type", () => {
    expect(inferTierFromContentType("cluster_article", true)).toBe("A");
    expect(inferTierFromContentType("checklist", true)).toBe("A");
  });

  it("cluster_article / case_study / legal_update → B", () => {
    expect(inferTierFromContentType("cluster_article")).toBe("B");
    expect(inferTierFromContentType("case_study")).toBe("B");
    expect(inferTierFromContentType("legal_update")).toBe("B");
  });

  it("checklist / template / faq_entry / glossary_entry → C", () => {
    expect(inferTierFromContentType("checklist")).toBe("C");
    expect(inferTierFromContentType("template")).toBe("C");
    expect(inferTierFromContentType("faq_entry")).toBe("C");
    expect(inferTierFromContentType("glossary_entry")).toBe("C");
  });

  it("unknown content types fall through to C (lowest assumption)", () => {
    expect(inferTierFromContentType("wat")).toBe("C");
  });
});

describe("inferArchetypeFromContentType", () => {
  it("pillar_page → authority_pillar", () => {
    expect(inferArchetypeFromContentType("pillar_page")).toBe("authority_pillar");
  });

  it("isHubArticle=true forces authority_pillar even on cluster_article", () => {
    expect(inferArchetypeFromContentType("cluster_article", true)).toBe("authority_pillar");
  });

  it("checklist → checklist_actionable", () => {
    expect(inferArchetypeFromContentType("checklist")).toBe("checklist_actionable");
  });

  it("template → template_fillin", () => {
    expect(inferArchetypeFromContentType("template")).toBe("template_fillin");
  });

  it("faq_entry → faq_qna", () => {
    expect(inferArchetypeFromContentType("faq_entry")).toBe("faq_qna");
  });

  it("glossary_entry → definition_glossary", () => {
    expect(inferArchetypeFromContentType("glossary_entry")).toBe("definition_glossary");
  });

  it("legal_update → regulatory_explainer", () => {
    expect(inferArchetypeFromContentType("legal_update")).toBe("regulatory_explainer");
  });

  it("case_study → case_study", () => {
    expect(inferArchetypeFromContentType("case_study")).toBe("case_study");
  });

  it("cluster_article and unknown → merchant_playbook", () => {
    expect(inferArchetypeFromContentType("cluster_article")).toBe("merchant_playbook");
    expect(inferArchetypeFromContentType("wat")).toBe("merchant_playbook");
  });
});

describe("normalizeTier", () => {
  it("accepts upper-case A B C", () => {
    expect(normalizeTier("A")).toBe("A");
    expect(normalizeTier("B")).toBe("B");
    expect(normalizeTier("C")).toBe("C");
  });

  it("accepts lower-case and trims whitespace", () => {
    expect(normalizeTier(" a ")).toBe("A");
    expect(normalizeTier("c")).toBe("C");
  });

  it("returns null for invalid values", () => {
    expect(normalizeTier("D")).toBeNull();
    expect(normalizeTier("")).toBeNull();
    expect(normalizeTier(null)).toBeNull();
    expect(normalizeTier(undefined)).toBeNull();
  });
});

describe("normalizeArchetype", () => {
  it("accepts known archetypes", () => {
    expect(normalizeArchetype("merchant_playbook")).toBe("merchant_playbook");
    expect(normalizeArchetype(" Authority_Pillar ")).toBe("authority_pillar");
  });

  it("returns null for unknown archetypes", () => {
    expect(normalizeArchetype("blog_post")).toBeNull();
    expect(normalizeArchetype(null)).toBeNull();
  });
});

describe("resolveTier", () => {
  it("explicit tier override wins over inference", () => {
    expect(
      resolveTier({ tier: "C", contentType: "pillar_page", isHubArticle: true })
    ).toBe("C");
  });

  it("falls back to inference when override is null/invalid", () => {
    expect(
      resolveTier({ tier: null, contentType: "pillar_page", isHubArticle: false })
    ).toBe("A");
    expect(
      resolveTier({ tier: "Z", contentType: "cluster_article", isHubArticle: false })
    ).toBe("B");
  });
});

describe("resolveArchetype", () => {
  it("explicit archetype override wins over inference", () => {
    expect(
      resolveArchetype({
        archetype: "evidence_deep_dive",
        contentType: "pillar_page",
        isHubArticle: true,
      })
    ).toBe("evidence_deep_dive");
  });

  it("falls back to inference when override is null/invalid", () => {
    expect(
      resolveArchetype({ archetype: null, contentType: "pillar_page" })
    ).toBe("authority_pillar");
    expect(
      resolveArchetype({ archetype: "wat", contentType: "checklist" })
    ).toBe("checklist_actionable");
  });
});

describe("TIER_RANGES + tier minimum/maximum helpers", () => {
  it("Tier A is the only tier reaching genuine pillar depth", () => {
    expect(TIER_RANGES.A.ceiling).toBeGreaterThanOrEqual(6000);
    expect(TIER_RANGES.A.floor).toBeGreaterThanOrEqual(3000);
    expect(TIER_RANGES.B.ceiling).toBeLessThan(TIER_RANGES.A.ceiling);
    expect(TIER_RANGES.C.ceiling).toBeLessThan(TIER_RANGES.B.ceiling);
  });

  it("tierMinimumWords matches floor", () => {
    expect(tierMinimumWords("A")).toBe(TIER_RANGES.A.floor);
    expect(tierMinimumWords("B")).toBe(TIER_RANGES.B.floor);
    expect(tierMinimumWords("C")).toBe(TIER_RANGES.C.floor);
  });

  it("tierMaximumWords matches ceiling", () => {
    expect(tierMaximumWords("A")).toBe(TIER_RANGES.A.ceiling);
    expect(tierMaximumWords("B")).toBe(TIER_RANGES.B.ceiling);
    expect(tierMaximumWords("C")).toBe(TIER_RANGES.C.ceiling);
  });
});

describe("ARCHETYPE_REQUIREMENTS", () => {
  it("has an entry for every archetype", () => {
    const archetypes = [
      "authority_pillar",
      "merchant_playbook",
      "evidence_deep_dive",
      "regulatory_explainer",
      "comparative_analysis",
      "decision_framework",
      "checklist_actionable",
      "template_fillin",
      "faq_qna",
      "case_study",
      "policy_implementation",
      "tooling_overview",
      "definition_glossary",
    ] as const;
    for (const a of archetypes) {
      const req = ARCHETYPE_REQUIREMENTS[a];
      expect(req, `missing requirements for archetype "${a}"`).toBeDefined();
      expect(req.originalityBlock.length).toBeGreaterThan(50);
      expect(req.mustHaves.length).toBeGreaterThan(0);
    }
  });

  it("authority_pillar requirements mention Shopify specificity", () => {
    const req = ARCHETYPE_REQUIREMENTS.authority_pillar;
    const joined = [req.originalityBlock, ...req.mustHaves].join("\n");
    expect(joined).toMatch(/Shopify/i);
  });

  it("checklist_actionable requirements emphasise verifiable steps", () => {
    const req = ARCHETYPE_REQUIREMENTS.checklist_actionable;
    expect(req.originalityBlock + req.mustHaves.join(" ")).toMatch(/verifiable/i);
  });
});
