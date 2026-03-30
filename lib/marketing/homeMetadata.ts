import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LOCALE_LIST } from "@/lib/i18n/locales";
import {
  marketingHomePath,
  pathLocaleToMessages,
  type PathLocale,
} from "@/lib/i18n/pathLocales";
import { getPublicBaseUrl } from "@/lib/resources/url";

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
  const origin = getPublicBaseUrl();

  const languageAlternates = Object.fromEntries(
    LOCALE_LIST.map((l) => [l, marketingHomePath(l)]),
  ) as Record<string, string>;
  languageAlternates["x-default"] = "/";

  const canonicalPath = marketingHomePath(messagesLocale);

  const metadata: Metadata = {
    title,
    description,
    keywords,
    openGraph: {
      type: "website",
      title,
      description,
      siteName: "DisputeDesk",
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

  if (origin) {
    metadata.alternates = {
      canonical: canonicalPath,
      languages: languageAlternates,
    };
    metadata.openGraph = {
      ...metadata.openGraph,
      url: canonicalPath,
    };
  }

  return metadata;
}
