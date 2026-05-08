/**
 * Post-generation validators (V1–V8).
 *
 * Replaces the old "Jaccard-only" similarity guard with a tier+archetype-aware
 * editorial bar. Validators are pure functions over the generated candidate;
 * V7 (embeddings) optionally calls OpenAI but degrades to a no-op when the
 * key is missing or the API errors.
 *
 * The retry loop in `generate.ts` runs validators after each attempt, builds
 * a feedback instruction listing every violation + its retry hint, and
 * regenerates. Max 2 retries (3 total attempts).
 */

import type { SimilarContentReference } from "./prompts";
import { extractIntroSnippet } from "./htmlSnippet";
import {
  ARCHETYPE_REQUIREMENTS,
  resolveArchetype,
  resolveTier,
  tierMinimumWords,
  type ContentArchetype,
  type ContentTier,
} from "./tiers";

export type ValidatorId =
  | "V1_tier_minimum_words"
  | "V2_hype_title"
  | "V3_generic_opening"
  | "V4_shopify_specificity"
  | "V5_archetype_must_haves"
  | "V6_no_internal_links"
  | "V7_embedding_similarity"
  | "V8_slug_locale";

export type ValidatorSeverity = "hard" | "soft";

export interface ValidatorFailure {
  id: ValidatorId;
  severity: ValidatorSeverity;
  message: string;
  /** Concrete instruction for the model on how to fix the violation in the next retry. */
  retryHint: string;
}

export interface ValidatorResult {
  ok: boolean;
  failures: ValidatorFailure[];
}

export interface ValidatorCandidate {
  title: string;
  excerpt: string;
  slug: string;
  meta_title?: string;
  meta_description?: string;
  body_json: {
    mainHtml: string;
    keyTakeaways?: string[];
    faq?: Array<{ q: string; a: string }>;
    disclaimer?: string;
  };
}

export interface ValidatorBriefContext {
  contentType: string;
  primaryPillar: string;
  targetKeyword: string | null;
  proposedTitle: string;
  tier?: string | null;
  archetype?: string | null;
  isHubArticle?: boolean | null;
}

/* ── Shared helpers ────────────────────────────────────────────────── */

const HYPE_TITLE_PATTERNS: RegExp[] = [
  /^mastering\b/i,
  /^navigating\b/i,
  /^understanding\b/i,
  /^complete guide to\b/i,
  /^the ultimate guide\b/i,
  /^effective strategies for\b/i,
  /^a comprehensive guide\b/i,
  /\btactical approaches\b/i,
  /\bdefinitive guide\b/i,
];

const GENERIC_OPENING_PATTERNS: RegExp[] = [
  /in today'?s (digital|fast-paced|ecommerce)/i,
  /chargebacks are a (growing|major|significant) (problem|issue|challenge)/i,
  /managing (disputes|chargebacks) can be (challenging|complex|difficult)/i,
  /navigating the complexities of/i,
  /in the (fast-paced|ever-changing) world of/i,
  /businesses of all sizes/i,
];

/**
 * Explicit AI-corporate phrasing the operator-voice brief forbids throughout
 * the body (not just the opening). Three or more hits triggers V3 regardless
 * of where they appear.
 */
const FORBIDDEN_AI_PHRASES: RegExp[] = [
  /\bit'?s important to note\b/i,
  /\bit is important to note\b/i,
  /\bcan significantly impact\b/i,
  /\bthroughout this process\b/i,
  /\bvarious factors\b/i,
  /\bcomprehensive overview\b/i,
  /\btypically includes\b/i,
  /\bbusinesses should\b/i,
  /\bit is crucial\b/i,
  /\bplays a vital role\b/i,
  /\bhelps streamline\b/i,
  /\benhances efficiency\b/i,
  /\bseamlessly\b/i,
  /\brobust\b/i,
  /\bleveraging\b/i,
  /\bin conclusion\b/i,
];

const SHOPIFY_SURFACE_PATTERNS: RegExp[] = [
  /\bshopify\b/i,
  /\bshopify\s+payments\b/i,
  /\bshopify\s+admin\b/i,
  /\bshopify\s+protect\b/i,
];

const SHOPIFY_RELEVANT_PILLARS = new Set([
  "chargebacks",
  "evidence",
  "dispute_resolution",
  "fraud",
  "payments",
  "operations",
]);

const EVIDENCE_DEEP_DIVE_TERMS: RegExp[] = [
  /\bAVS\b/,
  /\bCVV\b|\bCVC\b/,
  /\btracking\b/i,
  /\bIP\s+(geolocation|address)\b/i,
  /\b3-?D\s*Secure\b/i,
  /\b3DS\b/,
  /\bsigned\s+(delivery|contract)\b/i,
  /\bscreenshot\b/i,
  /\bdigital\s+receipt\b/i,
];

export function htmlToText(html: string | null | undefined): string {
  return (html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function firstNWords(text: string, n: number): string {
  return text.split(/\s+/).filter(Boolean).slice(0, n).join(" ");
}

function countH2H3(html: string): number {
  return (html.match(/<h[23]\b/gi) ?? []).length;
}

/* ── V1 — Tier minimum word count ─────────────────────────────────── */

export function v1_tierMinimumWords(
  candidate: ValidatorCandidate,
  brief: ValidatorBriefContext
): ValidatorFailure | null {
  const tier = resolveTier({
    tier: brief.tier ?? null,
    contentType: brief.contentType,
    isHubArticle: brief.isHubArticle ?? null,
  });
  const text = htmlToText(candidate.body_json.mainHtml);
  const wc = wordCount(text);
  const min = tierMinimumWords(tier);

  if (wc >= min) return null;

  // V1 is always SOFT for now — gpt-4o frequently produces 600-1000-word
  // articles even when the prompt explicitly asks for 3500+. We log the
  // miss as a warning and accept the article into editorial review rather
  // than rejecting after 2 expensive retries that don't help. Editorial
  // review (workflow_status='in-editorial-review' for Tier A per PR 5)
  // is where humans decide whether to publish, expand, or kick back.
  // Re-promote to hard once a reliable >2000w generation strategy is in
  // place (multi-pass / section-iterative generation, or a stronger model).
  const severity: ValidatorSeverity = "soft";

  return {
    id: "V1_tier_minimum_words",
    severity,
    message: `Article body is ${wc} words; tier ${tier} minimum is ${min}.`,
    retryHint: `The previous article was only ${wc} words. Tier ${tier} requires at least ${min} words of substantive depth — not padding. Add concrete coverage: name a specific Shopify Admin path with the page label, walk one merchant scenario end-to-end (reason / amount / decision / outcome), enumerate evidence quality bands (Strong / Moderate / Weak) with sample values, and include a "common mistakes that lose disputes" section. Do NOT pad with restated points.`,
  };
}

/* ── V2 — Hype-formula titles ─────────────────────────────────────── */

export function v2_hypeTitle(candidate: ValidatorCandidate): ValidatorFailure | null {
  const t = candidate.title.trim();
  for (const re of HYPE_TITLE_PATTERNS) {
    if (re.test(t)) {
      return {
        id: "V2_hype_title",
        severity: "hard",
        message: `Title "${t}" matches a forbidden hype-formula pattern (${re}).`,
        retryHint: `The title "${t}" uses a banned mass-produced opening. Pick a specific, operational title that names the actual scenario — e.g. instead of "Mastering Chargebacks Disputes" use "How Shopify merchants assemble fraud evidence in the 7-day response window". Avoid: Mastering, Navigating, Understanding, Complete Guide to, The Ultimate Guide, Effective Strategies for, A Comprehensive Guide to, Tactical Approaches, Definitive Guide.`,
      };
    }
  }
  return null;
}

/* ── V3 — Generic AI opening ──────────────────────────────────────── */

export function v3_genericOpening(candidate: ValidatorCandidate): ValidatorFailure | null {
  const intro = extractIntroSnippet(candidate.body_json.mainHtml, 400) ?? "";
  for (const re of GENERIC_OPENING_PATTERNS) {
    if (re.test(intro)) {
      return {
        id: "V3_generic_opening",
        severity: "hard",
        message: `Opening matches generic AI-style pattern (${re}).`,
        retryHint: `The first paragraph used a banned generic opening. Open instead with a specific operational fact: a Shopify Admin path the merchant can navigate to, the dispute response window in days, who decides the dispute (issuer vs network), or an exact field name. Forbidden openings include: "Chargebacks are a [growing/major/significant] problem", "In today's [digital/fast-paced/ecommerce] landscape", "Businesses of all sizes", "Navigating the complexities of", "Managing chargebacks can be challenging", "In the fast-paced world of".`,
      };
    }
  }

  // Whole-body scan: 3+ hits from the AI-phrase blocklist means the article
  // is leaning on corporate-AI language regardless of where the offending
  // phrases appear. Severity soft so the article can still ship if every
  // other validator passes — but the warnings get surfaced for editorial review.
  const fullText = htmlToText(candidate.body_json.mainHtml);
  const hits: string[] = [];
  for (const re of FORBIDDEN_AI_PHRASES) {
    if (re.test(fullText)) hits.push(re.source);
  }
  if (hits.length >= 3) {
    return {
      id: "V3_generic_opening",
      severity: "soft",
      message: `Body contains ${hits.length} forbidden AI-corporate phrases.`,
      retryHint: `The article uses ${hits.length} phrases from the AI-corporate blocklist (e.g. ${hits.slice(0, 3).join(", ")}). Rewrite those passages in operator voice — direct, opinionated, specific. The brief is operationally credible dispute intelligence, not corporate ecommerce blogging. Forbidden anywhere in the body: "It's important to note", "can significantly impact", "throughout this process", "various factors", "comprehensive overview", "typically includes", "businesses should", "it is crucial", "plays a vital role", "helps streamline", "enhances efficiency", "seamlessly", "robust", "leveraging", "in conclusion".`,
    };
  }

  return null;
}

/* ── V4 — Shopify specificity (in first 200 words) ────────────────── */

export function v4_shopifySpecificity(
  candidate: ValidatorCandidate,
  brief: ValidatorBriefContext
): ValidatorFailure | null {
  if (!SHOPIFY_RELEVANT_PILLARS.has(brief.primaryPillar)) return null;

  const text = htmlToText(candidate.body_json.mainHtml);
  const head = firstNWords(text, 200);
  const hasSurface = SHOPIFY_SURFACE_PATTERNS.some((re) => re.test(head));
  if (hasSurface) return null;

  return {
    id: "V4_shopify_specificity",
    severity: "soft",
    message: "First 200 words don't mention Shopify or a Shopify-specific surface.",
    retryHint: `The article's first 200 words don't mention Shopify, Shopify Payments, Shopify Admin, or Shopify Protect. The audience is Shopify merchants — the opening must place them in their own platform's context. Add a concrete Shopify reference (e.g. "Shopify forwards a chargeback to your Disputes section in Admin within 24 hours") in the first paragraph.`,
  };
}

/* ── V5 — Archetype must-haves ────────────────────────────────────── */

export function v5_archetypeMustHaves(
  candidate: ValidatorCandidate,
  brief: ValidatorBriefContext
): ValidatorFailure | null {
  const archetype = resolveArchetype({
    archetype: brief.archetype ?? null,
    contentType: brief.contentType,
    isHubArticle: brief.isHubArticle ?? null,
  });
  const html = candidate.body_json.mainHtml;
  const text = htmlToText(html);
  const headSection = firstNWords(text, 500);

  const failures: string[] = [];

  switch (archetype) {
    case "authority_pillar": {
      if (countH2H3(html) < 4) {
        failures.push("fewer than 4 H2/H3 sections (an authority pillar needs at least 4 substantive sections)");
      }
      if (!SHOPIFY_SURFACE_PATTERNS.some((re) => re.test(text.slice(0, 1500)))) {
        failures.push("no mention of Shopify in the first ~1500 chars");
      }
      break;
    }
    case "evidence_deep_dive": {
      const hasField = EVIDENCE_DEEP_DIVE_TERMS.some((re) => re.test(text));
      if (!hasField) {
        failures.push("no specific evidence field named (AVS, CVV, tracking, IP, 3DS, signed delivery/contract, screenshot)");
      }
      break;
    }
    case "regulatory_explainer": {
      if (!/\b(20\d{2}|19\d{2})\b/.test(text)) {
        failures.push("no effective date / year reference for the regulation");
      }
      break;
    }
    case "comparative_analysis": {
      const hasVs = /\bvs\b|\bversus\b|\bcompare/i.test(candidate.title) || /\bvs\b|\bversus\b/i.test(headSection);
      if (!hasVs) {
        failures.push("no 'vs' / 'versus' / comparison framing in title or opening");
      }
      break;
    }
    case "checklist_actionable": {
      const hasMistakes = /common\s+mistakes/i.test(text) || /things\s+to\s+avoid/i.test(text);
      if (!hasMistakes) {
        failures.push("no 'common mistakes' or 'things to avoid' section");
      }
      break;
    }
    case "template_fillin": {
      if (!/\[[A-Z][A-Z0-9_ ]{2,}\]/.test(html)) {
        failures.push("no [BRACKETED] placeholders");
      }
      break;
    }
    case "faq_qna": {
      const faqLen = candidate.body_json.faq?.length ?? 0;
      if (faqLen < 5 || faqLen > 8) {
        failures.push(`FAQ has ${faqLen} pairs (must be 5–8)`);
      }
      break;
    }
    case "case_study": {
      const hasProfile =
        /\bAOV\b/.test(text) ||
        /average\s+order\s+value/i.test(text) ||
        /\bvertical\b/i.test(text) ||
        /monthly\s+(volume|disputes)/i.test(text);
      if (!hasProfile) {
        failures.push("no anonymized store profile (vertical / AOV / monthly volume)");
      }
      break;
    }
    case "definition_glossary":
    case "merchant_playbook":
    case "decision_framework":
    case "policy_implementation":
    case "tooling_overview":
      // These archetypes are too prone to false positives for static-heuristic
      // checks; embedding similarity (V7) and tier word count (V1) are the
      // load-bearing checks here.
      return null;
  }

  if (failures.length === 0) return null;

  const req = ARCHETYPE_REQUIREMENTS[archetype as ContentArchetype];
  return {
    id: "V5_archetype_must_haves",
    severity: "soft",
    message: `Archetype "${archetype}" must-haves missing: ${failures.join("; ")}.`,
    retryHint: `The article was generated as archetype "${archetype}" but is missing required signals: ${failures.join("; ")}. Required signals for this archetype:\n${req.mustHaves.map((m) => `- ${m}`).join("\n")}\nRegenerate with these covered explicitly. Do not add boilerplate to satisfy the check — make the additions substantive.`,
  };
}

/* ── V6 — No internal <a> links ───────────────────────────────────── */

export function v6_noInternalLinks(candidate: ValidatorCandidate): ValidatorFailure | null {
  const html = candidate.body_json.mainHtml ?? "";
  const anchors = html.match(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi) ?? [];
  const internal = anchors.filter((a) => {
    const href = a.match(/href=["']([^"']+)["']/i)?.[1] ?? "";
    if (!href) return false;
    if (href.startsWith("mailto:")) return false;
    if (href.startsWith("tel:")) return false;
    // External http(s) to non-DisputeDesk domains are OK.
    if (/^https?:\/\//i.test(href)) {
      return /disputedesk\.(app|co)/i.test(href);
    }
    // Relative paths and on-site fragments are internal.
    return true;
  });

  if (internal.length === 0) return null;

  return {
    id: "V6_no_internal_links",
    severity: "hard",
    message: `Body contains ${internal.length} internal <a> link(s) to DisputeDesk articles.`,
    retryHint: `The previous article included ${internal.length} <a href="…"> link(s) pointing to DisputeDesk articles. This is forbidden — cross-article navigation is handled exclusively by the "Related resources" section rendered below the article. Mention sibling topics in plain prose only, with NO anchor tags. Remove all internal <a> tags and rephrase the references as plain text.`,
  };
}

/* ── V8 — Slug locale match ───────────────────────────────────────── */

const STOPWORDS_FOR_SLUG_CHECK = new Set([
  "the",
  "and",
  "for",
  "with",
  "your",
  "guide",
  "to",
  "of",
  "in",
  "on",
  "a",
  "an",
  "is",
]);

export function v8_slugLocale(
  candidate: ValidatorCandidate,
  brief: ValidatorBriefContext,
  locale: string
): ValidatorFailure | null {
  if (locale === "en-US") return null;

  const slugTokens = new Set(
    candidate.slug
      .toLowerCase()
      .split(/[-_]+/)
      .filter((t) => t.length > 3)
  );
  if (slugTokens.size === 0) return null;

  const englishSources = [
    brief.proposedTitle,
    brief.targetKeyword ?? "",
  ]
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS_FOR_SLUG_CHECK.has(w));

  const matches = englishSources.filter((w) => slugTokens.has(w));
  if (matches.length === 0) return null;

  return {
    id: "V8_slug_locale",
    severity: "hard",
    message: `Slug "${candidate.slug}" contains English token(s) [${matches.join(", ")}] for locale ${locale}.`,
    retryHint: `The slug "${candidate.slug}" contains English words (${matches.join(", ")}) for non-English locale ${locale}. Slugs MUST be written in the same language as the article body, transliterated to ASCII. Regenerate with a slug using native ${locale} words only.`,
  };
}

/* ── V7 — Embedding semantic similarity ───────────────────────────── */

export interface EmbeddingClient {
  /** Returns the embedding vector for the given text; null on failure. */
  embed(text: string): Promise<number[] | null>;
}

const DEFAULT_EMBEDDING_THRESHOLD = 0.85;

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    aMag += a[i] * a[i];
    bMag += b[i] * b[i];
  }
  const denom = Math.sqrt(aMag) * Math.sqrt(bMag);
  return denom === 0 ? 0 : dot / denom;
}

function candidateEmbeddingText(c: ValidatorCandidate): string {
  const intro = extractIntroSnippet(c.body_json.mainHtml, 280) ?? "";
  return [c.title, c.excerpt, intro].filter(Boolean).join(" — ");
}

function peerEmbeddingText(p: SimilarContentReference): string {
  const intro = p.introSnippet ?? "";
  return [p.title, p.excerpt ?? "", intro].filter(Boolean).join(" — ");
}

export async function v7_embeddingSimilarity(
  candidate: ValidatorCandidate,
  peers: SimilarContentReference[],
  client: EmbeddingClient | null,
  threshold = DEFAULT_EMBEDDING_THRESHOLD
): Promise<ValidatorFailure | null> {
  if (!client || peers.length === 0) return null;

  const candText = candidateEmbeddingText(candidate);
  const candEmb = await client.embed(candText);
  if (!candEmb) return null;

  const limited = peers.slice(0, 5);
  let worstSim = 0;
  let worstPeer: SimilarContentReference | null = null;
  for (const p of limited) {
    const peerText = peerEmbeddingText(p);
    if (!peerText.trim()) continue;
    const peerEmb = await client.embed(peerText);
    if (!peerEmb) continue;
    const sim = cosineSimilarity(candEmb, peerEmb);
    if (sim > worstSim) {
      worstSim = sim;
      worstPeer = p;
    }
  }

  if (!worstPeer || worstSim < threshold) return null;

  return {
    id: "V7_embedding_similarity",
    severity: "hard",
    message: `Embedding cosine similarity ${worstSim.toFixed(3)} ≥ ${threshold} vs existing article "${worstPeer.title}".`,
    retryHint: `The article is too semantically similar (cosine ${worstSim.toFixed(3)}) to the existing DisputeDesk article "${worstPeer.title}" (slug: ${worstPeer.slug}). Pick a clearly distinct angle — different merchant type, different evidence type, different processor, different lifecycle stage, or different decision point — while staying on the same search intent. Different title, different opening, different examples, different FAQ wording.`,
  };
}

/* ── Default OpenAI embedding client ──────────────────────────────── */

export function makeOpenAIEmbeddingClient(apiKey: string | undefined): EmbeddingClient | null {
  if (!apiKey) return null;
  return {
    async embed(text: string): Promise<number[] | null> {
      try {
        const res = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: process.env.GENERATION_EMBEDDING_MODEL ?? "text-embedding-3-small",
            input: text.slice(0, 6000),
          }),
        });
        if (!res.ok) return null;
        const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
        const vec = json.data?.[0]?.embedding;
        return Array.isArray(vec) && vec.length > 0 ? vec : null;
      } catch {
        return null;
      }
    },
  };
}

/* ── Run-all + retry-feedback formatting ──────────────────────────── */

export interface RunValidatorsOptions {
  embeddingClient?: EmbeddingClient | null;
  embeddingThreshold?: number;
}

export interface RunValidatorsInput {
  candidate: ValidatorCandidate;
  brief: ValidatorBriefContext;
  peers: SimilarContentReference[];
  locale: string;
}

export async function runAllValidators(
  input: RunValidatorsInput,
  options: RunValidatorsOptions = {}
): Promise<ValidatorResult> {
  const { candidate, brief, peers, locale } = input;
  const failures: ValidatorFailure[] = [];

  const v1 = v1_tierMinimumWords(candidate, brief);
  if (v1) failures.push(v1);

  const v2 = v2_hypeTitle(candidate);
  if (v2) failures.push(v2);

  const v3 = v3_genericOpening(candidate);
  if (v3) failures.push(v3);

  const v4 = v4_shopifySpecificity(candidate, brief);
  if (v4) failures.push(v4);

  const v5 = v5_archetypeMustHaves(candidate, brief);
  if (v5) failures.push(v5);

  const v6 = v6_noInternalLinks(candidate);
  if (v6) failures.push(v6);

  const v8 = v8_slugLocale(candidate, brief, locale);
  if (v8) failures.push(v8);

  const v7 = await v7_embeddingSimilarity(
    candidate,
    peers,
    options.embeddingClient ?? null,
    options.embeddingThreshold
  );
  if (v7) failures.push(v7);

  return { ok: failures.length === 0, failures };
}

/** Builds a retry feedback instruction concatenating every failure's retry hint. */
export function formatValidatorRetryFeedback(failures: ValidatorFailure[]): string {
  if (failures.length === 0) return "";
  const numbered = failures
    .map((f, i) => `${i + 1}. [${f.id}, ${f.severity}] ${f.message}\n   Fix: ${f.retryHint}`)
    .join("\n\n");
  return `The previous output was rejected by the editorial validators. Address every issue below in the next attempt — do not selectively address only some. Return ONLY valid JSON matching the specified output format.

${numbered}`;
}

/** Hard validators must clear before the result is accepted; soft validators only generate warnings. */
export function hardFailures(failures: ValidatorFailure[]): ValidatorFailure[] {
  return failures.filter((f) => f.severity === "hard");
}

export function softFailures(failures: ValidatorFailure[]): ValidatorFailure[] {
  return failures.filter((f) => f.severity === "soft");
}
