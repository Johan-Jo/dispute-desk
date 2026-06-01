import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LOCALE_LIST } from "@/lib/i18n/locales";
import {
  marketingHomePath,
  pathLocaleToMessages,
  type PathLocale,
} from "@/lib/i18n/pathLocales";
import { getPublicBaseUrl, PRODUCTION_ORIGIN } from "@/lib/resources/url";

/**
 * Build a per-locale `/playbook` URL. `marketingHomePath` already returns
 * "/" for English and "/<locale>" otherwise; appending the sub-path keeps the
 * default-locale URL unprefixed (`/playbook`) and others prefixed
 * (`/de/playbook`).
 */
function playbookPath(messagesLocale: (typeof LOCALE_LIST)[number], sub = ""): string {
  const home = marketingHomePath(messagesLocale); // "/" or "/de"
  const base = home === "/" ? "" : home;
  return `${base}/playbook${sub}`;
}

/** Metadata for the lead-capture landing page (`/playbook`). */
export async function buildPlaybookMetadata(
  pathLocale: PathLocale,
): Promise<Metadata> {
  const messagesLocale = pathLocaleToMessages[pathLocale];
  const t = await getTranslations({ locale: pathLocale, namespace: "playbook" });
  const title = t("seo.title");
  const description = t("seo.description");

  const origin = getPublicBaseUrl();
  const canonicalOrigin = PRODUCTION_ORIGIN;
  const canonicalUrl = `${canonicalOrigin}${playbookPath(messagesLocale)}`;

  const languageAlternates = Object.fromEntries(
    LOCALE_LIST.map((l) => [l, `${canonicalOrigin}${playbookPath(l)}`]),
  ) as Record<string, string>;
  languageAlternates["x-default"] = `${canonicalOrigin}/playbook`;

  return {
    metadataBase: new URL(origin),
    title,
    description,
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
    twitter: { card: "summary_large_image", title, description },
    robots: { index: true, follow: true },
  };
}

/**
 * Metadata for the Playbook web reader (`/playbook/read`). The reader is
 * English-only content but still indexable; canonical points at the unprefixed
 * URL and we don't advertise locale alternates (there are none).
 */
export async function buildPlaybookReaderMetadata(
  pathLocale: PathLocale,
): Promise<Metadata> {
  const messagesLocale = pathLocaleToMessages[pathLocale];
  const origin = getPublicBaseUrl();
  const canonicalUrl = `${PRODUCTION_ORIGIN}/playbook/read`;
  const title = "The Liability-Shift Playbook · DisputeDesk";
  const description =
    "The full field guide: which Shopify chargebacks are liability-shift eligible under Visa CE 3.0 and Mastercard First-Party Trust, plus the five-minute eligibility test.";

  return {
    metadataBase: new URL(origin),
    title,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      type: "article",
      title,
      description,
      siteName: "DisputeDesk",
      url: canonicalUrl,
      locale: messagesLocale,
    },
    twitter: { card: "summary_large_image", title, description },
    robots: { index: true, follow: true },
  };
}
