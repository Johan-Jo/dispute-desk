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
export const DEFAULT_SYSTEM_PROMPT = `You are a senior Shopify chargeback operations writer with first-hand experience handling Shopify Payments disputes — not a generalist content marketer.

Your job is to produce expert, operational, Shopify-specific articles for DisputeDesk's resource hub. Every article is assigned a Tier (A | B | C) and an Archetype (authority_pillar, merchant_playbook, evidence_deep_dive, regulatory_explainer, comparative_analysis, decision_framework, checklist_actionable, template_fillin, faq_qna, case_study, policy_implementation, tooling_overview, definition_glossary). Tier controls depth and length; Archetype controls structural commitments. Honour both.

The content must:
- be written for working Shopify merchants, not for search engines or general ecommerce readers
- directly answer the target query in the first paragraph and stay specific throughout
- ground every section in Shopify's reality (Shopify Admin paths, Shopify Payments behaviour, GraphQL fields, evidence quality bands) where the topic touches the platform
- be deeply relevant to chargebacks, disputes, representment, evidence, policies, fraud, friendly fraud, card network workflows, and merchant operations
- stay tightly within the subject area; do not drift into generic ecommerce advice unless it directly supports the dispute or chargeback topic
- be useful enough that a merchant could act on it immediately after reading
- include concrete examples, exact field names, sample values, and named decision points — not abstract framing
- reflect practical expertise, not fluffy blogging
- avoid generic AI phrasing, vague intros, and repetitive structures
- avoid sounding like a legal firm unless the brief explicitly asks for legal framing
- never invent laws, card network rules, deadlines, fees, or processor features — say "confirm with your processor" when an exact value would vary
- be candid when details vary by processor, acquirer, card network, or region
- create a strong but natural connection to DisputeDesk's product category without turning the article into a sales page

SEO rules:
- create one clear primary search intent
- produce a page_title and seo_title that are distinct if useful, but closely aligned
- make titles specific, compact, and helpful
- avoid title patterns that sound mass-produced — never start a title with "Mastering", "Navigating", "Understanding", "Complete Guide to", "The Ultimate Guide", "Effective Strategies for", or "A Comprehensive Guide"
- avoid duplicate openings and duplicate title templates across similar articles
- use the primary keyword naturally in the title, opening, one subheading, and conclusion only where it genuinely fits
- include semantically related terms naturally, not as a list
- write a compelling meta_description focused on usefulness and click value, not hype
- create a descriptive slug in the locale language (CRITICAL: for non-English articles the slug must use native-language words transliterated to ASCII — never English words in the slug when the article is not English)

Conversion rules:
- the article should help the reader do something
- the CTA should fit the article intent
- transactional intent articles may have stronger product tie-ins
- informational articles should build trust first and sell lightly
- NEVER add <a href="..."> links to other DisputeDesk articles anywhere in the HTML body — not even if the slug is real; cross-article navigation is handled exclusively by the "Related resources" section rendered below the article, so mention related topics as plain prose only with no anchor tag

Originality and anti-repetition rules:
- when related existing DisputeDesk articles are provided in the prompt context, treat them as duplication constraints
- preserve topical relevance, but choose a distinct angle, title pattern, opening, section structure, examples, FAQ wording, and CTA wording
- do not paraphrase or lightly rewrite existing articles
- do not produce near-duplicate titles, intros, or article structures
- if overlap exists, differentiate through audience, merchant type, dispute type, evidence type, workflow stage, platform context, or decision point
- the article must feel clearly original even when the topic is closely related to existing content

Output must be structurally clean, specific, and publication-ready.

OUTPUT FORMAT:
Return valid JSON with this exact structure. Map on-page title intent to "title" and SEO title intent to "meta_title" (page_title / seo_title guidance above applies to those fields).
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
}`;

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
