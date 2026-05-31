import { describe, it, expect } from "vitest";
import {
  cosineSimilarity,
  formatValidatorRetryFeedback,
  hardFailures,
  htmlToText,
  runAllValidators,
  softFailures,
  v1_tierMinimumWords,
  v2_hypeTitle,
  v3_genericOpening,
  v4_shopifySpecificity,
  v5_archetypeMustHaves,
  v6_noInternalLinks,
  v7_embeddingSimilarity,
  v8_slugLocale,
  v9_uniformPacing,
  wordCount,
  type EmbeddingClient,
  type ValidatorBriefContext,
  type ValidatorCandidate,
} from "@/lib/resources/generation/validators";
import type { SimilarContentReference } from "@/lib/resources/generation/prompts";

function makeCandidate(over: Partial<ValidatorCandidate> = {}): ValidatorCandidate {
  return {
    title: "Default operational title for Shopify merchants",
    excerpt: "A specific operational summary.",
    slug: "default-operational-title",
    body_json: {
      mainHtml:
        "<h2>Section 1</h2><p>Shopify Payments forwards a chargeback into the Disputes section in Shopify Admin within 24 hours.</p>" +
        "<h2>Section 2</h2><p>Body content with operational specifics.</p>",
      keyTakeaways: ["A", "B"],
      faq: [],
      disclaimer: "info",
    },
    ...over,
  };
}

function makeBrief(over: Partial<ValidatorBriefContext> = {}): ValidatorBriefContext {
  return {
    contentType: "cluster_article",
    primaryPillar: "chargebacks",
    targetKeyword: "shopify chargeback",
    proposedTitle: "Shopify chargeback evidence basics",
    tier: null,
    archetype: null,
    isHubArticle: null,
    ...over,
  };
}

/* ── helpers ─────────────────────────────────────────────────────── */

describe("htmlToText + wordCount", () => {
  it("strips HTML and collapses whitespace", () => {
    expect(htmlToText("<h2>Heading</h2><p>One two<br/>three</p>")).toBe("Heading One two three");
  });
  it("counts words correctly", () => {
    expect(wordCount("one two three four")).toBe(4);
    expect(wordCount("")).toBe(0);
  });
});

/* ── V1 word count ──────────────────────────────────────────────── */

describe("V1 — tier minimum word count", () => {
  // Hard floor is tier-relative: max(300, floor(tierMin * 0.6)).
  // → Tier A (3000) hard <1800 · Tier B (1500) hard <900 · Tier C (800) hard <480.
  const bodyOf = (n: number) => ({
    mainHtml: "<p>" + "word ".repeat(n) + "</p>",
    keyTakeaways: [] as string[],
    faq: [],
    disclaimer: "",
  });

  it("Tier A well below floor fails HARD (800w < 1800 hard threshold)", () => {
    const f = v1_tierMinimumWords(makeCandidate({ body_json: bodyOf(800) }), makeBrief({ contentType: "pillar_page" }));
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("hard");
    expect(f!.message).toMatch(/tier A minimum/i);
  });

  it("Tier A just below floor fails SOFT (2000w ≥ 1800 hard threshold, < 3000 floor)", () => {
    const f = v1_tierMinimumWords(makeCandidate({ body_json: bodyOf(2000) }), makeBrief({ contentType: "pillar_page" }));
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("soft");
  });

  it("Tier B well below floor fails HARD (500w < 900 hard threshold)", () => {
    const f = v1_tierMinimumWords(makeCandidate({ body_json: bodyOf(500) }), makeBrief({ contentType: "cluster_article" }));
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("hard");
  });

  it("Tier B just below floor fails SOFT (1000w ≥ 900 hard threshold, < 1500 floor)", () => {
    const f = v1_tierMinimumWords(makeCandidate({ body_json: bodyOf(1000) }), makeBrief({ contentType: "cluster_article" }));
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("soft");
  });

  it("Tier C below 480 fails HARD; 480–799 fails SOFT", () => {
    const hard = v1_tierMinimumWords(makeCandidate({ body_json: bodyOf(400) }), makeBrief({ contentType: "template" }));
    expect(hard!.severity).toBe("hard");
    const soft = v1_tierMinimumWords(makeCandidate({ body_json: bodyOf(600) }), makeBrief({ contentType: "template" }));
    expect(soft!.severity).toBe("soft");
  });

  it("Tier A long article passes", () => {
    const f = v1_tierMinimumWords(makeCandidate({ body_json: bodyOf(3500) }), makeBrief({ contentType: "pillar_page" }));
    expect(f).toBeNull();
  });

  it("explicit tier override beats content_type inference", () => {
    // tier=C floor 800 → 1100w passes
    const f = v1_tierMinimumWords(makeCandidate({ body_json: bodyOf(1100) }), makeBrief({ contentType: "cluster_article", tier: "C" }));
    expect(f).toBeNull();
  });
});

/* ── V2 hype titles ─────────────────────────────────────────────── */

describe("V2 — hype-formula titles", () => {
  it("flags 'Mastering …'", () => {
    const f = v2_hypeTitle(makeCandidate({ title: "Mastering Chargebacks Disputes" }));
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("hard");
  });
  it("flags 'Navigating …'", () => {
    expect(v2_hypeTitle(makeCandidate({ title: "Navigating Refunds" }))).not.toBeNull();
  });
  it("flags 'Effective Strategies for …'", () => {
    expect(v2_hypeTitle(makeCandidate({ title: "Effective Strategies for Handling Disputes" }))).not.toBeNull();
  });
  it("flags 'Tactical Approaches' embedded", () => {
    expect(v2_hypeTitle(makeCandidate({ title: "Beyond Basics: Tactical Approaches to Fraud" }))).not.toBeNull();
  });
  it("does NOT flag specific operational titles", () => {
    expect(v2_hypeTitle(makeCandidate({ title: "AVS response codes for Shopify Payments" }))).toBeNull();
    expect(v2_hypeTitle(makeCandidate({ title: "How to assemble a chargeback evidence pack" }))).toBeNull();
  });
});

/* ── V3 generic openings ────────────────────────────────────────── */

describe("V3 — generic AI openings", () => {
  it("flags 'In today's digital landscape…'", () => {
    const c = makeCandidate({
      body_json: {
        mainHtml: "<p>In today's digital landscape, chargebacks happen.</p>",
        keyTakeaways: [],
        faq: [],
        disclaimer: "",
      },
    });
    expect(v3_genericOpening(c)).not.toBeNull();
  });
  it("flags 'Chargebacks are a growing problem…'", () => {
    const c = makeCandidate({
      body_json: {
        mainHtml: "<p>Chargebacks are a growing problem for merchants.</p>",
        keyTakeaways: [],
        faq: [],
        disclaimer: "",
      },
    });
    expect(v3_genericOpening(c)).not.toBeNull();
  });
  it("does not flag operational openings", () => {
    const c = makeCandidate({
      body_json: {
        mainHtml: "<p>Shopify forwards a chargeback to your Disputes section in Admin within 24 hours.</p>",
        keyTakeaways: [],
        faq: [],
        disclaimer: "",
      },
    });
    expect(v3_genericOpening(c)).toBeNull();
  });

  it("soft-flags when body contains 3+ AI-corporate phrases anywhere", () => {
    const c = makeCandidate({
      body_json: {
        mainHtml:
          "<p>Shopify Payments forwards disputes to Admin.</p>" +
          "<p>It's important to note that various factors influence outcomes.</p>" +
          "<p>This robust workflow helps streamline operations and enhances efficiency.</p>",
        keyTakeaways: [],
        faq: [],
        disclaimer: "",
      },
    });
    const f = v3_genericOpening(c);
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("soft");
    expect(f!.message).toMatch(/AI-corporate/i);
  });

  it("does NOT soft-flag when fewer than 3 blocklist hits", () => {
    const c = makeCandidate({
      body_json: {
        mainHtml:
          "<p>Shopify Payments forwards disputes to Admin within 24 hours.</p>" +
          "<p>The robust evidence pack matters here.</p>",
        keyTakeaways: [],
        faq: [],
        disclaimer: "",
      },
    });
    expect(v3_genericOpening(c)).toBeNull();
  });

  it("HARD-fails on schema-leaked section headings (Failure Modes / Evidence Hierarchy / etc.)", () => {
    const cases = [
      "Failure Modes",
      "Critical Failure Modes",
      "Evidence Hierarchy",
      "Evidence Hierarchy: What Matters More",
      "Messy Examples",
      "Messy Examples: Real-World Scenarios",
      "Real-World Scenarios",
      "DisputeDesk's Role",
      "Operational Transparency with DisputeDesk",
      "Workflow Insights",
      "Processor and Network Caveats",
      "Processor Caveats",
      "Network Caveats",
      "Gateway Variance",
      "Processor Variance",
      "Cross-System Variance",
      "Variance Constraints",
      "Variation Between Processors",
      "Variation Between Gateways",
      "Common Operational Mistakes",
      "How Evidence Strength Actually Works",
    ];
    for (const heading of cases) {
      const c = makeCandidate({
        body_json: {
          mainHtml:
            "<p>Shopify Payments forwards disputes within 24 hours.</p>" +
            `<h2>${heading}</h2><p>...</p>`,
          keyTakeaways: [],
          faq: [],
          disclaimer: "",
        },
      });
      const f = v3_genericOpening(c);
      expect(f, `expected schema-leaked heading "${heading}" to hard-fail`).not.toBeNull();
      expect(f!.severity).toBe("hard");
      expect(f!.message).toMatch(/JSON schema category/);
    }
  });

  it("does NOT flag topic-led / problem-led section headings", () => {
    const goodHeadings = [
      "Why AVS Y Still Loses Fraud Disputes",
      "The Hidden Risk of 'Delivered' Without Signature",
      "What Actually Happens After Clicking Submit Response in Shopify",
      "Why Merchants Misread Shopify Protect Coverage",
      "When the Issuer Cares More About Delivery Than Authorization",
      "The 10-Day Clock and Where It Quietly Slips",
    ];
    for (const heading of goodHeadings) {
      const c = makeCandidate({
        body_json: {
          mainHtml:
            "<p>Shopify Payments forwards disputes within 24 hours.</p>" +
            `<h2>${heading}</h2><p>...</p>`,
          keyTakeaways: [],
          faq: [],
          disclaimer: "",
        },
      });
      expect(v3_genericOpening(c), `expected topic-led heading "${heading}" to PASS`).toBeNull();
    }
  });
});

/* ── V4 Shopify specificity ─────────────────────────────────────── */

describe("V4 — Shopify specificity in first 200 words", () => {
  it("passes when Shopify is mentioned early", () => {
    expect(v4_shopifySpecificity(makeCandidate(), makeBrief())).toBeNull();
  });

  it("flags when first 200 words don't mention Shopify", () => {
    const c = makeCandidate({
      body_json: {
        mainHtml: "<p>This article covers chargebacks generally for ecommerce sellers.</p>",
        keyTakeaways: [],
        faq: [],
        disclaimer: "",
      },
    });
    expect(v4_shopifySpecificity(c, makeBrief({ primaryPillar: "chargebacks" }))).not.toBeNull();
  });

  it("does not enforce on non-relevant pillars", () => {
    const c = makeCandidate({
      body_json: {
        mainHtml: "<p>General writing about generic topics.</p>",
        keyTakeaways: [],
        faq: [],
        disclaimer: "",
      },
    });
    expect(v4_shopifySpecificity(c, makeBrief({ primaryPillar: "marketing" }))).toBeNull();
  });
});

/* ── V5 archetype must-haves ────────────────────────────────────── */

describe("V5 — archetype must-haves", () => {
  it("authority_pillar fails when fewer than 4 H2/H3 sections", () => {
    const c = makeCandidate({
      body_json: {
        mainHtml: "<h2>One</h2><p>x</p><h2>Two</h2><p>y</p>",
        keyTakeaways: [],
        faq: [],
        disclaimer: "",
      },
    });
    const f = v5_archetypeMustHaves(c, makeBrief({ archetype: "authority_pillar", contentType: "pillar_page" }));
    expect(f).not.toBeNull();
    expect(f!.message).toMatch(/4 H2\/H3 sections/);
  });

  it("evidence_deep_dive fails when no evidence field is named", () => {
    const c = makeCandidate({
      body_json: {
        mainHtml: "<p>Generic discussion of evidence quality with no specifics.</p>",
        keyTakeaways: [],
        faq: [],
        disclaimer: "",
      },
    });
    const f = v5_archetypeMustHaves(c, makeBrief({ archetype: "evidence_deep_dive" }));
    expect(f).not.toBeNull();
  });

  it("evidence_deep_dive passes when AVS / tracking / 3DS is named", () => {
    const c = makeCandidate({
      body_json: {
        mainHtml: "<p>The AVS Y match plus tracking number from FedEx is decisive.</p>",
        keyTakeaways: [],
        faq: [],
        disclaimer: "",
      },
    });
    expect(v5_archetypeMustHaves(c, makeBrief({ archetype: "evidence_deep_dive" }))).toBeNull();
  });

  it("template_fillin fails when no [BRACKETED] placeholders", () => {
    const c = makeCandidate({
      body_json: {
        mainHtml: "<p>Use this template for your customer email response.</p>",
        keyTakeaways: [],
        faq: [],
        disclaimer: "",
      },
    });
    const f = v5_archetypeMustHaves(c, makeBrief({ archetype: "template_fillin", contentType: "template" }));
    expect(f).not.toBeNull();
  });

  it("template_fillin passes when bracketed placeholders are present", () => {
    const c = makeCandidate({
      body_json: {
        mainHtml: "<p>Hello [CUSTOMER FIRST NAME], regarding [ORDER NUMBER]…</p>",
        keyTakeaways: [],
        faq: [],
        disclaimer: "",
      },
    });
    expect(v5_archetypeMustHaves(c, makeBrief({ archetype: "template_fillin", contentType: "template" }))).toBeNull();
  });

  it("faq_qna fails when fewer than 5 FAQ entries", () => {
    const c = makeCandidate({
      body_json: {
        mainHtml: "<p>x</p>",
        keyTakeaways: [],
        faq: [{ q: "?", a: "." }],
        disclaimer: "",
      },
    });
    const f = v5_archetypeMustHaves(c, makeBrief({ archetype: "faq_qna", contentType: "faq_entry" }));
    expect(f).not.toBeNull();
    expect(f!.message).toMatch(/1 pairs/);
  });

  it("faq_qna passes with 5 entries", () => {
    const c = makeCandidate({
      body_json: {
        mainHtml: "<p>x</p>",
        keyTakeaways: [],
        faq: Array.from({ length: 5 }, (_, i) => ({ q: `q${i}`, a: `a${i}` })),
        disclaimer: "",
      },
    });
    expect(v5_archetypeMustHaves(c, makeBrief({ archetype: "faq_qna", contentType: "faq_entry" }))).toBeNull();
  });

  it("merchant_playbook is intentionally not statically validated", () => {
    const c = makeCandidate({
      body_json: { mainHtml: "<p>thin</p>", keyTakeaways: [], faq: [], disclaimer: "" },
    });
    expect(v5_archetypeMustHaves(c, makeBrief({ archetype: "merchant_playbook" }))).toBeNull();
  });
});

/* ── V6 internal links ──────────────────────────────────────────── */

describe("V6 — no internal <a> links", () => {
  it("flags relative anchor links", () => {
    const c = makeCandidate({
      body_json: {
        mainHtml: "<p>See <a href=\"/resources/foo\">our other guide</a> for details.</p>",
        keyTakeaways: [],
        faq: [],
        disclaimer: "",
      },
    });
    const f = v6_noInternalLinks(c);
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("hard");
  });

  it("flags absolute disputedesk.app links", () => {
    const c = makeCandidate({
      body_json: {
        mainHtml: "<p>See <a href=\"https://disputedesk.app/resources/foo\">x</a></p>",
        keyTakeaways: [],
        faq: [],
        disclaimer: "",
      },
    });
    expect(v6_noInternalLinks(c)).not.toBeNull();
  });

  it("does not flag mailto or external links", () => {
    const c = makeCandidate({
      body_json: {
        mainHtml:
          "<p>Email <a href=\"mailto:x@y.com\">x@y.com</a> and read <a href=\"https://shopify.com/help\">Shopify Help</a>.</p>",
        keyTakeaways: [],
        faq: [],
        disclaimer: "",
      },
    });
    expect(v6_noInternalLinks(c)).toBeNull();
  });
});

/* ── V7 embeddings ──────────────────────────────────────────────── */

describe("V7 — embedding semantic similarity", () => {
  function fakeClient(map: Record<string, number[]>): EmbeddingClient {
    return {
      embed: async (text: string) => {
        // Use exact match by title prefix for determinism.
        for (const [k, v] of Object.entries(map)) {
          if (text.startsWith(k)) return v;
        }
        return [0.1, 0.1, 0.1];
      },
    };
  }

  it("flags when cosine ≥ threshold", async () => {
    const cand = makeCandidate({ title: "How merchants prevent chargebacks" });
    const peer: SimilarContentReference = {
      id: "p",
      locale: "en-US",
      title: "How merchants prevent chargebacks effectively",
      slug: "prevent-chargebacks",
      excerpt: null,
    };
    const client = fakeClient({
      "How merchants prevent chargebacks ": [1, 0, 0],
      "How merchants prevent chargebacks effectively": [1, 0, 0],
    });
    const f = await v7_embeddingSimilarity(cand, [peer], client, 0.85);
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("hard");
  });

  it("passes when cosine below threshold", async () => {
    const cand = makeCandidate({ title: "AVS response codes for Shopify Payments" });
    const peer: SimilarContentReference = {
      id: "p",
      locale: "en-US",
      title: "Refund policy template for cosmetics merchants",
      slug: "refund-policy",
      excerpt: null,
    };
    const client = fakeClient({
      "AVS response codes for Shopify Payments": [1, 0, 0],
      "Refund policy template for cosmetics merchants": [0, 1, 0],
    });
    const f = await v7_embeddingSimilarity(cand, [peer], client, 0.85);
    expect(f).toBeNull();
  });

  it("returns null when client is absent (graceful degrade)", async () => {
    const cand = makeCandidate();
    const peer: SimilarContentReference = {
      id: "p",
      locale: "en-US",
      title: "x",
      slug: "x",
      excerpt: null,
    };
    expect(await v7_embeddingSimilarity(cand, [peer], null)).toBeNull();
  });

  it("cosineSimilarity sanity", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
    expect(cosineSimilarity([1, 1, 1], [1, 1, 1, 1])).toBe(0); // length mismatch guard
  });
});

/* ── V8 slug locale ─────────────────────────────────────────────── */

describe("V8 — slug locale enforcement", () => {
  it("passes for en-US regardless of slug language", () => {
    const c = makeCandidate({ slug: "chargeback-evidence-shopify" });
    expect(v8_slugLocale(c, makeBrief(), "en-US")).toBeNull();
  });

  it("flags non-en-US slug containing English keyword tokens", () => {
    const c = makeCandidate({ slug: "chargeback-evidence-shopify" });
    const f = v8_slugLocale(
      c,
      makeBrief({ proposedTitle: "Chargeback evidence Shopify guide", targetKeyword: "chargeback evidence" }),
      "pt-BR"
    );
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("hard");
  });

  it("passes for non-en-US slug with native words", () => {
    const c = makeCandidate({ slug: "estorno-evidencias-loja" });
    const f = v8_slugLocale(
      c,
      makeBrief({ proposedTitle: "Chargeback evidence Shopify guide", targetKeyword: "chargeback evidence" }),
      "pt-BR"
    );
    expect(f).toBeNull();
  });
});

/* ── V9 — uniform pacing detector ────────────────────────────── */

describe("V9 — uniform pacing", () => {
  function buildBody(sectionWordCounts: number[]): string {
    return sectionWordCounts
      .map((wc, i) => `<h2>Section ${i + 1}</h2><p>${"word ".repeat(wc).trim()}</p>`)
      .join("");
  }

  it("soft-flags when 4+ sections all hover near the same length (CV < 0.35)", () => {
    const c = makeCandidate({
      body_json: {
        mainHtml: buildBody([55, 60, 50, 58]),
        keyTakeaways: [],
        faq: [],
        disclaimer: "",
      },
    });
    const f = v9_uniformPacing(c);
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("soft");
    expect(f!.message).toMatch(/uniform/i);
  });

  it("does NOT flag when section lengths vary widely", () => {
    const c = makeCandidate({
      body_json: {
        mainHtml: buildBody([20, 200, 60, 350]),
        keyTakeaways: [],
        faq: [],
        disclaimer: "",
      },
    });
    expect(v9_uniformPacing(c)).toBeNull();
  });

  it("does NOT flag when fewer than 4 sections", () => {
    const c = makeCandidate({
      body_json: {
        mainHtml: buildBody([50, 50, 50]),
        keyTakeaways: [],
        faq: [],
        disclaimer: "",
      },
    });
    expect(v9_uniformPacing(c)).toBeNull();
  });

  it("does NOT flag empty / very-short articles", () => {
    const c = makeCandidate({
      body_json: { mainHtml: "<p>x</p>", keyTakeaways: [], faq: [], disclaimer: "" },
    });
    expect(v9_uniformPacing(c)).toBeNull();
  });
});

/* ── runAllValidators + retry feedback ──────────────────────────── */

describe("runAllValidators + retry feedback", () => {
  it("aggregates all violations and ok=false when any fail", async () => {
    const c = makeCandidate({
      title: "Mastering Chargebacks Disputes",
      body_json: {
        mainHtml:
          "<p>In today's digital landscape, chargebacks are a growing problem.</p><p>" +
          "word ".repeat(50) +
          "</p>",
        keyTakeaways: [],
        faq: [],
        disclaimer: "",
      },
    });
    const r = await runAllValidators(
      { candidate: c, brief: makeBrief({ contentType: "pillar_page" }), peers: [], locale: "en-US" },
      { embeddingClient: null }
    );
    expect(r.ok).toBe(false);
    const ids = r.failures.map((f) => f.id);
    expect(ids).toContain("V1_tier_minimum_words");
    expect(ids).toContain("V2_hype_title");
    expect(ids).toContain("V3_generic_opening");
  });

  it("ok=true with no failures when candidate is healthy and no peers", async () => {
    const c = makeCandidate({
      body_json: {
        mainHtml:
          "<h2>Section One</h2><p>Shopify Admin path here. " +
          "operational specifics about chargebacks and evidence ".repeat(900) +
          "</p>",
        keyTakeaways: [],
        faq: [],
        disclaimer: "",
      },
    });
    const r = await runAllValidators(
      { candidate: c, brief: makeBrief({ contentType: "cluster_article" }), peers: [], locale: "en-US" },
      { embeddingClient: null }
    );
    expect(r.ok).toBe(true);
  });

  it("formatValidatorRetryFeedback enumerates each failure with its retry hint", () => {
    const out = formatValidatorRetryFeedback([
      {
        id: "V2_hype_title",
        severity: "hard",
        message: "msg",
        retryHint: "retry-hint-text",
      },
    ]);
    expect(out).toMatch(/V2_hype_title/);
    expect(out).toMatch(/retry-hint-text/);
    expect(out).toMatch(/Address every issue below/);
  });

  it("hardFailures and softFailures partition correctly", () => {
    const failures = [
      { id: "V2_hype_title", severity: "hard", message: "x", retryHint: "y" },
      { id: "V4_shopify_specificity", severity: "soft", message: "x", retryHint: "y" },
    ] as const;
    expect(hardFailures([...failures]).length).toBe(1);
    expect(softFailures([...failures]).length).toBe(1);
  });
});
