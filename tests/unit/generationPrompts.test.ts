import { describe, it, expect } from "vitest";
import {
  DEFAULT_SYSTEM_PROMPT,
  resolveGenerationPrompts,
  buildUserPrompt,
  DEFAULT_CONTENT_TYPE_INSTRUCTIONS,
} from "@/lib/resources/generation/prompts";
import type { GenerationBrief } from "@/lib/resources/generation/prompts";

describe("resolveGenerationPrompts", () => {
  it("uses built-in defaults when settings are empty", () => {
    const r = resolveGenerationPrompts({});
    expect(r.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(r.userPromptSuffix).toBe("");
    expect(r.localeInstructions["sv-SE"]).toContain("Återbetalningskrav");
    expect(r.contentTypeInstructions["cluster_article"]).toBe(
      DEFAULT_CONTENT_TYPE_INSTRUCTIONS["cluster_article"]
    );
  });

  it("overrides system prompt when non-empty string is set", () => {
    const r = resolveGenerationPrompts({ generationSystemPrompt: "CUSTOM SYSTEM ONLY" });
    expect(r.systemPrompt).toBe("CUSTOM SYSTEM ONLY");
  });

  it("merges locale instructions: empty override values are ignored", () => {
    const r = resolveGenerationPrompts({
      generationLocaleInstructions: { "sv-SE": "", "en-US": "Custom EN" },
    });
    expect(r.localeInstructions["sv-SE"]).toContain("Återbetalningskrav");
    expect(r.localeInstructions["en-US"]).toBe("Custom EN");
  });

  it("appends userPromptSuffix from settings", () => {
    const r = resolveGenerationPrompts({ generationUserPromptSuffix: "Never repeat openings." });
    expect(r.userPromptSuffix).toBe("Never repeat openings.");
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

  it("includes additional instructions when suffix is set", () => {
    const resolved = resolveGenerationPrompts({
      generationUserPromptSuffix: "Vary headline structure.",
    });
    const p = buildUserPrompt(brief, "en-US", resolved);
    expect(p).toContain("Vary headline structure.");
    expect(p).toContain("TARGET KEYWORD: kw");
  });
});
