/**
 * Prompt templates for article generation.
 * Defaults are merged with `cms_settings.settings_json` overrides (see `resolveGenerationPrompts`).
 */

/** Built-in default; used when admin leaves "System prompt" empty. */
export const DEFAULT_SYSTEM_PROMPT = `You are an expert content writer for DisputeDesk, a Shopify chargeback automation platform. You write authoritative, accurate content about chargebacks, payment disputes, and merchant protection.

RULES:
- Only cite publicly available sources: Shopify documentation, Visa/Mastercard/Amex public rules, relevant regulations.
- Never fabricate statistics, case studies, or regulatory citations.
- Use professional, clear language appropriate for e-commerce merchants.
- Structure content with proper HTML headings (h2, h3), paragraphs, lists, and tables where appropriate.
- Include actionable advice merchants can implement immediately.
- Write in the specified language/locale with appropriate formality level.

OUTPUT FORMAT:
Return valid JSON with this exact structure:
{
  "title": "Article title",
  "excerpt": "Brief 1-2 sentence summary for SEO and listings (max 300 chars)",
  "slug": "url-friendly-slug-max-80-chars",
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
  cluster_article: "Write a focused, in-depth article (1500-2500 words). Include practical examples and step-by-step guidance where appropriate.",
  pillar_page: "Write a comprehensive guide (3000-5000 words). Cover the topic exhaustively with multiple sections, tables, and cross-references. This should be the definitive resource on this topic.",
  template: "Write a practical, ready-to-use template or playbook (800-1500 words). Structure it with clear sections: Overview, When to Use, Step-by-Step Instructions, and a fill-in template section using HTML tables or formatted lists. Include placeholder text in [BRACKETS] that merchants can replace with their own data. Make it immediately actionable.",
  legal_update: "Write a precise legal/regulatory update (800-1500 words). Focus on what changed, effective dates, merchant impact, and required actions. CRITICAL: accuracy is paramount.",
  glossary_entry: "Write a clear, concise definition (200-400 words). Include context, examples, and related terms.",
  faq_entry: "Write 5-8 FAQ pairs. Each answer should be 2-4 sentences. Cover the most common merchant questions on this topic.",
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
 */
export function resolveGenerationPrompts(settings?: Record<string, unknown> | null): ResolvedGenerationPrompts {
  const s = settings ?? {};
  const customSystem =
    typeof s.generationSystemPrompt === "string" && s.generationSystemPrompt.trim().length > 0
      ? s.generationSystemPrompt
      : DEFAULT_SYSTEM_PROMPT;
  const suffix =
    typeof s.generationUserPromptSuffix === "string" ? s.generationUserPromptSuffix : "";

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
  contentType: string;
  primaryPillar: string;
  targetKeyword: string | null;
  searchIntent: string | null;
  summary: string | null;
  notes: string | null;
  targetLocales: string[];
}

export function buildUserPrompt(
  brief: GenerationBrief,
  locale: string,
  resolved: ResolvedGenerationPrompts
): string {
  const typeInstr =
    resolved.contentTypeInstructions[brief.contentType] ??
    resolved.contentTypeInstructions["cluster_article"] ??
    DEFAULT_CONTENT_TYPE_INSTRUCTIONS["cluster_article"];
  const localeInstr =
    resolved.localeInstructions[locale] ?? resolved.localeInstructions["en-US"];

  const suffixBlock = resolved.userPromptSuffix.trim()
    ? `\n\nAdditional instructions:\n${resolved.userPromptSuffix.trim()}\n`
    : "";

  return `${typeInstr}

LOCALE: ${locale}
${localeInstr}

TOPIC: ${brief.proposedTitle}
PILLAR: ${brief.primaryPillar}
${brief.targetKeyword ? `TARGET KEYWORD: ${brief.targetKeyword}` : ""}
${brief.searchIntent ? `SEARCH INTENT: ${brief.searchIntent}` : ""}
${brief.summary ? `CONTEXT: ${brief.summary}` : ""}
${brief.notes ? `ADDITIONAL NOTES: ${brief.notes}` : ""}${suffixBlock}
Generate the article now. Return ONLY valid JSON matching the specified output format.`;
}
