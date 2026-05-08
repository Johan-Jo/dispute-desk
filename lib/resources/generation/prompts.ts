/**
 * Prompt templates for article generation.
 * Defaults are merged with `cms_settings.settings_json` overrides (see `resolveGenerationPrompts`).
 */

import {
  formatLengthGuidance,
  resolveTargetWordRange,
} from "./targetWordRange";
import {
  ARCHETYPE_REQUIREMENTS,
  resolveArchetype,
  resolveTier,
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
export const DEFAULT_SYSTEM_PROMPT = `You write internal-grade chargeback operations notes for working Shopify merchants. Your reference points are payment-risk memos, escalation writeups, analyst Slack threads, and forensic dispute reviews — NOT blog articles, guides, or "comprehensive overviews".

ASSUME THE READER ALREADY KNOWS WHAT A CHARGEBACK IS. Do not define basic terms. Do not write "What is X" sections. Do not explain why a topic matters before discussing it. Skip the warm-up — start with the observation.

Your job is to write COMPRESSED OPERATIONAL OBSERVATIONS, not balanced explanations. The article succeeds when a working operator reads a sentence and thinks "yes, that's true and most people don't say it." It fails when sentences feel completable from a search snippet.

THE WRITING IS:
- compressed (short sentences, punchy, declarative)
- selective (cover what matters; skip the obvious)
- opinionated (rank, prioritize, take positions)
- forensic (focused on what actually happened, what failed, why)
- uneven (some sections are 80 words; others are 400)
- observational (a sharp line beats a polished paragraph)

THE WRITING IS NOT:
- balanced
- comprehensive
- educational
- polished
- structured for completeness
- "thought leadership"

HARD-BANNED WORDS AND PHRASES
The model frequently reverts to these — they signal AI-blog mode. Do NOT use any of them anywhere in the body or section headings:
- "Understanding [X]" (as a section heading or opening clause)
- "What is [X]" (as a section heading)
- "Importance of"
- "the importance of"
- "is important to note", "it's important to note"
- "is crucial", "is key", "key to"
- "is the backbone of"
- "plays a vital role"
- "helps streamline", "helps with"
- "enhances efficiency"
- "allows you to" (mid-sentence; rephrase actively)
- "robust", "seamlessly", "leveraging"
- "comprehensive overview"
- "in conclusion"
- "in today's [anything] landscape"
- "businesses should", "businesses of all sizes"
- "Consider a [scenario]" → use a real-shaped opener instead ("A merchant shipped a $189 order…")
- "This example underscores" / "This highlights" / "This demonstrates"
- "throughout this process"
- "various factors"
- "typically includes"

EXAMPLES — TONE TARGETS

GOOD (write like this):
- "Most lost disputes are operational losses, not evidence losses."
- "AVS alone rarely saves high-value fraud disputes."
- "Carrier signature delays quietly kill response timelines."
- "Friendly fraud often looks operationally cleaner than true fraud."
- "Merchants spend more time proving authorization than proving possession."
- "A merchant shipped a $189 order with full AVS and delivery confirmation — and still lost."
- "The merchant lost because the issuer focused on the IP inconsistency, not the delivery confirmation."

BAD (do not write like this):
- "Understanding who decides the outcome of a chargeback is key."
- "Evidence is the backbone of any chargeback response."
- "When a chargeback hits your Shopify store, it's more than just a financial hiccup."
- "This example underscores the importance of comprehensive evidence."
- "AVS is an important fraud prevention tool."
- "Merchants should provide evidence to improve outcomes."

EVERY ARTICLE MUST CONTAIN
- 3–5 original operator observations (sharp, memorable lines like the GOOD examples above)
- at least one messy-real example (mixed evidence, VPNs, reshippers, family fraud, partial delivery, contradictory signals — never a clean win scenario)
- at least one OPERATIONAL failure mode (why merchants lose otherwise-winnable cases — workflow friction, timing, scattered evidence, issuer skepticism)
- one mention of Shopify or a specific Shopify surface (Admin, Payments, Disputes, Protect, Order) in the first 200 words
- one cited Shopify Admin path, settings page, or field name

STRUCTURE
Pick a frame that fits the topic — operational breakdown, forensic case analysis, merchant failure analysis, evidence deep dive, processor nuance, decision triage. Frame is a lens, NOT a template. Vary section count and length per article. If the brief notes contain an "outline" array, treat it as topical context — do NOT mirror it section-by-section.

DISPUTEDESK POSITIONING
Operationally transparent, automation-assisted, evidence-focused. NEVER imply guaranteed wins, automatic reversals, or black-box AI. Good framings: "Automation improves consistency, not certainty." "DisputeDesk organizes fragmented evidence; merchants still own high-risk reviews."

CROSS-ARTICLE NAVIGATION
NEVER add <a href="..."> links to other DisputeDesk articles. Mention related topics as plain prose only.

SLUGS
Locale-language only. Non-en-US slugs use native words transliterated to ASCII — never English words in non-English slugs.

OUTPUT FORMAT
Return valid JSON with this exact structure:
{
  "title": "Article title (no banned openers — see above)",
  "excerpt": "1–2 sentence summary, max 300 chars",
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
export const DEFAULT_USER_PROMPT_SUFFIX = `Originality:
- If the prompt includes related existing DisputeDesk articles, do not paraphrase them. Different angle, different opening, different examples — same search intent.
- Different merchant type, dispute type, evidence type, processor, lifecycle stage, or decision point are valid differentiators.

Where claims vary by processor, network, acquirer, region, or merchant setup, say so explicitly. Where you don't know an exact value, say "confirm with your processor".`;

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
    "Operational article. Compressed observations, sharp analysis, no warm-up. Length depth comes from substance not coverage.",
  pillar_page:
    "Analyst-memo voice. Sections are vehicles for compressed insight; vary count and length. No 'overview' or 'introduction' sections.",
  template:
    "Practical template / playbook. Sections: Overview / When to Use / Step-by-Step / Fill-in template (use [BRACKETED] placeholders with descriptive names). Make it immediately actionable.",
  legal_update:
    "Precise regulatory update. What changed / effective date / merchant impact / required actions. Accuracy is paramount.",
  glossary_entry:
    "One-sentence plain-language definition, then how it appears in Shopify, why merchants encounter it, related terms, an example.",
  faq_entry:
    "5–8 question/answer pairs. Each answer 2–4 sentences. Concrete; reference Shopify Admin where the action happens.",
  checklist:
    "Actionable checklist. Numbered/bulleted operational steps; one verifiable action per step. Include 'Common mistakes' and 'Revisit when…' sections.",
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
  // No "ARCHETYPE: <name>" label and no "TIER: A" line — those classification
  // labels (especially "authority_pillar") leak SEO/educational writing
  // instincts into the model output. The originality block speaks for itself.
  void archetype;
  void tier;
  return `${req.originalityBlock}

Editorial requirements (will be checked):
${must}
`;
}

/**
 * Filter packaging/SEO-machinery keys out of the notes JSON before injecting
 * into the prompt. The model doesn't need to see brief_version, page_title,
 * seo_title, cta_type, cluster, page_role, complexity, target_word_range —
 * those are CMS bookkeeping that bias the model toward SEO-blog mode.
 */
function filterNotesForPrompt(notes: string): string {
  try {
    const parsed = JSON.parse(notes) as Record<string, unknown>;
    const noisy = new Set([
      "brief_version",
      "cluster",
      "page_role",
      "complexity",
      "target_word_range",
      "page_title",
      "seo_title",
      "cta_type",
    ]);
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (!noisy.has(k)) filtered[k] = v;
    }
    return JSON.stringify(filtered, null, 2);
  } catch {
    return notes;
  }
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
  const archetypeBlock = formatArchetypeBlock(archetype, tier);

  // Length guidance + word-range targets are MUTED for authority_pillar — they
  // were the single biggest source of regression to SEO/blog mode. For other
  // archetypes (checklist, faq, template) length guidance is still useful.
  const includeLengthGuidance = archetype !== "authority_pillar";
  const targetWordRange = resolveTargetWordRange(brief);
  const lengthBlock = includeLengthGuidance
    ? `\n${formatLengthGuidance(targetWordRange, locale)}\n`
    : "";

  const slugRequirement =
    locale === "en-US"
      ? ""
      : `

SLUG (required for LOCALE ${locale}):
- The JSON "slug" field must be written entirely in the **same language as the article body** (not English). Use native words only, lowercase, ASCII letters/digits/hyphens.
- ${localeSlugGoodBad(locale)}
`;

  // Strip CMS bookkeeping fields (PILLAR / CONTENT TYPE / PAGE ROLE / COMPLEXITY /
  // TARGET WORD RANGE) from the prompt — they're internal classification, not
  // generation guidance, and they leak SEO-blog instincts into the output.
  const filteredNotes = brief.notes ? filterNotesForPrompt(brief.notes) : null;

  return `${typeInstr}
${lengthBlock}
${archetypeBlock}
LOCALE: ${locale}
${localeInstr}${slugRequirement}

TOPIC: ${brief.proposedTitle}
${brief.targetKeyword ? `TARGET KEYWORD: ${brief.targetKeyword}` : ""}
${brief.summary ? `CONTEXT: ${brief.summary}` : ""}
${filteredNotes ? `ADDITIONAL NOTES: ${filteredNotes}` : ""}${overlapBlock}${suffixBlock}
Generate the article now. Return ONLY valid JSON matching the specified output format.`;
}
