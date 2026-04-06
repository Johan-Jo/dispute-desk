import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LOCALE_LIST } from "@/lib/i18n/locales";
import {
  marketingHomePath,
  pathLocaleToMessages,
  type PathLocale,
} from "@/lib/i18n/pathLocales";
import { getPublicBaseUrl, PRODUCTION_ORIGIN } from "@/lib/resources/url";

/** Shared metadata for the marketing homepage (`/` and localized `/de`, etc.). */
export async function buildMarketingHomeMetadata(
  pathLocale: PathLocale,
): Promise<Metadata> {
  const messagesLocale = pathLocaleToMessages[pathLocale];
  const t = await getTranslations({ locale: pathLocale, namespace: "marketing" });
  const title = t("seo.title");
  const description = t("seo.description");
  const keywords = t("seo.keywords")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  // Always use the canonical production origin for self-referential tags.
  // getPublicBaseUrl() now always returns a string (falls back to PRODUCTION_ORIGIN).
  const origin = getPublicBaseUrl();
  // For canonical tags use PRODUCTION_ORIGIN so preview deployments don't
  // accidentally claim a different canonical than the live site.
  const canonicalOrigin = PRODUCTION_ORIGIN;

  const canonicalPath = marketingHomePath(messagesLocale);
  const canonicalUrl = `${canonicalOrigin}${canonicalPath}`;

  const languageAlternates = Object.fromEntries(
    LOCALE_LIST.map((l) => [l, `${canonicalOrigin}${marketingHomePath(l)}`]),
  ) as Record<string, string>;
  languageAlternates["x-default"] = canonicalOrigin;

  return {
    metadataBase: new URL(origin),
    title,
    description,
    keywords,
    alternates: {
      canonical: canonicalUrl,
      languages: languageAlternates,
    },
    openGraph: {
      type: "website",
      title,
      description,
      siteName: "DisputeDesk",
      url: canonicalUrl,
      locale: messagesLocale,
      alternateLocale: LOCALE_LIST.filter((l) => l !== messagesLocale),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    robots: { index: true, follow: true },
  };
}
