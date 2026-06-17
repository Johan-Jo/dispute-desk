import type { MetadataRoute } from "next";
import { getServiceClient } from "@/lib/supabase/server";
import {
  normalizeResourceHubPillar,
  RESOURCE_HUB_PILLARS,
} from "@/lib/resources/pillars";
import { getPublicSiteBaseUrl } from "@/lib/email/publicSiteUrl";
import { isLocalizationSitemapEligible } from "@/lib/resources/redirects";
import { COMPETITOR_SLUGS } from "@/lib/compare/competitors";

const BASE_URL = getPublicSiteBaseUrl();

const LOCALES = ["en-US", "de-DE", "fr-FR", "es-ES", "pt-BR", "sv-SE"];
const LOCALE_PREFIXES: Record<string, string> = {
  "en-US": "",
  "de-DE": "/de",
  "fr-FR": "/fr",
  "es-ES": "/es",
  "pt-BR": "/pt",
  "sv-SE": "/sv",
};

/** Route kinds whose hub-index page lives under `/<route>` on the marketing site. */
type HubRouteKind = "resources" | "templates" | "glossary" | "case-studies";

/**
 * Per-locale, per-route count of published localizations. Used to suppress
 * empty hub-index URLs from the sitemap — submitting `/de/case-studies` when
 * `case-studies` has zero `de-DE` rows triggers GSC "crawled, currently not
 * indexed" because the page renders an empty grid (200 OK with no content).
 */
async function publishedCountsByLocale(
  sb: ReturnType<typeof getServiceClient>,
  routeKind: HubRouteKind,
): Promise<Map<string, number>> {
  const { data, error } = await sb
    .from("content_localizations")
    .select("locale, content_items!inner(workflow_status)")
    .eq("route_kind", routeKind)
    .eq("is_published", true)
    .eq("content_items.workflow_status", "published");
  const counts = new Map<string, number>();
  if (error || !data) return counts;
  for (const row of data as Array<{ locale: string }>) {
    counts.set(row.locale, (counts.get(row.locale) ?? 0) + 1);
  }
  return counts;
}

function localeUrl(path: string, locale: string): string {
  const prefix = LOCALE_PREFIXES[locale] ?? "";
  // Home path under a prefixed locale must NOT carry a trailing slash
  // (e.g. `/sv/` 308-redirects to `/sv`, which Google flags as "Page with redirect").
  // For the default (unprefixed) locale, keep `/` as the canonical root.
  if (path === "/") {
    return prefix ? `${BASE_URL}${prefix}` : `${BASE_URL}/`;
  }
  return `${BASE_URL}${prefix}${path}`;
}

/**
 * Push one <url> entry per locale for a static page. Each entry carries the
 * hreflang set (including x-default) so Google sees every locale URL
 * as a first-class sitemap entry rather than just an alternate.
 *
 * When `localeFilter` is provided, only locales whose count is > 0 get a
 * <url> entry AND only those locales appear in the hreflang alternates set.
 * Submitting empty hub URLs (e.g. `/de/case-studies` with zero `de-DE` rows)
 * causes GSC to crawl an empty grid page and refuse to index it.
 */
function pushStaticEntries(
  entries: MetadataRoute.Sitemap,
  path: string,
  priority: number,
  localeFilter?: Map<string, number>,
): void {
  const eligible = localeFilter
    ? LOCALES.filter((l) => (localeFilter.get(l) ?? 0) > 0)
    : LOCALES;
  if (eligible.length === 0) return;

  const languages: Record<string, string> = {};
  for (const locale of eligible) {
    languages[locale.toLowerCase()] = localeUrl(path, locale);
  }
  // x-default: prefer the unprefixed English URL when English is eligible,
  // otherwise fall back to the first available locale so Google still has a
  // canonical anchor.
  if (languages["en-us"]) {
    languages["x-default"] = `${BASE_URL}${path}`;
  } else {
    const first = Object.values(languages)[0];
    if (first) languages["x-default"] = first;
  }

  for (const locale of eligible) {
    entries.push({
      url: localeUrl(path, locale),
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority,
      alternates: { languages },
    });
  }
}

/** Build per-locale alternate URLs only from localizations that match `routeKind`. */
async function buildLocaleAlternates(
  sb: ReturnType<typeof getServiceClient>,
  contentItemId: string,
  routeKind: string,
  buildPath: (slug: string) => string,
): Promise<Record<string, string>> {
  const { data: locs } = await sb
    .from("content_localizations")
    .select("locale, slug")
    .eq("content_item_id", contentItemId)
    .eq("route_kind", routeKind)
    .eq("is_published", true);

  const languages: Record<string, string> = {};
  for (const loc of locs ?? []) {
    if (!loc.slug) continue;
    const tag = loc.locale.toLowerCase();
    const prefix = LOCALE_PREFIXES[loc.locale] ?? "";
    languages[tag] = `${BASE_URL}${prefix}${buildPath(loc.slug)}`;
  }
  // x-default points to the English version of the article.
  if (languages["en-us"]) languages["x-default"] = languages["en-us"];
  return languages;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [];

  let sb: ReturnType<typeof getServiceClient> | null = null;
  let resourcesCounts: Map<string, number> | undefined;
  let templatesCounts: Map<string, number> | undefined;
  let glossaryCounts: Map<string, number> | undefined;
  let caseStudiesCounts: Map<string, number> | undefined;
  try {
    sb = getServiceClient();
    [resourcesCounts, templatesCounts, glossaryCounts, caseStudiesCounts] =
      await Promise.all([
        publishedCountsByLocale(sb, "resources"),
        publishedCountsByLocale(sb, "templates"),
        publishedCountsByLocale(sb, "glossary"),
        publishedCountsByLocale(sb, "case-studies"),
      ]);
  } catch (err) {
    console.error("[sitemap] Failed to load hub counts:", err);
  }

  // ── Static hub pages — one <url> entry per locale ──────────────────────────
  // Marketing home is always available (renders from i18n messages, not DB).
  pushStaticEntries(entries, "/", 1.0);
  // Section hubs: skip locales (and route kinds entirely) when zero published
  // localizations exist — empty pages get rejected as "crawled, not indexed".
  pushStaticEntries(entries, "/resources", 0.9, resourcesCounts);
  pushStaticEntries(entries, "/glossary", 0.7, glossaryCounts);
  pushStaticEntries(entries, "/templates", 0.7, templatesCounts);
  pushStaticEntries(entries, "/case-studies", 0.7, caseStudiesCounts);
  // Inbound GTM lead-capture funnel: the landing page is localized (chrome
  // translated across all locales); the Playbook reader is English-only content
  // but still indexable, so it gets a single unprefixed entry.
  pushStaticEntries(entries, "/playbook", 0.8);
  entries.push({
    url: `${BASE_URL}/playbook/read`,
    lastModified: new Date(),
    changeFrequency: "monthly",
    priority: 0.7,
  });

  // ── Compare hub + competitor alternative pages ─────────────────────────────
  // Code-defined (not DB), fully localized across every locale, so each gets a
  // <url> entry per locale with the full hreflang set.
  pushStaticEntries(entries, "/compare", 0.8);
  for (const slug of COMPETITOR_SLUGS) {
    pushStaticEntries(entries, `/compare/${slug}`, 0.8);
  }

  if (!sb) {
    return entries;
  }
  const sbClient = sb;

  try {
    // ── Resources articles ──────────────────────────────────────────────────
    {
      const { data: items } = await sbClient
        .from("content_items")
        .select("id, updated_at, primary_pillar, is_hub_article")
        .eq("workflow_status", "published");

      for (const item of items ?? []) {
        // Only include localizations that belong to the "resources" route so
        // that template / glossary / case-study articles are not accidentally
        // mapped to /resources/ paths.
        const { data: locsRaw } = await sbClient
          .from("content_localizations")
          .select(
            "locale, slug, redirect_to_localization_id, is_excluded_from_sitemap, quality_status"
          )
          .eq("content_item_id", item.id)
          .eq("route_kind", "resources")
          .eq("is_published", true);

        // Filter out rows that are 301-redirected, manually excluded, or
        // marked thin / rewrite_pending (PR 4 + PR 5 canonicalization).
        const locs = (locsRaw ?? []).filter(isLocalizationSitemapEligible);
        if (!locs.length) continue;

        const pillar =
          normalizeResourceHubPillar(item.primary_pillar) ?? RESOURCE_HUB_PILLARS[0];

        // Build the full hreflang map once — used by every locale's <url> entry.
        const languages: Record<string, string> = {};
        for (const loc of locs) {
          if (!loc.slug) continue;
          const tag = loc.locale.toLowerCase();
          const prefix = LOCALE_PREFIXES[loc.locale] ?? "";
          languages[tag] = `${BASE_URL}${prefix}/resources/${pillar}/${loc.slug}`;
        }
        // x-default points to the English version of the article.
        if (languages["en-us"]) languages["x-default"] = languages["en-us"];

        const isHub = (item as Record<string, unknown>).is_hub_article === true;
        const lastModified = item.updated_at ? new Date(item.updated_at) : new Date();

        // One <url> entry per locale so every translated URL is submitted individually.
        for (const loc of locs) {
          if (!loc.slug) continue;
          const prefix = LOCALE_PREFIXES[loc.locale] ?? "";
          entries.push({
            url: `${BASE_URL}${prefix}/resources/${pillar}/${loc.slug}`,
            lastModified,
            changeFrequency: isHub ? "weekly" : "monthly",
            priority: isHub ? 0.9 : 0.8,
            alternates: { languages },
          });
        }
      }
    }

    // ── Templates ───────────────────────────────────────────────────────────
    {
      const { data: locsRaw } = await sbClient
        .from("content_localizations")
        .select(
          "locale, slug, content_item_id, redirect_to_localization_id, is_excluded_from_sitemap, quality_status, content_items!inner(updated_at, workflow_status)"
        )
        .eq("route_kind", "templates")
        .eq("is_published", true)
        .eq("locale", "en-US")
        .eq("content_items.workflow_status", "published");

      const locs = (locsRaw ?? []).filter(isLocalizationSitemapEligible);
      for (const loc of locs) {
        if (!loc.slug) continue;
        const languages = await buildLocaleAlternates(
          sbClient,
          loc.content_item_id,
          "templates",
          (s) => `/templates/${s}`,
        );
        const item = loc.content_items as { updated_at?: string } | { updated_at?: string }[];
        const updatedAt = Array.isArray(item) ? item[0]?.updated_at : item?.updated_at;
        const lastModified = updatedAt ? new Date(updatedAt) : new Date();
        for (const [, url] of Object.entries(languages)) {
          entries.push({
            url,
            lastModified,
            changeFrequency: "monthly",
            priority: 0.7,
            alternates: { languages },
          });
        }
      }
    }

    // ── Glossary entries ────────────────────────────────────────────────────
    {
      const { data: locsRaw } = await sbClient
        .from("content_localizations")
        .select(
          "locale, slug, content_item_id, redirect_to_localization_id, is_excluded_from_sitemap, quality_status, content_items!inner(updated_at, workflow_status)"
        )
        .eq("route_kind", "glossary")
        .eq("is_published", true)
        .eq("locale", "en-US")
        .eq("content_items.workflow_status", "published");

      const locs = (locsRaw ?? []).filter(isLocalizationSitemapEligible);
      for (const loc of locs) {
        if (!loc.slug) continue;
        const languages = await buildLocaleAlternates(
          sbClient,
          loc.content_item_id,
          "glossary",
          (s) => `/glossary/${s}`,
        );
        const item = loc.content_items as { updated_at?: string } | { updated_at?: string }[];
        const updatedAt = Array.isArray(item) ? item[0]?.updated_at : item?.updated_at;
        const lastModified = updatedAt ? new Date(updatedAt) : new Date();
        for (const [, url] of Object.entries(languages)) {
          entries.push({
            url,
            lastModified,
            changeFrequency: "monthly",
            priority: 0.6,
            alternates: { languages },
          });
        }
      }
    }

    // ── Case studies ────────────────────────────────────────────────────────
    {
      const { data: locsRaw } = await sbClient
        .from("content_localizations")
        .select(
          "locale, slug, content_item_id, redirect_to_localization_id, is_excluded_from_sitemap, quality_status, content_items!inner(updated_at, workflow_status)"
        )
        .eq("route_kind", "case-studies")
        .eq("is_published", true)
        .eq("locale", "en-US")
        .eq("content_items.workflow_status", "published");

      const locs = (locsRaw ?? []).filter(isLocalizationSitemapEligible);
      for (const loc of locs) {
        if (!loc.slug) continue;
        const languages = await buildLocaleAlternates(
          sbClient,
          loc.content_item_id,
          "case-studies",
          (s) => `/case-studies/${s}`,
        );
        const item = loc.content_items as { updated_at?: string } | { updated_at?: string }[];
        const updatedAt = Array.isArray(item) ? item[0]?.updated_at : item?.updated_at;
        const lastModified = updatedAt ? new Date(updatedAt) : new Date();
        for (const [, url] of Object.entries(languages)) {
          entries.push({
            url,
            lastModified,
            changeFrequency: "monthly",
            priority: 0.7,
            alternates: { languages },
          });
        }
      }
    }
  } catch (err) {
    console.error("[sitemap] Failed to load content:", err);
  }

  return entries;
}
