import { describe, it, expect } from "vitest";
import { buildUserPrompt, resolveGenerationPrompts } from "@/lib/resources/generation/prompts";

describe("buildUserPrompt", () => {
  const brief = {
    archiveItemId: "a1",
    proposedTitle: "Test topic",
    contentType: "cluster_article",
    pageRole: "case_study",
    searchIntent: "informational",
    complexity: "medium",
    targetWordRange: null as string | null,
    primaryPillar: "dispute-management-software",
    targetKeyword: "test",
    summary: null,
    notes: null,
    targetLocales: ["en-US", "pt-BR"],
  };

  const resolved = resolveGenerationPrompts({});

  it("includes native-language slug requirement for pt-BR", () => {
    const prompt = buildUserPrompt(
      { ...brief, targetWordRange: null },
      "pt-BR",
      resolved,
      { similarArticles: [] }
    );
    expect(prompt).toContain("SLUG (required");
    expect(prompt).toContain("not English");
    expect(prompt).toContain("dispute-handling-time-case-study");
  });

  it("does not include separate slug requirement block for en-US", () => {
    const prompt = buildUserPrompt({ ...brief, targetWordRange: null }, "en-US", resolved, {
      similarArticles: [],
    });
    expect(prompt).not.toContain("SLUG (required for LOCALE");
  });

  it("appends non-English length supplement for de-DE", () => {
    const prompt = buildUserPrompt({ ...brief, targetWordRange: null }, "de-DE", resolved, {
      similarArticles: [],
    });
    expect(prompt).toContain("Non-English locale");
  });
});
