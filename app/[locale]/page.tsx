import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { routing } from "@/i18n/routing";
import type { PathLocale } from "@/lib/i18n/pathLocales";
import { marketingHomePath, pathLocaleToMessages } from "@/lib/i18n/pathLocales";
import type { Locale } from "@/lib/i18n/locales";
import { buildMarketingHomeMetadata } from "@/lib/marketing/homeMetadata";
import { marketingHomeWebPageJsonLd } from "@/lib/marketing/jsonLd";
import { getPublicBaseUrl } from "@/lib/resources/url";
import { MarketingLandingPageClient } from "@/components/marketing/MarketingLandingPageClient";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({
  params,
}: Props): Promise<Metadata> {
  const { locale: localeParam } = await params;
  if (!hasLocale(routing.locales, localeParam)) {
    return {};
  }
  return buildMarketingHomeMetadata(localeParam as PathLocale);
}

export default async function MarketingHomePage({ params }: Props) {
  const { locale: localeParam } = await params;
  if (!hasLocale(routing.locales, localeParam)) {
    notFound();
  }
  const pathLocale = localeParam as PathLocale;
  setRequestLocale(pathLocale);

  const messagesLocale = pathLocaleToMessages[pathLocale];
  const origin = getPublicBaseUrl();
  const t = await getTranslations({ locale: pathLocale, namespace: "marketing" });
  const pageUrl = origin ? `${origin}${marketingHomePath(messagesLocale as Locale)}` : null;

  const webPageLd =
    pageUrl && origin
      ? marketingHomeWebPageJsonLd({
          url: pageUrl,
          name: t("seo.title"),
          description: t("seo.description"),
          inLanguage: messagesLocale,
          organizationId: `${origin}/#organization`,
          websiteId: `${pageUrl}#website`,
        })
      : null;

  return (
    <>
      {webPageLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageLd) }}
        />
      ) : null}
      <MarketingLandingPageClient />
    </>
  );
}
