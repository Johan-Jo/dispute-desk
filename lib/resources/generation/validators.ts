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
  | "V8_slug_locale"
  | "V9_uniform_pacing"
  | "V10_incomplete_body"
  | "V11_title_length";

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
  /\bis crucial\b/i,
  /\bplays a vital role\b/i,
  /\bhelps streamline\b/i,
  /\benhances efficiency\b/i,
  /\bseamlessly\b/i,
  /\brobust\b/i,
  /\bleveraging\b/i,
  /\bin conclusion\b/i,
  /\bthe importance of\b/i,
  /\bis the backbone of\b/i,
  /\bis key to\b/i,
  /\bthis example underscores\b/i,
  /\bthis highlights\b/i,
  /\bthis demonstrates\b/i,
];

/**
 * Section-heading patterns that mark educational / blog-mode framing.
 * These are HARD-fails because they signal the article reverted to "explain
 * basics" mode regardless of word choice elsewhere.
 */
const EXPLANATORY_HEADING_PATTERNS: RegExp[] = [
  /^understanding\b/i,
  /^what is\b/i,
  /^what are\b/i,
  /^importance of\b/i,
  /^the importance of\b/i,
  /^introduction\b/i,
  /^overview\b/i,
  /\bbackbone\b/i,
];

/**
 * Schema-leaked heading patterns. When the two-pass assembler uses Pass 1's
 * JSON field names (or close stylistic renames) as section headings, the
 * article ends up with the same skeleton regardless of topic — exactly the
 * structural sameness the user is targeting. Hard-fails any of these patterns.
 */
const SCHEMA_LEAKED_HEADING_PATTERNS: RegExp[] = [
  // Old (v1) schema field names. "failure modes?" is anchored so it only fires on
  // the BARE schema-category heading ("Failure Modes", "Critical Failure Modes"),
  // NOT when the phrase sits inside a legitimate descriptive heading ("Operational
  // failure modes that lose winnable cases") — the system prompt explicitly asks
  // for operational failure modes, so that good form must survive. The other
  // phrases keep their original \b-matching (they don't collide with natural prose).
  /^(?:\w+\s+){0,2}failure modes?$/i,
  /\bevidence hierarch/i,
  /\bmessy examples?\b/i,
  /\breal[- ]world scenarios?\b/i,
  /^operational notes?\b/i,
  /^operational insights?\b/i,
  /\bworkflow (insights?|notes?)\b/i,
  /\bprocessor (and|&) network caveats?\b/i,
  /\bprocessor caveats?\b/i,
  /\bnetwork caveats?\b/i,
  /\bgateway caveats?\b/i,
  /\bgateway variance\b/i,
  /\bprocessor variance\b/i,
  /\bcross[- ]system variance\b/i,
  /\bvariance constraints?\b/i,
  /\bnon[- ]universal conditions?\b/i,
  /\bvariation between (processors?|gateways?|networks?)\b/i,
  /\bdispute[- ]?desk'?s role\b/i,
  /\bdisputedesk(?:'s)? (role|positioning|transparency)/i,
  /\boperational transparency with disputedesk\b/i,
  /^common operational mistakes?\b/i,
  /\bhow evidence strength (actually )?works\b/i,
  // New (v2) schema field names — must NOT appear as headings either
  /\bcentral argument\b/i,
  /\bprimary operational sequence\b/i,
  /\boperational sequence\b/i,
  /\bevidence tensions?\b/i,
  /\bdeveloped scenarios?\b/i,
  /\binline variance\b/i,
  /\bpositioning constraints?\b/i,
  // Product-centered closing sections — DisputeDesk should be folded into prose,
  // never given its own section. These patterns turn an article into product
  // marketing instead of merchant decision support.
  /\bwhere automation fits\b/i,
  /\bwhere automation helps\b/i,
  /\bwhere disputedesk (fits|helps|comes in)\b/i,
  /\brole of automation\b/i,
  /\bwhat automation (handles|does|can do)\b/i,
  /\bwhere the (tool|product|platform) fits\b/i,
  /\bautomation in (chargeback|dispute|evidence)/i,
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

function extractH2Headings(html: string): string[] {
  const out: string[] = [];
  const re = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html ?? "")) !== null) {
    const text = m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (text) out.push(text);
  }
  return out;
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

  // Tier-relative floors. The hard floor scales with the tier minimum so that a
  // genuinely under-tier article is *rejected*, not merely warned about:
  //   < 60% of tier-min → HARD (too far below floor to ship; force a retry/reject)
  //   60% of tier-min .. tier-min → SOFT (close enough that editorial review decides)
  // The absolute 300w stub floor remains a lower bound (covers Tier C, whose
  // 60% is 480 — well above 300). Historically this was a flat 300w hard floor,
  // which let 380w cluster/pillar drafts publish as soft warnings; the qualitative
  // validators (schema leakage, archetype must-haves, internal links) do not catch
  // missing depth, so word count must enforce the tier floor itself.
  const STUB_HARD_FLOOR = Math.max(300, Math.floor(min * 0.6));
  const severity: ValidatorSeverity = wc < STUB_HARD_FLOOR ? "hard" : "soft";

  let retryHint: string;
  if (wc < 300) {
    retryHint = `The previous article was only ${wc} words — that is a stub, not an article. Develop the strongest messy scenario from the source material in full. Walk the operational workflow end-to-end. Compare evidence strength comparatively. Each major section should carry operational weight, not be a one-line summary. The tier-${tier} minimum is ${min} words.`;
  } else if (wc < STUB_HARD_FLOOR) {
    retryHint = `The previous article was only ${wc} words; the tier-${tier} minimum is ${min} words and this is well below it. Expand by developing the strongest messy scenario from the source material in full (not summarized), walking the Shopify workflow end-to-end, and comparing evidence strength comparatively. Do not add generic padding — add operational depth. Several sections should run 3–5 paragraphs.`;
  } else {
    retryHint = `The previous article was ${wc} words; aim for the tier-${tier} minimum of ${min} words. Do not pad — develop one or two sections more fully (the strongest messy scenario, the workflow walk-through, or the evidence comparison) without inventing new substance.`;
  }

  return {
    id: "V1_tier_minimum_words",
    severity,
    message: `Article body is ${wc} words; tier ${tier} minimum is ${min}.${
      wc < STUB_HARD_FLOOR ? " (under-developed)" : ""
    }`,
    retryHint,
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

  // Section-heading scan: any explanatory heading is a HARD fail. These are
  // unambiguous signals the article reverted to AI-blog mode.
  const headings = extractH2Headings(candidate.body_json.mainHtml);
  for (const h of headings) {
    for (const re of EXPLANATORY_HEADING_PATTERNS) {
      if (re.test(h)) {
        return {
          id: "V3_generic_opening",
          severity: "hard",
          message: `Section heading "${h}" uses explanatory / educational framing (${re}).`,
          retryHint: `The article contains a section heading "${h}" that signals AI-blog mode. Section headings must NEVER start with "Understanding", "What is", "What are", "Importance of", "The Importance of", "Introduction", or "Overview", and must NEVER contain "backbone". Section headings should be sharp, topic-specific, observational. Replace with a heading that names a concrete operational angle (e.g. "Why merchants lose this", "Where this breaks", "AVS Y but no tracking — what wins"). Assume the reader already understands what chargebacks are.`,
        };
      }
    }
    for (const re of SCHEMA_LEAKED_HEADING_PATTERNS) {
      if (re.test(h)) {
        return {
          id: "V3_generic_opening",
          severity: "hard",
          message: `Section heading "${h}" mirrors a Pass 1 JSON schema category (${re}).`,
          retryHint: `The section heading "${h}" derives from the source-material JSON schema instead of the topic itself. NEVER produce headings like "Failure Modes", "Evidence Hierarchy", "Messy Examples", "Real-World Scenarios", "Operational Notes/Insights", "Workflow Notes", "Processor Caveats", or "DisputeDesk's Role" — they all leak the input schema as the article skeleton. Synthesize a topic-specific heading instead (e.g. "Why AVS Y still loses fraud disputes", "The 10-day clock and where it quietly slips", "When the issuer cares more about delivery than authorization"). The source material is INPUT, not OUTLINE — merge fields, split fields, omit categories that don't earn placement.`,
        };
      }
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

/**
 * Brand names and cross-language loanwords that legitimately appear in
 * non-English slugs/titles — they must NOT count as "English tokens" in the
 * V8 slug-locale check (e.g. "shopify" is a proper noun in every language;
 * "chargeback" / "paypal" / "visa" are widely used loanwords in ecommerce copy).
 */
const SLUG_ALLOWED_LOANWORDS = new Set([
  "shopify",
  "chargeback",
  "chargebacks",
  "paypal",
  "visa",
  "mastercard",
  "amex",
  "stripe",
  "klarna",
  "ecommerce",
  "app",
  "saas",
  "b2b",
  // Card-network program / standard acronyms — proper nouns that stay as-is in
  // every language (like "chargeback"). Without these, V8 wrongly rejects valid
  // non-English slugs for articles about Visa/Mastercard monitoring programs.
  "vamp", // Visa Acquirer Monitoring Program
  "vfmp", // Visa Fraud Monitoring Program
  "vdmp", // Visa Dispute Monitoring Program
  "ecm", // Mastercard Excessive Chargeback Merchant
  "ecp", // Excessive Chargeback Program
  "avs", // Address Verification System
  "cvv", // Card Verification Value
  "emv", // EMV chip standard
  // Dispute-domain loanwords used as-is across languages (like "chargeback").
  "representment", // re-presenting a transaction to fight a chargeback
  "interchange", // interchange fee
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
      // length > 3 skips short connectors; exclude all-digit tokens (years like
      // "2026", model numbers) — they are language-neutral and legitimately
      // appear in slugs of every locale, so they must never count as an
      // "English token" (this caused false V8 rejections on non-English locales).
      .filter((t) => t.length > 3 && !/^\d+$/.test(t))
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

  const matches = englishSources.filter((w) => slugTokens.has(w) && !SLUG_ALLOWED_LOANWORDS.has(w));
  if (matches.length === 0) return null;

  return {
    id: "V8_slug_locale",
    severity: "hard",
    message: `Slug "${candidate.slug}" contains English token(s) [${matches.join(", ")}] for locale ${locale}.`,
    retryHint: `The slug "${candidate.slug}" contains English words (${matches.join(", ")}) for non-English locale ${locale}. Slugs MUST be written in the same language as the article body, transliterated to ASCII. Regenerate with a slug using native ${locale} words only.`,
  };
}

/* ── V9 — Uniform pacing detector (soft) ──────────────────────────── */

/**
 * Pull body text per H2 section so we can measure how uniform the section
 * lengths are. The model frequently produces "schema-as-skeleton with
 * different labels" outputs where every section is one paragraph of similar
 * length — we want to soft-warn on that.
 */
function sectionWordCounts(html: string): number[] {
  const re = /<h2\b[^>]*>[\s\S]*?<\/h2>([\s\S]*?)(?=<h2\b|$)/gi;
  const counts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html ?? "")) !== null) {
    counts.push(wordCount(htmlToText(m[1])));
  }
  return counts;
}

export function v9_uniformPacing(candidate: ValidatorCandidate): ValidatorFailure | null {
  const counts = sectionWordCounts(candidate.body_json.mainHtml);
  if (counts.length < 4) return null; // need enough sections for a uniformity claim

  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const mean = total / counts.length;
  if (mean < 30) return null; // article is too short to even diagnose

  const variance =
    counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length;
  const stdDev = Math.sqrt(variance);
  const cv = stdDev / mean; // coefficient of variation

  // Threshold tuned so that:
  //   counts = [50, 60, 55, 50] (CV ~0.07) → flagged
  //   counts = [50, 200, 30, 90] (CV ~0.66) → not flagged
  if (cv >= 0.35) return null;

  return {
    id: "V9_uniform_pacing",
    severity: "soft",
    message: `Section lengths are uniform (CV ${cv.toFixed(2)}, mean ${Math.round(mean)} words across ${counts.length} sections). Reads like a schema-as-skeleton article.`,
    retryHint: `Section lengths in the article are too uniform — every H2 has roughly the same body length, which signals the schema-as-skeleton failure mode in pacing form. Vary section lengths dramatically. A 1-paragraph section can sit next to a 5-paragraph one. Some sections should dominate; others should be brief asides. The article should NOT read as N evenly-distributed mini-articles. If a category from the source material doesn't have something concrete to say for THIS topic, drop it entirely instead of giving it a uniform paragraph.`,
  };
}

/* ── V10 — Incomplete / truncated body (hard) ─────────────────────── */

/**
 * Rejects an article whose `mainHtml` ends mid-sentence. Structured outputs
 * (output_config.format) occasionally make Sonnet END THE BODY EARLY to satisfy
 * the JSON schema — it stops writing prose mid-sentence, then closes the JSON
 * with the remaining fields (keyTakeaways/faq/disclaimer). The result is valid
 * JSON with `stop_reason: end_turn`, so nothing upstream catches it — observed:
 * an article ending `<p>The merchant's evidence answered ` with no closing tag.
 *
 * A complete body's last visible text ends with terminal punctuation (`.`, `!`,
 * `?`, `:`), a closing quote/paren after punctuation, or a list/heading. A body
 * that ends on a bare word — or has an unclosed final `<p>` — is incomplete.
 *
 * Single-attempt pipeline (no retries): a hard failure here simply means the
 * locale is not published, rather than re-billing a regeneration.
 */
export function v10_incompleteBody(candidate: ValidatorCandidate): ValidatorFailure | null {
  const html = (candidate.body_json.mainHtml ?? "").trim();
  if (!html) return null; // V1 handles empty/too-short

  // 1. Unclosed final paragraph: more <p> opens than </p> closes.
  const opens = (html.match(/<p\b[^>]*>/gi) ?? []).length;
  const closes = (html.match(/<\/p>/gi) ?? []).length;
  const unclosedParagraph = opens > closes;

  // 2. Last visible text ends mid-sentence. Strip tags, look at the final char.
  const text = htmlToText(html);
  // Terminal: sentence punctuation, optionally followed by a closing quote/paren/bracket.
  const endsComplete = /[.!?:][")'\]”»]?$/.test(text);

  if (!unclosedParagraph && endsComplete) return null;

  const tail = text.slice(-80);
  return {
    id: "V10_incomplete_body",
    severity: "hard",
    message: `Article body appears truncated — ends mid-sentence${unclosedParagraph ? " with an unclosed <p>" : ""}: "…${tail}".`,
    retryHint:
      "The article body ended mid-sentence (the model stopped writing prose early to close the JSON). Write the COMPLETE article: every paragraph must be a full sentence ending in proper punctuation, every <p> must be closed, and the final section must reach a natural conclusion. Do not abandon a sentence to finish the JSON structure — finish the prose first.",
  };
}

/* ── V11 — Title length / keyword-stuffing (hard, en-US source only) ── */

/**
 * Rejects an over-long `title`. Google displays ~50–60 characters / ~600px of a
 * title tag; longer titles get truncated in SERPs and read as keyword-stuffing.
 * Enforced on the en-US SOURCE title only — non-English titles are DeepL
 * translations of it and can legitimately run longer (German/French expansion);
 * gating those would reject correct translations. The generation prompt also
 * instructs ≤ 60 chars; this is the deterministic backstop.
 */
export const TITLE_MAX_CHARS = 60;

export function v11_titleLength(candidate: ValidatorCandidate, locale: string): ValidatorFailure | null {
  if (locale !== "en-US") return null;
  const t = (candidate.title ?? "").trim();
  if (t.length <= TITLE_MAX_CHARS) return null;
  return {
    id: "V11_title_length",
    severity: "hard",
    message: `Title is ${t.length} characters (max ${TITLE_MAX_CHARS} for SEO): "${t}".`,
    retryHint: `The title is ${t.length} characters — Google truncates titles past ~60 characters and over-long titles read as keyword-stuffing. Rewrite the title to ${TITLE_MAX_CHARS} characters or fewer. Pick ONE specific angle; do not chain multiple sub-topics with commas/colons (e.g. not "Chargeback Lifecycle, Costs, and How to Fight Back: 2026 Merchant Playbook"). Keep it concise and specific.`,
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

  const v9 = v9_uniformPacing(candidate);
  if (v9) failures.push(v9);

  const v10 = v10_incompleteBody(candidate);
  if (v10) failures.push(v10);

  const v11 = v11_titleLength(candidate, locale);
  if (v11) failures.push(v11);

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

/**
 * Hard floor gate for AUTO-publish (autopilot). Failures here must block an
 * automatic publish and park the item for human review instead.
 *
 * This is `hardFailures` PLUS the tier word-count floor (V1) at ANY severity: an
 * under-floor article is a stub and must never auto-publish — that's the SEO
 * non-negotiable. V1's soft band (60–100% of floor) still drives the editorial
 * UI and the sync-path retry threshold unchanged; this only governs the
 * publish/park decision, so the global validator semantics and their tests are
 * untouched. A parked locale is not a silent drop — the caller records the
 * reason on the held content item so it surfaces in admin.
 */
export function publishBlockers(failures: ValidatorFailure[]): ValidatorFailure[] {
  const hard = hardFailures(failures);
  const underFloor = failures.find(
    (f) => f.id === "V1_tier_minimum_words" && !hard.some((h) => h.id === f.id)
  );
  return underFloor ? [...hard, underFloor] : hard;
}
