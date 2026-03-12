/**
 * Help content and configuration for the Shopify embedded app only.
 * Separated from the portal/site help so the in-app experience can be
 * adapted (subset of articles, different copy, in-Shopify context).
 */

import { HELP_ARTICLES, getArticlesByCategory, type HelpArticle } from "./articles";
import { HELP_CATEGORIES, getCategoryBySlug, type HelpCategory } from "./categories";

/** Article slugs available in the embedded app (in this order for display). Portal-only articles (e.g. template-setup-wizard, portal flows) are excluded. */
const EMBEDDED_ARTICLE_SLUGS: string[] = [
  "connect-shopify-store",
  "understanding-dashboard",
  "first-dispute-sync",
  "automation-overview",
  "viewing-filtering-disputes",
  "syncing-disputes",
  "review-queue",
  "approving-disputes",
  "how-packs-built",
  "generating-pack-manually",
  "completeness-score",
  "fixing-blockers",
  "uploading-evidence",
  "evidence-checklist",
  "evidence-pack-templates",
  "defining-store-policies",
  "configuring-automation",
  "creating-first-rule",
  "rule-priority",
  "completeness-blocker-gates",
  "rule-presets",
  "plan-comparison",
  "upgrading-plan",
  "pack-limits",
  "trial-period",
  "store-session-upgrade",
  "how-evidence-saved",
  "field-mapping",
  "after-saving",
  "not-submit-to-networks",
];

/** Optional embedded-specific title/body i18n keys. Use when copy must differ for in-app context (e.g. "in this app" vs "in the portal"). Keys live under help.embedded.articles.{slug}.title / .body */
export const EMBEDDED_ARTICLE_COPY_OVERRIDES: Record<
  string,
  { titleKey: string; bodyKey: string }
> = {
  "connect-shopify-store": {
    titleKey: "help.embedded.articles.connectShopifyStore.title",
    bodyKey: "help.embedded.articles.connectShopifyStore.body",
  },
  "understanding-dashboard": {
    titleKey: "help.embedded.articles.understandingDashboard.title",
    bodyKey: "help.embedded.articles.understandingDashboard.body",
  },
  "after-saving": {
    titleKey: "help.embedded.articles.afterSaving.title",
    bodyKey: "help.embedded.articles.afterSaving.body",
  },
};

const EMBEDDED_SLUG_SET = new Set(EMBEDDED_ARTICLE_SLUGS);

/** Categories that have at least one embedded article, in display order. */
const EMBEDDED_CATEGORY_SLUGS = HELP_CATEGORIES.filter((cat) =>
  HELP_ARTICLES.some((a) => a.category === cat.slug && EMBEDDED_SLUG_SET.has(a.slug))
).map((c) => c.slug);

export function getEmbeddedArticles(): HelpArticle[] {
  return HELP_ARTICLES.filter((a) => EMBEDDED_SLUG_SET.has(a.slug));
}

export function getEmbeddedCategories(): HelpCategory[] {
  return EMBEDDED_CATEGORY_SLUGS
    .map((slug) => getCategoryBySlug(slug))
    .filter((c): c is HelpCategory => c != null);
}

export function getArticlesByCategoryForEmbedded(categorySlug: string): HelpArticle[] {
  return getArticlesByCategory(categorySlug).filter((a) => EMBEDDED_SLUG_SET.has(a.slug));
}

export function getArticleBySlugForEmbedded(slug: string): HelpArticle | undefined {
  const article = HELP_ARTICLES.find((a) => a.slug === slug);
  return article && EMBEDDED_SLUG_SET.has(slug) ? article : undefined;
}

/** Resolve title key for embedded app: use embedded override if present, else shared. */
export function getEmbeddedArticleTitleKey(article: HelpArticle): string {
  return EMBEDDED_ARTICLE_COPY_OVERRIDES[article.slug]?.titleKey ?? article.titleKey;
}

/** Resolve body key for embedded app: use embedded override if present, else shared. */
export function getEmbeddedArticleBodyKey(article: HelpArticle): string {
  return EMBEDDED_ARTICLE_COPY_OVERRIDES[article.slug]?.bodyKey ?? article.bodyKey;
}

/** Related slugs for an article, limited to those available in embedded. */
export function getEmbeddedRelatedSlugs(article: HelpArticle): string[] {
  const slugs = article.relatedSlugs ?? [];
  return slugs.filter((s) => EMBEDDED_SLUG_SET.has(s));
}
