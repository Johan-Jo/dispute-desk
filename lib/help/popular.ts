/**
 * Hand-curated "Popular Articles" list for the embedded help page.
 *
 * Stub-only — there is no analytics or popularity tracking backend yet.
 * Counts are illustrative; revisit when we ship real article-view tracking.
 */

export interface PopularArticle {
  slug: string;
  views: number;
  helpful: number;
}

export const POPULAR_ARTICLES: PopularArticle[] = [
  { slug: "how-packs-built", views: 1240, helpful: 156 },
  { slug: "evidence-strength-rubric", views: 980, helpful: 142 },
  { slug: "evidence-pack-templates", views: 876, helpful: 128 },
  { slug: "rule-priority", views: 654, helpful: 98 },
  { slug: "completeness-score", views: 543, helpful: 87 },
];
