import { describe, it, expect } from "vitest";
import {
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_USER_PROMPT_SUFFIX,
  resolveGenerationPrompts,
  buildUserPrompt,
  DEFAULT_CONTENT_TYPE_INSTRUCTIONS,
} from "@/lib/resources/generation/prompts";
import type { GenerationBrief, SimilarContentReference } from "@/lib/resources/generation/prompts";

describe("resolveGenerationPrompts", () => {
  it("uses built-in defaults when settings are empty", () => {
    const r = resolveGenerationPrompts({});
    expect(r.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(r.userPromptSuffix).toBe(DEFAULT_USER_PROMPT_SUFFIX);
    expect(r.userPromptSuffix).toContain("Originality and anti-repetition requirements");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("B2B ecommerce content strategist");
    expect(r.localeInstructions["sv-SE"]).toContain("Återbetalningskrav");
    expect(r.contentTypeInstructions["cluster_article"]).toBe(
      DEFAULT_CONTENT_TYPE_INSTRUCTIONS["cluster_article"]
    );
  });

  it("overrides system prompt when non-empty string is set", () => {
    const r = resolveGenerationPrompts({ generationSystemPrompt: "CUSTOM SYSTEM ONLY" });
    expect(r.systemPrompt).toBe("CUSTOM SYSTEM ONLY");
  });

  it("uses custom user suffix when key is present", () => {
    const r = resolveGenerationPrompts({ generationUserPromptSuffix: "Never repeat openings." });
    expect(r.userPromptSuffix).toBe("Never repeat openings.");
  });

  it("uses empty user suffix when key is present as empty string", () => {
    const r = resolveGenerationPrompts({ generationUserPromptSuffix: "" });
    expect(r.userPromptSuffix).toBe("");
  });

  it("merges locale instructions: empty override values are ignored", () => {
    const r = resolveGenerationPrompts({
      generationLocaleInstructions: { "sv-SE": "", "en-US": "Custom EN" },
    });
    expect(r.localeInstructions["sv-SE"]).toContain("Återbetalningskrav");
    expect(r.localeInstructions["en-US"]).toBe("Custom EN");
  });
});

describe("buildUserPrompt", () => {
  const brief: GenerationBrief = {
    archiveItemId: "a1",
    proposedTitle: "Test topic",
    contentType: "cluster_article",
    primaryPillar: "p1",
    targetKeyword: "kw",
    searchIntent: "info",
    summary: "sum",
    notes: null,
    targetLocales: ["en-US"],
  };

  const emptyCtx = { similarArticles: [] as SimilarContentReference[] };

  it("includes additional instructions when suffix is set", () => {
    const resolved = resolveGenerationPrompts({
      generationUserPromptSuffix: "Vary headline structure.",
    });
    const p = buildUserPrompt(brief, "en-US", resolved, emptyCtx);
    expect(p).toContain("Vary headline structure.");
    expect(p).toContain("TARGET KEYWORD: kw");
  });

  it("omits overlap section when similar list is empty", () => {
    const resolved = resolveGenerationPrompts({});
    const p = buildUserPrompt(brief, "en-US", resolved, { similarArticles: [] });
    expect(p).not.toContain("Existing DisputeDesk articles with topical overlap:");
  });

  it("includes compact similar-article context when provided", () => {
    const resolved = resolveGenerationPrompts({ generationUserPromptSuffix: "" });
    const p = buildUserPrompt(brief, "en-US", resolved, {
      similarArticles: [
        {
          id: "loc-1",
          locale: "en-US",
          title: "How to fight chargebacks",
          slug: "fight-chargebacks",
          excerpt: "A guide for merchants.",
          primaryKeyword: "chargeback",
          contentType: "cluster_article",
          headings: ["Why it matters", "Evidence"],
          introSnippet: "Chargebacks cost merchants real money.",
        },
      ],
    });
    expect(p).toContain("Existing DisputeDesk articles with topical overlap:");
    expect(p).toContain("How to fight chargebacks");
    expect(p).toContain("fight-chargebacks");
    expect(p).toContain("Why it matters | Evidence");
    expect(p).toContain("Do not reuse title patterns");
  });
});
