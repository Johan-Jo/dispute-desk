import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import {
  PATH_LOCALE_LIST,
  pathLocaleToMessages,
  type PathLocale,
} from "@/lib/i18n/pathLocales";
import { getPublicBaseUrl } from "@/lib/resources/url";
import { resourcesHubCollectionJsonLd } from "@/lib/resources/schema/jsonLd";
import { CompareHubClient } from "@/components/marketing/CompareHubClient";
import { COMPETITORS } from "@/lib/compare/competitors";

type Props = { params: Promise<{ locale: string }> };

function basePrefix(locale: PathLocale): string {
  return locale === "en" ? "" : `/${locale}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: localeParam } = await params;
  if (!hasLocale(routing.locales, localeParam)) return {};
  const pathLocale = localeParam as PathLocale;
  const messagesLocale = pathLocaleToMessages[pathLocale];
  const t = await getTranslations({ locale: pathLocale, namespace: "compare" });
  const title = t("hub.seoTitle");
  const description = t("hub.seoDescription");

  const origin = getPublicBaseUrl();
  const canonical = `${origin}${basePrefix(pathLocale)}/compare`;
  const languages: Record<string, string> = {};
  for (const l of PATH_LOCALE_LIST) {
    languages[l] = `${origin}${basePrefix(l)}/compare`;
  }
  languages["x-default"] = `${origin}/compare`;

  return {
    title,
    description,
    alternates: { canonical, languages },
    openGraph: {
      type: "website",
      title,
      description,
      siteName: "DisputeDesk",
      url: canonical,
      locale: messagesLocale,
      images: [{ url: "/og/disputedesk-og.png", width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", title, description, images: ["/og/disputedesk-og.png"] },
    robots: { index: true, follow: true },
  };
}

export default async function CompareHubPage({ params }: Props) {
  const { locale: localeParam } = await params;
  if (!hasLocale(routing.locales, localeParam)) notFound();
  const pathLocale = localeParam as PathLocale;
  setRequestLocale(pathLocale);

  const messagesLocale = pathLocaleToMessages[pathLocale];
  const t = await getTranslations({ locale: pathLocale, namespace: "compare" });
  const origin = getPublicBaseUrl();
  const base = basePrefix(pathLocale);
  const pageUrl = `${origin}${base}/compare`;

  const collectionLd = resourcesHubCollectionJsonLd({
    pageUrl,
    siteHomeUrl: `${origin}${base || "/"}`,
    name: t("hub.seoTitle"),
    description: t("hub.seoDescription"),
    inLanguage: messagesLocale,
    items: COMPETITORS.map((c) => ({
      name: t(`competitors.${c.id}.name`),
      url: `${origin}${base}/compare/${c.slug}`,
    })),
  });

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionLd) }} />
      <CompareHubClient base={base} />
    </>
  );
}
