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
  return `${BASE_URL}${prefix}${path}`;
}

function alternates(path: string) {
  const languages: Record<string, string> = {};
  for (const locale of LOCALES) {
    const tag = locale.toLowerCase();
    languages[tag] = localeUrl(path, locale);
  }
  return { languages };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [];

  // Static pages
  const staticPages = [
    { path: "/", priority: 1.0 },
    { path: "/resources", priority: 0.9 },
    { path: "/glossary", priority: 0.7 },
    { path: "/templates", priority: 0.7 },
    { path: "/case-studies", priority: 0.7 },
  ];

  for (const page of staticPages) {
    entries.push({
      url: localeUrl(page.path, "en-US"),
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: page.priority,
      alternates: alternates(page.path),
    });
  }

  // Published articles from content_localizations
  try {
    const sb = getServiceClient();
    const { data: items } = await sb
      .from("content_items")
      .select("id, updated_at, primary_pillar")
      .eq("workflow_status", "published");

    if (items) {
      for (const item of items) {
        const { data: locs } = await sb
          .from("content_localizations")
          .select("locale, slug")
          .eq("content_item_id", item.id);

        const enLoc = locs?.find((l) => l.locale === "en-US");
        if (!enLoc?.slug) continue;

        const pillar =
          normalizeResourceHubPillar(item.primary_pillar) ?? RESOURCE_HUB_PILLARS[0];
        const path = `/resources/${pillar}/${enLoc.slug}`;

        const languages: Record<string, string> = {};
        for (const loc of locs ?? []) {
          if (!loc.slug) continue;
          const tag = loc.locale.toLowerCase();
          const prefix = LOCALE_PREFIXES[loc.locale] ?? "";
          languages[tag] = `${BASE_URL}${prefix}/resources/${pillar}/${loc.slug}`;
        }

        entries.push({
          url: localeUrl(path, "en-US"),
          lastModified: item.updated_at ? new Date(item.updated_at) : new Date(),
          changeFrequency: "monthly",
          priority: 0.8,
          alternates: { languages },
        });
      }
    }
  } catch (err) {
    console.error("[sitemap] Failed to load content:", err);
  }

  return entries;
}
