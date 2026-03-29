import { describe, it, expect } from "vitest";
import {
  resolveTargetWordRange,
  normalizeSearchIntent,
  inferPageRoleFromContentType,
  isNarrowOrComparativePageRole,
  formatLengthGuidance,
} from "@/lib/resources/generation/targetWordRange";

describe("resolveTargetWordRange", () => {
  it("returns explicit brief.targetWordRange when set", () => {
    expect(
      resolveTargetWordRange({
        targetWordRange: "  1200–1600 words  ",
        contentType: "cluster_article",
        searchIntent: "informational",
      })
    ).toBe("1200–1600 words");
  });

  it("uses support + medium defaults for cluster_article without pageRole", () => {
    expect(
      resolveTargetWordRange({
        contentType: "cluster_article",
        searchIntent: "informational",
        complexity: null,
        pageRole: null,
      })
    ).toBe("1100–1500 words");
  });

  it("applies pillar + high complexity", () => {
    expect(
      resolveTargetWordRange({
        contentType: "pillar_page",
        pageRole: "pillar",
        complexity: "high",
        searchIntent: "informational",
      })
    ).toBe("2000–2600 words");
  });

  it("commercial trims max on narrow pages only", () => {
    expect(
      resolveTargetWordRange({
        contentType: "cluster_article",
        pageRole: "support",
        complexity: "medium",
        searchIntent: "commercial",
      })
    ).toBe("1100–1400 words");
  });

  it("commercial does not trim max on pillar", () => {
    expect(
      resolveTargetWordRange({
        contentType: "pillar_page",
        pageRole: "pillar",
        complexity: "low",
        searchIntent: "commercial",
      })
    ).toBe("1800–2400 words");
  });

  it("transactional trims min and max unless pillar", () => {
    expect(
      resolveTargetWordRange({
        contentType: "cluster_article",
        pageRole: "support",
        complexity: "low",
        searchIntent: "transactional",
      })
    ).toBe("900–1300 words");
  });

  it("transactional does not trim pillar", () => {
    expect(
      resolveTargetWordRange({
        contentType: "pillar_page",
        pageRole: "pillar",
        complexity: "low",
        searchIntent: "transactional",
      })
    ).toBe("1800–2400 words");
  });

  it("checklist + medium + transactional: clamp min floor", () => {
    expect(
      resolveTargetWordRange({
        contentType: "cluster_article",
        pageRole: "checklist",
        complexity: "medium",
        searchIntent: "transactional",
      })
    ).toBe("700–1100 words");
  });
});

describe("helpers", () => {
  it("normalizeSearchIntent maps info to informational", () => {
    expect(normalizeSearchIntent("info")).toBe("informational");
  });

  it("inferPageRoleFromContentType maps pillar_page", () => {
    expect(inferPageRoleFromContentType("pillar_page")).toBe("pillar");
  });

  it("isNarrowOrComparativePageRole excludes pillar", () => {
    expect(isNarrowOrComparativePageRole("pillar")).toBe(false);
    expect(isNarrowOrComparativePageRole("support")).toBe(true);
  });
});

describe("formatLengthGuidance", () => {
  it("does not append non-English supplement for en-US", () => {
    const s = formatLengthGuidance("1100–1500 words", "en-US");
    expect(s).not.toContain("Non-English locale");
  });

  it("appends non-English supplement for pt-BR", () => {
    const s = formatLengthGuidance("1100–1500 words", "pt-BR");
    expect(s).toContain("Non-English locale");
    expect(s).toContain("1100–1500 words");
  });
});
