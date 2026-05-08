/**
 * Derives a target word-count range from brief metadata.
 *
 * The primary signal is now `tier` (A | B | C) — see `./tiers.ts`. PageRole
 * remains as a *fine-grained* secondary signal for length adjustments
 * within a tier (a checklist within Tier C is shorter than a deep support
 * article within Tier C, etc.). Explicit `targetWordRange` on the brief
 * always wins.
 *
 * Why the tier rewrite: the legacy ranges (MAX_CEILING=2600) were the
 * mechanical reason every "pillar" we shipped came in around 2200 words
 * — well below what an authority pillar needs. The audit at
 * `docs/resources-hub-audit-2026-05-08.md` flagged 44 of 46 articles as
 * thin against tier minimums; raising the tier-A ceiling to 6000 is the
 * structural prerequisite for fixing that.
 */

import {
  TIER_RANGES,
  resolveTier,
  tierMinimumWords,
  tierMaximumWords,
  type ContentTier,
} from "./tiers";

export type PageRole = "pillar" | "support" | "checklist" | "template" | "faq" | "case_study";

export type NormalizedSearchIntent = "informational" | "commercial" | "transactional";

export type NormalizedComplexity = "low" | "medium" | "high";

const PAGE_ROLES = new Set<string>([
  "pillar",
  "support",
  "checklist",
  "template",
  "faq",
  "case_study",
]);

export type TargetWordRangeBriefInput = {
  targetWordRange?: string | null;
  pageRole?: PageRole | string | null;
  contentType: string;
  searchIntent?: string | null;
  complexity?: string | null;
  /** Tier override from the archive item (A | B | C). Inferred from contentType + isHubArticle when null. */
  tier?: string | null;
  /** True when the article is the canonical hub pillar; promotes tier inference to A. */
  isHubArticle?: boolean | null;
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
  if (t === "checklist") return "checklist";
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

/** Tier-aware complexity uplift. Tier A pages absorb much larger uplifts than Tier C. */
function complexityDelta(c: NormalizedComplexity, tier: ContentTier): number {
  if (tier === "A") {
    if (c === "high") return 500;
    if (c === "medium") return 200;
    return 0;
  }
  if (tier === "B") {
    if (c === "high") return 300;
    if (c === "medium") return 100;
    return 0;
  }
  if (c === "high") return 200;
  if (c === "medium") return 100;
  return 0;
}

/**
 * Within Tier C, page-role still matters: a checklist is intrinsically
 * shorter than a long-form support article. Allow a downward bump for
 * the most concise formats so we don't force every Tier C article to 1000 words.
 */
function tierCPageRoleAdjustment(role: PageRole): number {
  if (role === "checklist" || role === "template") return -200;
  if (role === "faq") return -100;
  return 0;
}

/**
 * Returns a human-readable range like "1900–2500 words" for prompts.
 * If `brief.targetWordRange` is non-empty, returns it unchanged.
 */
export function resolveTargetWordRange(brief: TargetWordRangeBriefInput): string {
  const explicit = brief.targetWordRange?.trim();
  if (explicit) return explicit;

  const tier = resolveTier({
    tier: brief.tier ?? null,
    contentType: brief.contentType,
    isHubArticle: brief.isHubArticle ?? null,
  });
  const tierRange = TIER_RANGES[tier];
  const pageRole = normalizePageRole(brief.pageRole, brief.contentType);
  const complexity = normalizeComplexity(brief.complexity);
  const intent = normalizeSearchIntent(brief.searchIntent);

  let [min, max] = tierRange.base;

  const delta = complexityDelta(complexity, tier);
  min += delta;
  max += delta;

  if (tier === "C") {
    const pageAdj = tierCPageRoleAdjustment(pageRole);
    min += pageAdj;
    max += pageAdj;
  }

  if (tier === "B" && intent === "commercial" && isNarrowOrComparativePageRole(pageRole)) {
    max -= 100;
  }
  if (tier === "C" && intent === "transactional") {
    min -= 100;
    max -= 100;
  }
  // Tier A is never trimmed by intent — pillars stay long even under commercial intent.

  min = Math.max(tierMinimumWords(tier), min);
  max = Math.min(tierMaximumWords(tier), max);
  if (min > max) max = min;

  return `${min}–${max} words`;
}

export const LENGTH_GUIDANCE_BLOCK = `Length guidance:
- Write to the shortest length that fully satisfies the search intent for this tier.
- Do not pad the article to reach a word count, but do not under-deliver either — Tier A authority articles must reach genuine depth.
- Remove repetition, generic filler, and unnecessary recap sections.
- Target range for this page type: {{targetWordRange}}
- It is acceptable to finish below the range when the topic is fully covered clearly and specifically; it is NOT acceptable for a Tier A article to end short of substantive coverage.`;

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
