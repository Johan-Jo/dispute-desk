/**
 * Derives a target word-count range from brief metadata (page role, complexity, search intent).
 * Explicit `targetWordRange` on the brief wins when set.
 */

export type PageRole = "pillar" | "support" | "checklist" | "template" | "faq" | "case_study";

export type NormalizedSearchIntent = "informational" | "commercial" | "transactional";

export type NormalizedComplexity = "low" | "medium" | "high";

const BASE_RANGES: Record<PageRole, readonly [number, number]> = {
  pillar: [1800, 2400],
  support: [1000, 1400],
  checklist: [700, 1100],
  template: [700, 1100],
  faq: [900, 1300],
  case_study: [900, 1400],
};

const PAGE_ROLES = new Set<string>([
  "pillar",
  "support",
  "checklist",
  "template",
  "faq",
  "case_study",
]);

const MIN_FLOOR = 700;
const MAX_CEILING = 2600;

export type TargetWordRangeBriefInput = {
  targetWordRange?: string | null;
  pageRole?: PageRole | string | null;
  contentType: string;
  searchIntent?: string | null;
  complexity?: string | null;
};

/** True when commercial intent should trim max (narrow / comparative pages — not the pillar hub). */
export function isNarrowOrComparativePageRole(role: PageRole): boolean {
  return role !== "pillar";
}

export function normalizePageRole(
  raw: string | null | undefined,
  contentType: string
): PageRole {
  const s = raw?.trim().toLowerCase();
  if (s && PAGE_ROLES.has(s)) return s as PageRole;
  return inferPageRoleFromContentType(contentType);
}

export function inferPageRoleFromContentType(contentType: string): PageRole {
  const t = contentType.trim().toLowerCase();
  if (t === "pillar_page") return "pillar";
  if (t === "template") return "template";
  if (t === "faq_entry") return "faq";
  if (t === "glossary_entry") return "support";
  if (t === "legal_update") return "case_study";
  return "support";
}

export function normalizeSearchIntent(raw: string | null | undefined): NormalizedSearchIntent {
  const s = raw?.trim().toLowerCase() ?? "";
  if (s === "commercial" || s === "transactional") return s;
  if (s === "transaction" || s === "navigational") return "transactional";
  if (s === "info" || s === "informational" || s === "") return "informational";
  return "informational";
}

export function normalizeComplexity(raw: string | null | undefined): NormalizedComplexity {
  const s = raw?.trim().toLowerCase() ?? "";
  if (s === "low" || s === "medium" || s === "high") return s;
  return "medium";
}

function complexityDelta(c: NormalizedComplexity): number {
  if (c === "high") return 200;
  if (c === "medium") return 100;
  return 0;
}

/**
 * Returns a human-readable range like "1900–2500 words" for prompts.
 * If `brief.targetWordRange` is non-empty, returns it unchanged.
 */
export function resolveTargetWordRange(brief: TargetWordRangeBriefInput): string {
  const explicit = brief.targetWordRange?.trim();
  if (explicit) return explicit;

  const pageRole = normalizePageRole(brief.pageRole, brief.contentType);
  const [baseMin, baseMax] = BASE_RANGES[pageRole];
  const complexity = normalizeComplexity(brief.complexity);
  const delta = complexityDelta(complexity);
  let min = baseMin + delta;
  let max = baseMax + delta;

  const intent = normalizeSearchIntent(brief.searchIntent);
  if (intent === "commercial" && isNarrowOrComparativePageRole(pageRole)) {
    max -= 100;
  }
  if (intent === "transactional" && pageRole !== "pillar") {
    min -= 100;
    max -= 100;
  }

  min = Math.max(MIN_FLOOR, min);
  max = Math.min(MAX_CEILING, max);
  if (min > max) max = min;

  return `${min}–${max} words`;
}

export const LENGTH_GUIDANCE_BLOCK = `Length guidance:
- Write to the shortest length that fully satisfies the search intent.
- Do not pad the article to reach a word count.
- Remove repetition, generic filler, and unnecessary recap sections.
- Target range for this page type: {{targetWordRange}}
- It is acceptable to finish below the range if the topic is fully covered clearly and specifically.`;

/** Appended for non-English locales so translations are not systematically shorter than English. */
export const NON_ENGLISH_LENGTH_SUPPLEMENT = `

Non-English locale (this request):
- Match the substantive depth, number of sections, and practical detail of a strong English article on the same topic. Do not shorten the article because the language is not English.
- Non-English prose often needs more words than English for the same ideas; that is expected. Prefer covering the topic fully over aggressive brevity.`;

/**
 * @param locale When not `en-US`, appends depth guidance so non-English outputs are not systematically shorter.
 */
export function formatLengthGuidance(targetWordRange: string, locale?: string): string {
  const base = LENGTH_GUIDANCE_BLOCK.replace("{{targetWordRange}}", targetWordRange);
  if (locale && locale !== "en-US") {
    return `${base}${NON_ENGLISH_LENGTH_SUPPLEMENT}`;
  }
  return base;
}
