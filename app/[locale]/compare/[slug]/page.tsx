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
import { breadcrumbJsonLd, faqPageJsonLd } from "@/lib/resources/schema/jsonLd";
import { CompareLandingClient } from "@/components/marketing/CompareLandingClient";
import {
  COMPETITORS,
  getCompetitorBySlug,
} from "@/lib/compare/competitors";

type Props = { params: Promise<{ locale: string; slug: string }> };

/** All competitor slugs (the `[locale]` axis is expanded by the layout). */
export function generateStaticParams() {
  return COMPETITORS.map((c) => ({ slug: c.slug }));
}

function basePrefix(locale: PathLocale): string {
  return locale === "en" ? "" : `/${locale}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: localeParam, slug } = await params;
  if (!hasLocale(routing.locales, localeParam)) return {};
  const competitor = getCompetitorBySlug(slug);
  if (!competitor) return {};

  const pathLocale = localeParam as PathLocale;
  const messagesLocale = pathLocaleToMessages[pathLocale];
  const t = await getTranslations({ locale: pathLocale, namespace: "compare" });
  const name = t(`competitors.${competitor.id}.name`);
  const title = t("page.metaTitle", { name });
  const description = t("page.metaDescription", { name });

  const origin = getPublicBaseUrl();
  const canonical = `${origin}${basePrefix(pathLocale)}/compare/${slug}`;
  const languages: Record<string, string> = {};
  for (const l of PATH_LOCALE_LIST) {
    languages[l] = `${origin}${basePrefix(l)}/compare/${slug}`;
  }
  languages["x-default"] = `${origin}/compare/${slug}`;

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
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og/disputedesk-og.png"],
    },
    robots: { index: true, follow: true },
  };
}

export default async function CompareCompetitorPage({ params }: Props) {
  const { locale: localeParam, slug } = await params;
  if (!hasLocale(routing.locales, localeParam)) notFound();
  const competitor = getCompetitorBySlug(slug);
  if (!competitor) notFound();

  const pathLocale = localeParam as PathLocale;
  setRequestLocale(pathLocale);

  const t = await getTranslations({ locale: pathLocale, namespace: "compare" });
  const name = t(`competitors.${competitor.id}.name`);
  const origin = getPublicBaseUrl();
  const base = basePrefix(pathLocale);
  const pageUrl = `${origin}${base}/compare/${slug}`;

  const faqLd = faqPageJsonLd(
    [0, 1, 2, 3, 4].map((i) => ({
      q: t(`page.faqs.${i}.q`, { name }),
      a: t(`page.faqs.${i}.a`, { name }),
    }))
  );
  const crumbsLd = breadcrumbJsonLd([
    { name: "DisputeDesk", url: `${origin}${base || "/"}` },
    { name: t("hub.title"), url: `${origin}${base}/compare` },
    { name: t("page.heroTitle", { name }), url: pageUrl },
  ]);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbsLd) }} />
      <CompareLandingClient base={base} competitorId={competitor.id} />
    </>
  );
}
