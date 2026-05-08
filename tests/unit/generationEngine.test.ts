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

/** Builds a body long enough to clear V1 (Tier B floor 1500) and operationally Shopify-specific. */
function richBody(): string {
  const opening =
    "Shopify Payments forwards a chargeback into the Disputes section in Shopify Admin within 24 hours of the issuer filing it.";
  const filler = "operational details about evidence packs and dispute timing ".repeat(180);
  return `<h2>Section</h2><p>${opening}</p><h2>More</h2><p>${filler}</p>`;
}

describe("generateAllLocales — validator retry loop", () => {
  const origKey = process.env.OPENAI_API_KEY;
  const origEnabled = process.env.GENERATION_ENABLED;
  const origEmb = process.env.GENERATION_EMBEDDINGS_ENABLED;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GENERATION_ENABLED = "true";
    // Embeddings off by default in tests so we don't need to stub embedding fetches.
    process.env.GENERATION_EMBEDDINGS_ENABLED = "false";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env.OPENAI_API_KEY = origKey;
    process.env.GENERATION_ENABLED = origEnabled;
    process.env.GENERATION_EMBEDDINGS_ENABLED = origEmb;
  });

  it("regenerates when first output uses a hype-formula title, then accepts a clean retry", async () => {
    const hype = {
      title: "Mastering Chargebacks Disputes",
      excerpt: "Operational summary.",
      slug: "first-slug",
      meta_title: "SEO",
      meta_description: "Desc",
      body_json: {
        mainHtml: richBody(),
        keyTakeaways: [],
        faq: [],
        disclaimer: "d",
      },
    };
    const clean = {
      ...hype,
      title: "AVS response codes inside Shopify Payments",
      slug: "avs-response-codes",
    };

    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(hype, 50) as never)
      .mockResolvedValueOnce(jsonResponse(clean, 60) as never);

    const resolved = resolveGenerationPrompts({ generationSystemPrompt: "SYS", generationUserPromptSuffix: "" });
    const results = await generateAllLocales(brief, resolved, {
      contextByLocale: { "en-US": { similarArticles: [] } },
      isSlugTaken: async () => false,
      embeddingClient: null,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results[0].content?.title).toBe(clean.title);
    expect(results[0].tokensUsed).toBe(110);
    expect(results[0].error).toBeNull();
  });

  it("regenerates when first output is a Jaccard-near-duplicate of an existing article, then succeeds", async () => {
    const tooClose = {
      title: "How merchants can prevent chargebacks effectively",
      excerpt: "Practical steps to reduce disputes before they escalate.",
      slug: "safe-slug-1",
      meta_title: "SEO",
      meta_description: "Desc",
      body_json: {
        mainHtml: richBody(),
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
      embeddingClient: null,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results[0].content?.title).toBe(distinct.title);
  });

  it("rejects when output remains too similar after MAX retries (3 total attempts)", async () => {
    const dup = {
      title: "How merchants can prevent chargebacks effectively",
      excerpt: "Practical steps to reduce disputes before they escalate.",
      slug: "uniq-slug-a",
      meta_title: "SEO",
      meta_description: "Desc",
      body_json: {
        mainHtml: richBody(),
        keyTakeaways: [],
        faq: [],
        disclaimer: "d",
      },
    };

    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(dup, 40) as never)
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
      embeddingClient: null,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(results[0].content).toBeNull();
    expect(results[0].error).toMatch(/rejected after 2 retries/i);
  });

  it("attaches soft validator warnings on accepted result", async () => {
    // Article passes hard validators but is short for Tier B (soft V1) and missing Shopify in opening (soft V4).
    const shortOk = {
      title: "Refund routing decisions for high-AOV merchants",
      excerpt: "An angle on routing.",
      slug: "refund-routing",
      meta_title: "SEO",
      meta_description: "Desc",
      body_json: {
        mainHtml: "<h2>One</h2><p>" + "details ".repeat(120) + "</p>",
        keyTakeaways: [],
        faq: [],
        disclaimer: "d",
      },
    };

    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(shortOk, 70) as never)
      .mockResolvedValueOnce(jsonResponse(shortOk, 70) as never)
      .mockResolvedValueOnce(jsonResponse(shortOk, 70) as never);

    const resolved = resolveGenerationPrompts({ generationSystemPrompt: "SYS", generationUserPromptSuffix: "" });
    const results = await generateAllLocales(brief, resolved, {
      contextByLocale: { "en-US": { similarArticles: [] } },
      isSlugTaken: async () => false,
      embeddingClient: null,
    });

    // Tier B + ~120 words → V1 soft, V4 soft. Both soft; result accepted with warnings.
    expect(results[0].content).not.toBeNull();
    expect(results[0].validatorWarnings ?? []).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "V1_tier_minimum_words", severity: "soft" })])
    );
  });
});
