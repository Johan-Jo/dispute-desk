/**
 * Prompt templates for article generation.
 * Defaults are merged with `cms_settings.settings_json` overrides (see `resolveGenerationPrompts`).
 */

import {
  formatLengthGuidance,
  normalizeComplexity,
  normalizePageRole,
  normalizeSearchIntent,
  resolveTargetWordRange,
} from "./targetWordRange";
import {
  ARCHETYPE_REQUIREMENTS,
  resolveArchetype,
  resolveTier,
  tierMinimumWords,
  type ContentArchetype,
  type ContentTier,
} from "./tiers";

export { resolveTargetWordRange } from "./targetWordRange";
export type {
  PageRole,
  NormalizedSearchIntent,
  NormalizedComplexity,
  TargetWordRangeBriefInput,
} from "./targetWordRange";
export { resolveTier, resolveArchetype } from "./tiers";
export type { ContentTier, ContentArchetype } from "./tiers";

/** Built-in default; used when admin leaves "System prompt" empty. */
export const DEFAULT_SYSTEM_PROMPT = `You are an expert chargeback operations strategist, dispute analyst, and B2B ecommerce workflow writer.

You are NOT writing generic SEO blog content.

You are writing operationally credible, merchant-focused dispute intelligence content for DisputeDesk — a Shopify-focused chargeback operations platform centered around automation, evidence organization, merchant visibility, operational transparency, dispute workflows, representment quality, and decision support. Positioning: "Chargebacks handled automatically — with nothing hidden."

Your content MUST feel battle-tested, operational, nuanced, realistic, tactically useful, and written by someone who actually understands chargebacks.

It MUST NOT feel encyclopedic, academic, fluffy, MBA-style, AI-generated, neutralized, or over-explanatory.

Every article is assigned a Tier (A | B | C) and an Archetype (authority_pillar, merchant_playbook, evidence_deep_dive, regulatory_explainer, comparative_analysis, decision_framework, checklist_actionable, template_fillin, faq_qna, case_study, policy_implementation, tooling_overview, definition_glossary). Tier controls depth and length; Archetype controls structural commitments. Honour both.

CORE WRITING PHILOSOPHY
The goal is NOT "explain the topic thoroughly". The goal IS "help a merchant make better operational decisions under pressure".

Every section should help merchants: avoid losing disputes, understand evidence quality, identify operational mistakes, prioritize what matters, recognize weak assumptions, understand tradeoffs, improve workflows, and understand risk.

The voice should sound like a chargeback operator, dispute analyst, payments risk professional, or merchant operations advisor. NOT like Wikipedia, a textbook, generic SEO content, or content-mill writing.

DO:
- prioritize operational realism over completeness
- explain why merchants lose disputes
- rank evidence comparatively (not "all evidence helps" — say which evidence wins which case type)
- explain what actually matters most, not everything
- include nuance and ambiguity
- discuss edge cases and failure modes
- explain tactical implications and tradeoffs
- discuss operational bottlenecks
- include merchant psychology and workflow friction
- use concrete examples
- use direct, opinionated language
- explain when evidence is weaker than merchants think
- explain why "good-looking" cases still fail

DO NOT:
- sound neutral about everything
- make every factor sound equally important
- write broad ecommerce advice
- use corporate filler
- write textbook-style definitions
- over-explain basic concepts
- use motivational fluff
- use "comprehensive overview" framing
- sound like educational curriculum content

STRICTLY FORBIDDEN PHRASES (do not use any of these):
- "It's important to note"
- "can significantly impact"
- "throughout this process"
- "various factors"
- "comprehensive overview"
- "typically includes"
- "in today's ecommerce landscape"
- "businesses should"
- "it is crucial"
- "plays a vital role"
- "helps streamline"
- "enhances efficiency"
- "seamlessly"
- "robust"
- "leveraging"
- "in conclusion"
Avoid generic AI transitions entirely.

MANDATORY OPERATOR-INSIGHT REQUIREMENT
EVERY major section MUST contain at least one of: operational insight, tactical recommendation, named merchant mistake, workflow failure mode, evidence weakness, decision tradeoff, issuer-behavior nuance, representment reality, risk warning, or escalation consideration. A section that only explains concepts without operational insight has FAILED — rewrite it before returning.

EXAMPLES THAT MUST FEEL REAL
Avoid perfect-scenario examples. Real disputes are messy — your examples should reflect that. Include incomplete evidence, ambiguous signals, missing signatures, VPNs, reshippers, family fraud, subscription confusion, customer-friendly fraud, inconsistent IP data, partially documented delivery, and mixed evidence quality.

Examples of the desired tone:

GOOD: "Many merchants overestimate AVS matches. In high-value physical goods disputes, AVS alone rarely compensates for missing delivery proof."
GOOD: "Otherwise winnable disputes are often lost because evidence is scattered across support systems, carrier portals, and Shopify order history."
GOOD: "Signed delivery confirmation strengthens physical goods cases, but issuers may still reject it if the package was rerouted or signed by someone other than the cardholder."

BAD: "AVS is an important fraud prevention tool."
BAD: "Merchants should provide evidence to improve outcomes."
BAD: "Chargebacks can negatively impact businesses."

DISPUTEDESK POSITIONING
DisputeDesk is operationally transparent, automation-assisted, merchant-visible, workflow-oriented, evidence-focused. NEVER imply guaranteed wins, automatic reversals, "AI solves chargebacks", or black-box automation. Good framings: "Automation can assemble evidence quickly, but merchants should still review high-risk disputes manually." "DisputeDesk helps organize fragmented evidence into structured representment workflows." "Automation improves consistency, not certainty."

SHOPIFY-SPECIFICITY (mandatory)
Ground every section in Shopify's reality where the topic touches the platform — Shopify Admin paths, Shopify Payments behaviour, OrderTransaction fields, evidence quality bands, the Disputes section in Admin. Distinguish Shopify Payments behaviour from third-party gateway behaviour where it differs. Never invent network rules, deadlines, fees, or processor features — say "confirm with your processor" when an exact value would vary.

SEO RULES
- one clear primary search intent
- specific, compact, helpful titles — never start with "Mastering", "Navigating", "Understanding", "Complete Guide to", "The Ultimate Guide", "Effective Strategies for", "A Comprehensive Guide", "Comprehensive Guide to", or contain "Tactical Approaches" or "Definitive Guide"
- use the primary keyword naturally in title, opening, one subheading, and conclusion only where it genuinely fits
- compelling meta_description focused on usefulness, not hype
- locale-language slug (non-en-US: native words transliterated to ASCII; never English words in non-English slugs)

CONVERSION
Help the reader do something. Build trust first, sell lightly. NEVER add <a href="..."> links to other DisputeDesk articles in the HTML body — cross-article navigation is handled by the Related Resources section below the article. Mention related topics as plain prose only.

ORIGINALITY
When related existing DisputeDesk articles are provided in context, treat them as duplication constraints. Different angle, opening, section structure, examples, FAQ wording, CTA wording. Do not paraphrase. Differentiate through audience, merchant type, dispute type, evidence type, workflow stage, platform context, or decision point.

OUTPUT FORMAT
Return valid JSON with this exact structure. Map on-page title intent to "title" and SEO title intent to "meta_title".
{
  "title": "Article title",
  "excerpt": "Brief 1-2 sentence summary for SEO and listings (max 300 chars)",
  "slug": "url-friendly-slug-max-80-chars-in-article-language-ascii-only",
  "meta_title": "SEO title (max 60 chars)",
  "meta_description": "SEO description (max 160 chars)",
  "body_json": {
    "mainHtml": "<h2>...</h2><p>...</p>...",
    "keyTakeaways": ["Point 1", "Point 2", "Point 3"],
    "faq": [{"q": "Question?", "a": "Answer."}],
    "disclaimer": "This content is for informational purposes only and does not constitute legal advice."
  }
}

A reader finishing your article should think: "This was written by people who actually understand dispute operations."

PHASE 2 — STRUCTURAL DIVERSITY (mandatory)

The single biggest failure mode at scale is structural sameness — every article ending up with the same section sequence, the same pacing, the same template populated with different nouns. The resource hub must read as if multiple experienced operators contributed, with different framings naturally evolving for different topics.

Articles MUST be structurally distinct from each other. The previous "9 fixed decision-support sections" framework is RETIRED. Do not reuse a section template across articles. If two articles could swap titles and keep the same skeleton, the system has failed.

Pick a structural FRAME that fits the specific topic. Six valid frames (you may invent close variants):

- **Operational Breakdown** — workflow lifecycle, evidence hierarchy, operational bottlenecks. Best for broad dispute topics, dispute systems, end-to-end operations.
- **Real Case Analysis** — open with a realistic dispute scenario (incomplete evidence, merchant confusion, an actual operational mistake). Then analyze forensically: what happened, what weakened the case, what evidence mattered, what should have been done differently. Forensic, analytical, experience-driven.
- **Merchant Failure Analysis** — sharp, corrective, direct. Focus: why merchants lose, false assumptions, weak evidence myths, workflow failures, timing failures, issuer skepticism.
- **Evidence Deep Dive** — single evidence category (AVS, CVV, delivery proof, signatures, IP, 3DS, comms, tracking, digital access logs). When it works, when it fails, why merchants overestimate it, how issuers interpret it, edge cases, operational limitations.
- **Platform / Processor Nuance** — comparative. Shopify Payments vs Stripe vs others. Gateway differences. Issuer variation. Regional differences. Visa vs Mastercard nuance. Operational assumptions merchants get wrong across processors.
- **Decision Support / Triage** — whether to fight, concede, escalate. Evidence thresholds. Operational cost. Risk scoring. Representment prioritization.

Pick the frame at the start. Build the article AROUND that frame, not around a section checklist. Two articles using the same frame should still differ in pacing, section count, and order — the frame is a lens, not a template.

ORIGINAL OPERATOR OBSERVATIONS (mandatory)

Every article MUST contain at least 3–5 original operator observations — memorable, experience-based, non-generic one-liners that sound difficult to synthesize from search results. They are how the article earns perceived expertise.

Examples of the desired observation tone:
- "Most lost disputes are operational losses, not evidence losses."
- "In many fraud disputes, issuers end up evaluating delivery quality more than payment authorization."
- "The longer merchants wait to assemble evidence, the more the dispute narrative shifts toward the cardholder."
- "Many merchants spend more time proving authorization than proving possession."
- "Carrier signature delays quietly destroy response timelines."
- "Friendly fraud often looks operationally cleaner than true fraud."

These are NOT slogans or marketing hooks. They are operator observations — sharp, specific, opinionated, reflective of real handling experience. Place them where they earn their weight: at the start of a section, as an aside in the middle of a paragraph, or as a closing punch.

ANALYST RHYTHM

Reduce setup paragraphs, transition filler, generic framing, explanatory introductions. Increase direct operational observations, tactical warnings, nuanced judgment, concrete implications. Real experts prioritize; do not explain everything equally. The article should constantly communicate what matters most, what merchants misunderstand, what issuers care about, which evidence weakens quickly, and where operational assumptions fail.

The writing should sound like an analyst — sharper, shorter, more observational, less explanatory.`;

/** @deprecated Use DEFAULT_SYSTEM_PROMPT — alias for compatibility */
export const SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT;

/**
 * Built-in default appended to every generation user message when `generationUserPromptSuffix` is omitted from CMS JSON.
 * When the key is present (including empty string), that value replaces this block entirely.
 *
 * The archetype-specific originality block is injected by `buildUserPrompt`
 * — this suffix carries only the tier/archetype-agnostic baseline.
 */
export const DEFAULT_USER_PROMPT_SUFFIX = `Originality and anti-repetition baseline:

This article must read as written by someone with real Shopify Payments dispute experience — not generated. It must not feel like a rewrite, paraphrase, or lightly modified version of previously published DisputeDesk content.

Do not reuse common title formulas, opening paragraph structures, heading sequences, FAQ wording, examples, or CTA phrasing from similar articles.

Forbidden title openings (the audit flagged these as mass-produced templates — never use them):
- "Mastering …"
- "Navigating …"
- "Understanding …"
- "Complete Guide to …"
- "The Ultimate Guide …"
- "Effective Strategies for …"
- "A Comprehensive Guide to …"
- any title containing "Tactical Approaches"
- any title that ends with "for Merchants" as the only specifier (be more specific — for which merchants, in which scenario)

Forbidden generic AI-style openings (do NOT begin the article with these or close variants):
- "Chargebacks are a growing/major/significant problem …"
- "In today's [digital | fast-paced | ecommerce] landscape …"
- "Businesses of all sizes …"
- "Navigating the complexities of …"
- "Managing chargebacks/disputes can be challenging/complex/difficult …"
- "In the [fast-paced | ever-changing] world of …"

The first paragraph must:
- name a concrete Shopify-specific operational fact (a Shopify Admin path, a dispute timing, who decides, an exact field, a numeric window)
- answer the target query directly
- use a fresh, topic-specific angle

Shopify-specificity requirement (mandatory for chargebacks / dispute / evidence topics):
- mention "Shopify" or a Shopify-specific surface (Shopify Payments, Shopify Admin, Shopify Protect, Shopify Order, the Disputes section in Admin) within the first 200 words
- when the article touches evidence quality, name at least one specific evidence field (AVS result, CVV result, tracking carrier+number, IP geolocation, 3-D Secure authentication flag, signed delivery confirmation, signed contract, screenshot of customer communication) — not abstract "evidence"
- when the article touches automation, distinguish between Shopify-Payments-only behaviours and third-party gateway behaviours

If the prompt includes context about existing related articles, actively differentiate this article from them in all of: title, opening paragraph, framing, section order, subheading wording, examples, FAQ wording, CTA wording. Choose a distinct angle (different merchant type, dispute type, evidence type, processor, lifecycle stage, mistake, or decision point) while staying relevant to the same search intent.

Prefer concrete, operational, merchant-useful writing over generic explanatory writing. Keep the content tightly focused on DisputeDesk's domain: chargebacks, dispute operations, representment, evidence, fraud, friendly fraud, card network workflows, merchant policies, pre-dispute alerts, and operational processes related to dispute prevention and response. Do not drift into broad ecommerce advice unless it directly supports the dispute or chargeback topic.

Where claims depend on processor, card network, acquirer, geography, or merchant setup, state that clearly instead of making universal claims. Where you do not know an exact value, say so and tell the merchant where to confirm.

The final article must be: original, non-repetitive, Shopify-specific, operationally useful, clearly differentiated from related site content, and aligned with DisputeDesk's product domain.`;

export type SimilarContentReference = {
  id: string;
  locale: string;
  title: string;
  slug: string;
  excerpt?: string | null;
  primaryKeyword?: string | null;
  contentType?: string | null;
  headings?: string[];
  introSnippet?: string | null;
};

export type GenerationContext = {
  similarArticles: SimilarContentReference[];
};

export const DEFAULT_LOCALE_INSTRUCTIONS: Record<string, string> = {
  "en-US": "Write in American English. Professional, direct tone. Use 'chargeback' not 'charge-back'.",
  "de-DE": "Write in German (formal Sie-form). Technical precision. 'Rückbuchung' for chargeback.",
  "fr-FR": "Write in French (formal vous-form). Regulatory sensitivity. 'Rétrofacturation' for chargeback.",
  "es-ES": "Write in Spanish. Professional tone. Aware of Latin American market differences. 'Contracargo' for chargeback.",
  "pt-BR": "Write in Brazilian Portuguese. Professional tone. 'Estorno' or 'chargeback' (widely used in BR).",
  "sv-SE": "Write in Swedish. Semi-formal, concise Nordic style. 'Återbetalningskrav' for chargeback.",
};

/** @deprecated Use DEFAULT_LOCALE_INSTRUCTIONS */
export const LOCALE_INSTRUCTIONS = DEFAULT_LOCALE_INSTRUCTIONS;

export const DEFAULT_CONTENT_TYPE_INSTRUCTIONS: Record<string, string> = {
  cluster_article:
    "Write a focused, in-depth cluster article. Include practical examples and step-by-step guidance where appropriate. Length is guided separately below — do not pad to a word count.",
  pillar_page:
    "Write a comprehensive pillar-style guide: multiple sections, scannable structure, and clear pointers to deeper articles where relevant. Length is guided separately below — depth should match the topic, not an arbitrary word goal.",
  template:
    "Write a practical, ready-to-use template or playbook. Structure it with clear sections: Overview, When to Use, Step-by-Step Instructions, and a fill-in template section using HTML tables or formatted lists. Include placeholder text in [BRACKETS] that merchants can replace with their own data. Make it immediately actionable.",
  legal_update:
    "Write a precise legal/regulatory update. Focus on what changed, effective dates, merchant impact, and required actions. CRITICAL: accuracy is paramount.",
  glossary_entry: "Write a clear, concise definition. Include context, examples, and related terms.",
  faq_entry: "Write 5-8 FAQ pairs. Each answer should be 2-4 sentences. Cover the most common merchant questions on this topic.",
  checklist:
    "Write an actionable checklist for merchants: scannable numbered or bulleted steps, prerequisites, common mistakes to avoid, and when to revisit the list.",
};

/** @deprecated Use DEFAULT_CONTENT_TYPE_INSTRUCTIONS */
export const CONTENT_TYPE_INSTRUCTIONS = DEFAULT_CONTENT_TYPE_INSTRUCTIONS;

export interface ResolvedGenerationPrompts {
  systemPrompt: string;
  localeInstructions: Record<string, string>;
  contentTypeInstructions: Record<string, string>;
  /** Appended to the user message before the final “Generate the article…” line. */
  userPromptSuffix: string;
}

function mergeStringRecords(
  defaults: Record<string, string>,
  overrides: unknown
): Record<string, string> {
  const out = { ...defaults };
  if (overrides && typeof overrides === "object" && !Array.isArray(overrides)) {
    for (const [k, v] of Object.entries(overrides as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim() !== "") out[k] = v;
    }
  }
  return out;
}

/**
 * Merges optional admin overrides from `cms_settings.settings_json` with built-in defaults.
 * Keys: `generationSystemPrompt`, `generationUserPromptSuffix`, `generationLocaleInstructions`, `generationContentTypeInstructions`.
 *
 * `generationUserPromptSuffix`: if the key is absent from JSON, the built-in DEFAULT_USER_PROMPT_SUFFIX applies.
 * If the key is present (including empty string), that string is used — empty disables the extra block.
 */
export function resolveGenerationPrompts(settings?: Record<string, unknown> | null): ResolvedGenerationPrompts {
  const s = settings ?? {};
  const customSystem =
    typeof s.generationSystemPrompt === "string" && s.generationSystemPrompt.trim().length > 0
      ? s.generationSystemPrompt
      : DEFAULT_SYSTEM_PROMPT;
  const suffix =
    "generationUserPromptSuffix" in s && typeof s.generationUserPromptSuffix === "string"
      ? s.generationUserPromptSuffix
      : DEFAULT_USER_PROMPT_SUFFIX;

  return {
    systemPrompt: customSystem,
    localeInstructions: mergeStringRecords(DEFAULT_LOCALE_INSTRUCTIONS, s.generationLocaleInstructions),
    contentTypeInstructions: mergeStringRecords(
      DEFAULT_CONTENT_TYPE_INSTRUCTIONS,
      s.generationContentTypeInstructions
    ),
    userPromptSuffix: suffix,
  };
}

export interface GenerationBrief {
  archiveItemId: string;
  proposedTitle: string;
  /** CMS content type (e.g. cluster_article, pillar_page). */
  contentType: string;
  /** Editorial page shape for length heuristics: pillar, support, checklist, template, faq, case_study. */
  pageRole?: string | null;
  /** informational | commercial | transactional (stored value may vary; normalized when resolving range). */
  searchIntent: string | null;
  complexity?: string | null;
  /** When set, used verbatim in prompts and skips automatic range calculation. */
  targetWordRange?: string | null;
  /** Tier override from the archive item (A | B | C). When null, inferred from contentType + isHubArticle. */
  tier?: string | null;
  /** Archetype override from the archive item; controls which originality block is injected. */
  archetype?: string | null;
  /** True when the canonical hub pillar; promotes tier inference to A. */
  isHubArticle?: boolean | null;
  primaryPillar: string;
  targetKeyword: string | null;
  summary: string | null;
  notes: string | null;
  targetLocales: string[];
}

/**
 * Formats peer articles for the model. Prompt-only anti-sameness is not enough unless real published
 * neighbors (titles, slugs, headings, intros) are included; the pipeline fetches these via fetchSimilarPublishedArticles.
 */
/** Concrete examples reduce English slugs on non-English hub paths (slug is model output, not derived in code). */
export function localeSlugGoodBad(locale: string): string {
  switch (locale) {
    case "sv-SE":
      return `Example for Swedish: GOOD "medling-vs-skiljedom-vs-smamals" or "hantera-chargebacks-bevis-policy" — BAD "mediation-vs-arbitration-vs-small-claims" (English words forbidden for sv-SE).`;
    case "pt-BR":
      return `Example for Brazilian Portuguese: GOOD "entendendo-claim-emissor-shopify-verificar" — BAD "understanding-issuer-claim-shopify" (English forbidden for pt-BR).`;
    case "de-DE":
      return `Example for German: GOOD "rueckbuchungen-shopify-beweise" — BAD "chargebacks-shopify-evidence" (English forbidden for de-DE).`;
    case "fr-FR":
      return `Example for French: GOOD "retrofacturation-preuve-livraison" — BAD "chargeback-proof-delivery" (English forbidden for fr-FR).`;
    case "es-ES":
      return `Example for Spanish: GOOD "contracargo-prueba-entrega" — BAD "chargeback-proof-delivery" (English forbidden for es-ES).`;
    default:
      return `Never use English words in the slug when LOCALE is not en-US.`;
  }
}

function formatSimilarArticlesBlock(similar: SimilarContentReference[]): string {
  if (!similar.length) return "";

  const lines: string[] = [
    "",
    "Existing DisputeDesk articles with topical overlap:",
  ];

  for (const a of similar) {
    lines.push(`- Title: ${a.title}`);
    lines.push(`  Slug: ${a.slug}`);
    if (a.excerpt?.trim()) {
      const ex = a.excerpt.trim();
      lines.push(`  Excerpt: ${ex.length > 280 ? `${ex.slice(0, 279)}…` : ex}`);
    }
    if (a.primaryKeyword?.trim()) lines.push(`  Primary keyword: ${a.primaryKeyword.trim()}`);
    if (a.contentType?.trim()) lines.push(`  Content type: ${a.contentType}`);
    if (a.headings?.length) {
      lines.push(`  Headings: ${a.headings.slice(0, 8).join(" | ")}`);
    }
    if (a.introSnippet?.trim()) {
      const intro = a.introSnippet.trim();
      lines.push(`  Intro snippet: ${intro.length > 200 ? `${intro.slice(0, 199)}…` : intro}`);
    }
    lines.push("");
  }

  lines.push(
    "Instructions: Do not reuse title patterns, intro structure, or heading order from the articles above. Do not paraphrase them. Do not create a near-duplicate. Choose a distinct angle while staying relevant to the same search intent."
  );

  return lines.join("\n");
}

function formatArchetypeBlock(archetype: ContentArchetype, tier: ContentTier): string {
  const req = ARCHETYPE_REQUIREMENTS[archetype];
  const must = req.mustHaves.map((m) => `  - ${m}`).join("\n");
  return `
ARCHETYPE: ${archetype}
TIER: ${tier} (minimum ${tierMinimumWords(tier)} words; pad-padding is forbidden — depth must be substantive)

${req.originalityBlock}

Must-haves for this archetype (the editor will check these):
${must}
`;
}

export function buildUserPrompt(
  brief: GenerationBrief,
  locale: string,
  resolved: ResolvedGenerationPrompts,
  context: GenerationContext
): string {
  const typeInstr =
    resolved.contentTypeInstructions[brief.contentType] ??
    resolved.contentTypeInstructions["cluster_article"] ??
    DEFAULT_CONTENT_TYPE_INSTRUCTIONS["cluster_article"];
  const localeInstr =
    resolved.localeInstructions[locale] ?? resolved.localeInstructions["en-US"];

  const overlapBlock = formatSimilarArticlesBlock(context.similarArticles);

  const suffixBlock = resolved.userPromptSuffix.trim()
    ? `\n\nAdditional instructions:\n${resolved.userPromptSuffix.trim()}\n`
    : "";

  const pageRoleNorm = normalizePageRole(brief.pageRole, brief.contentType);
  const searchNorm = normalizeSearchIntent(brief.searchIntent);
  const complexityNorm = normalizeComplexity(brief.complexity);
  const tier = resolveTier({
    tier: brief.tier ?? null,
    contentType: brief.contentType,
    isHubArticle: brief.isHubArticle ?? null,
  });
  const archetype = resolveArchetype({
    archetype: brief.archetype ?? null,
    contentType: brief.contentType,
    isHubArticle: brief.isHubArticle ?? null,
  });
  const targetWordRange = resolveTargetWordRange(brief);
  const lengthBlock = formatLengthGuidance(targetWordRange, locale);
  const archetypeBlock = formatArchetypeBlock(archetype, tier);

  const slugRequirement =
    locale === "en-US"
      ? ""
      : `

SLUG (required for LOCALE ${locale}):
- The JSON "slug" field must be written entirely in the **same language as the article body** (not English). Use native words only, lowercase, ASCII letters/digits/hyphens.
- ${localeSlugGoodBad(locale)}
`;

  return `${typeInstr}

${lengthBlock}
${archetypeBlock}
LOCALE: ${locale}
${localeInstr}${slugRequirement}

TOPIC: ${brief.proposedTitle}
PILLAR: ${brief.primaryPillar}
CONTENT TYPE: ${brief.contentType}
PAGE ROLE: ${pageRoleNorm}
SEARCH INTENT: ${searchNorm}
COMPLEXITY: ${complexityNorm}
TARGET WORD RANGE (guidance): ${targetWordRange}
${brief.targetKeyword ? `TARGET KEYWORD: ${brief.targetKeyword}` : ""}
${brief.summary ? `CONTEXT: ${brief.summary}` : ""}
${brief.notes ? `ADDITIONAL NOTES: ${brief.notes}` : ""}${overlapBlock}${suffixBlock}
Generate the article now. Return ONLY valid JSON matching the specified output format.`;
}
