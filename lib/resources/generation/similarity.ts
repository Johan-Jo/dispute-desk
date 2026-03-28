import type { SimilarContentReference } from "./prompts";

export type ContentForSimilarityCheck = {
  title: string;
  excerpt: string;
  slug: string;
};

export type SimilarityGuardFailureReason =
  | "slug_collision"
  | "title_too_similar"
  | "title_excerpt_too_similar";

export type SimilarityGuardResult =
  | { ok: true }
  | { ok: false; reason: SimilarityGuardFailureReason; detail: string };

const SIMILARITY_RETRY_INSTRUCTION = `The previous JSON output was rejected: it was too similar to existing DisputeDesk articles on this site (matching slug, title, or title+excerpt overlap). Regenerate the full article with a clearly distinct angle, a different title pattern, a different opening, different section order and headings, different FAQ and examples. Stay on the same search intent but do not paraphrase existing articles. Return ONLY valid JSON matching the specified output format.`;

export function getSimilarityRetryInstruction(): string {
  return SIMILARITY_RETRY_INSTRUCTION;
}

/** Deterministic word-level overlap; good enough for v1 without embeddings. */
function normalizeWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9äöüéèáíóúãõçåæøœß\s]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function wordJaccard(a: string, b: string): number {
  const A = new Set(normalizeWords(a));
  const B = new Set(normalizeWords(b));
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const w of A) {
    if (B.has(w)) inter += 1;
  }
  const uni = A.size + B.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

const TITLE_JACCARD_THRESHOLD = 0.58;
const TITLE_EXCERPT_JACCARD_THRESHOLD = 0.5;

/**
 * Post-generation guard: slug collision (DB or similar list), near-duplicate title, or title+excerpt combo.
 */
export function assessGeneratedSimilarity(
  candidate: ContentForSimilarityCheck,
  similar: SimilarContentReference[],
  slugCollidesInDb: boolean
): SimilarityGuardResult {
  if (slugCollidesInDb) {
    return {
      ok: false,
      reason: "slug_collision",
      detail: `Slug "${candidate.slug}" already exists for this locale and route`,
    };
  }

  const candSlug = candidate.slug.trim().toLowerCase();
  for (const ref of similar) {
    if (ref.slug && ref.slug.toLowerCase() === candSlug) {
      return {
        ok: false,
        reason: "slug_collision",
        detail: `Slug matches existing article "${ref.title}"`,
      };
    }
  }

  const candTitle = candidate.title.trim();
  const candCombo = `${candidate.title} ${candidate.excerpt}`.trim();

  for (const ref of similar) {
    const tj = wordJaccard(candTitle, ref.title);
    if (tj >= TITLE_JACCARD_THRESHOLD) {
      return {
        ok: false,
        reason: "title_too_similar",
        detail: `Title too close to existing: "${ref.title}"`,
      };
    }
    const refCombo = `${ref.title} ${ref.excerpt ?? ""}`.trim();
    const cj = wordJaccard(candCombo, refCombo);
    if (cj >= TITLE_EXCERPT_JACCARD_THRESHOLD) {
      return {
        ok: false,
        reason: "title_excerpt_too_similar",
        detail: `Title+excerpt overlap with: "${ref.title}"`,
      };
    }
  }

  return { ok: true };
}
