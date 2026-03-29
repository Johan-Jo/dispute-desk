import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateAllLocales } from "@/lib/resources/generation/generate";
import { resolveGenerationPrompts } from "@/lib/resources/generation/prompts";
import type { GenerationBrief } from "@/lib/resources/generation/prompts";

const brief: GenerationBrief = {
  archiveItemId: "a1",
  proposedTitle: "Evidence pack timing",
  contentType: "cluster_article",
  primaryPillar: "chargebacks",
  targetKeyword: "evidence",
  searchIntent: "informational",
  summary: null,
  notes: null,
  targetLocales: ["en-US"],
  pageRole: null,
  complexity: null,
  targetWordRange: null,
};

function jsonResponse(obj: unknown, tokens = 100) {
  return {
    ok: true,
    json: async () => ({
      usage: { total_tokens: tokens },
      choices: [{ message: { content: JSON.stringify(obj) } }],
    }),
  };
}

describe("generateAllLocales similarity retry", () => {
  const origKey = process.env.OPENAI_API_KEY;
  const origEnabled = process.env.GENERATION_ENABLED;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GENERATION_ENABLED = "true";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env.OPENAI_API_KEY = origKey;
    process.env.GENERATION_ENABLED = origEnabled;
  });

  it("calls OpenAI twice when first output is too similar to corpus, then succeeds", async () => {
    const tooClose = {
      title: "How merchants can prevent chargebacks effectively",
      excerpt: "Practical steps to reduce disputes before they escalate.",
      slug: "safe-slug-1",
      meta_title: "SEO",
      meta_description: "Desc",
      body_json: {
        mainHtml: "<p>x</p>",
        keyTakeaways: [],
        faq: [],
        disclaimer: "d",
      },
    };
    const distinct = {
      ...tooClose,
      title: "Representment deadlines and evidence ordering for Shopify merchants",
      excerpt: "A separate angle on assembling proof under network timelines.",
      slug: "safe-slug-2",
    };

    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(tooClose, 50) as never)
      .mockResolvedValueOnce(jsonResponse(distinct, 60) as never);

    const similar = [
      {
        id: "s1",
        locale: "en-US",
        title: "How merchants can prevent chargebacks effectively",
        slug: "prevent-chargebacks",
        excerpt: "Practical steps to reduce disputes before they escalate.",
        primaryKeyword: "chargeback",
        contentType: "cluster_article",
      },
    ];

    const resolved = resolveGenerationPrompts({ generationSystemPrompt: "SYS", generationUserPromptSuffix: "" });
    const results = await generateAllLocales(brief, resolved, {
      contextByLocale: { "en-US": { similarArticles: similar } },
      isSlugTaken: async () => false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results[0].content?.title).toBe(distinct.title);
    expect(results[0].tokensUsed).toBe(110);
  });

  it("returns clear error when second attempt is still too similar", async () => {
    const dup = {
      title: "How merchants can prevent chargebacks effectively",
      excerpt: "Practical steps to reduce disputes before they escalate.",
      slug: "uniq-slug-a",
      meta_title: "SEO",
      meta_description: "Desc",
      body_json: {
        mainHtml: "<p>x</p>",
        keyTakeaways: [],
        faq: [],
        disclaimer: "d",
      },
    };

    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(dup, 40) as never)
      .mockResolvedValueOnce(jsonResponse(dup, 40) as never);

    const similar = [
      {
        id: "s1",
        locale: "en-US",
        title: "How merchants can prevent chargebacks effectively",
        slug: "prevent-chargebacks",
        excerpt: "Practical steps to reduce disputes before they escalate.",
        primaryKeyword: "chargeback",
        contentType: "cluster_article",
      },
    ];

    const resolved = resolveGenerationPrompts({ generationSystemPrompt: "SYS", generationUserPromptSuffix: "" });
    const results = await generateAllLocales(brief, resolved, {
      contextByLocale: { "en-US": { similarArticles: similar } },
      isSlugTaken: async () => false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results[0].content).toBeNull();
    expect(results[0].error).toMatch(/similarity retry/i);
  });
});
