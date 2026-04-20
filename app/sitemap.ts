import type { MetadataRoute } from "next";
import { getServiceClient } from "@/lib/supabase/server";
import {
  normalizeResourceHubPillar,
  RESOURCE_HUB_PILLARS,
} from "@/lib/resources/pillars";
import { getPublicSiteBaseUrl } from "@/lib/email/publicSiteUrl";

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
 * Build a full hreflang languages map for a path that is identical across all
 * locales (i.e. static hub pages where the path doesn't change, only the prefix).
 * Includes x-default pointing to the English (prefix-less) URL.
 */
function staticLanguages(path: string): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of LOCALES) {
    languages[locale.toLowerCase()] = localeUrl(path, locale);
  }
  // x-default: the non-prefixed English URL is our canonical fallback.
  languages["x-default"] = `${BASE_URL}${path}`;
  return languages;
}

/**
 * Push one <url> entry per locale for a static page. Each entry carries the
 * full hreflang set (including x-default) so Google sees every locale URL
 * as a first-class sitemap entry rather than just an alternate.
 */
function pushStaticEntries(
  entries: MetadataRoute.Sitemap,
  path: string,
  priority: number,
): void {
  const languages = staticLanguages(path);
  for (const locale of LOCALES) {
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

  // ── Static hub pages — one <url> entry per locale ──────────────────────────
  pushStaticEntries(entries, "/", 1.0);
  pushStaticEntries(entries, "/resources", 0.9);
  pushStaticEntries(entries, "/glossary", 0.7);
  pushStaticEntries(entries, "/templates", 0.7);
  pushStaticEntries(entries, "/case-studies", 0.7);

  try {
    const sb = getServiceClient();

    // ── Resources articles ──────────────────────────────────────────────────
    {
      const { data: items } = await sb
        .from("content_items")
        .select("id, updated_at, primary_pillar, is_hub_article")
        .eq("workflow_status", "published");

      for (const item of items ?? []) {
        // Only include localizations that belong to the "resources" route so
        // that template / glossary / case-study articles are not accidentally
        // mapped to /resources/ paths.
        const { data: locs } = await sb
          .from("content_localizations")
          .select("locale, slug")
          .eq("content_item_id", item.id)
          .eq("route_kind", "resources")
          .eq("is_published", true);

        if (!locs?.length) continue;

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
      const { data: locs } = await sb
        .from("content_localizations")
        .select("locale, slug, content_item_id, content_items!inner(updated_at, workflow_status)")
        .eq("route_kind", "templates")
        .eq("is_published", true)
        .eq("locale", "en-US")
        .eq("content_items.workflow_status", "published");

      for (const loc of locs ?? []) {
        if (!loc.slug) continue;
        const languages = await buildLocaleAlternates(
          sb,
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
      const { data: locs } = await sb
        .from("content_localizations")
        .select("locale, slug, content_item_id, content_items!inner(updated_at, workflow_status)")
        .eq("route_kind", "glossary")
        .eq("is_published", true)
        .eq("locale", "en-US")
        .eq("content_items.workflow_status", "published");

      for (const loc of locs ?? []) {
        if (!loc.slug) continue;
        const languages = await buildLocaleAlternates(
          sb,
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
      const { data: locs } = await sb
        .from("content_localizations")
        .select("locale, slug, content_item_id, content_items!inner(updated_at, workflow_status)")
        .eq("route_kind", "case-studies")
        .eq("is_published", true)
        .eq("locale", "en-US")
        .eq("content_items.workflow_status", "published");

      for (const loc of locs ?? []) {
        if (!loc.slug) continue;
        const languages = await buildLocaleAlternates(
          sb,
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
