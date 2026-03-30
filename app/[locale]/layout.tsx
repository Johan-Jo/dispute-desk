import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getMessages } from "@/lib/i18n/getMessages";
import { routing } from "@/i18n/routing";
import {
  PATH_LOCALE_LIST,
  type PathLocale,
  marketingHomePath,
  pathLocaleToMessages,
} from "@/lib/i18n/pathLocales";
import { buildMarketingHomeMetadata } from "@/lib/marketing/homeMetadata";

export function generateStaticParams() {
  return PATH_LOCALE_LIST.map((locale) => ({ locale }));
}

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: localeParam } = await params;
  if (!hasLocale(routing.locales, localeParam)) {
    return {};
  }
  return buildMarketingHomeMetadata(localeParam as PathLocale);
}

function publicSiteOrigin(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_APP_URL ?? process.env.SHOPIFY_APP_URL;
  if (raw) {
    try {
      const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
      return u.origin;
    } catch {
      /* ignore */
    }
  }
  if (process.env.VERCEL_URL) {
    try {
      return new URL(`https://${process.env.VERCEL_URL}`).origin;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

async function MarketingJsonLd({ pathLocale }: { pathLocale: PathLocale }) {
  const origin = publicSiteOrigin();
  if (!origin) return null;

  const messagesLocale = pathLocaleToMessages[pathLocale];
  const t = await getTranslations({ locale: pathLocale, namespace: "marketing" });
  const description = t("seo.jsonLdDescription");
  const pageUrl = `${origin}${marketingHomePath(messagesLocale)}`;
  const payload = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${origin}/#organization`,
        name: "DisputeDesk",
        url: origin,
        description,
      },
      {
        "@type": "WebSite",
        "@id": `${pageUrl}#website`,
        name: "DisputeDesk",
        url: pageUrl,
        description,
        inLanguage: messagesLocale,
        publisher: { "@id": `${origin}/#organization` },
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }}
    />
  );
}

export default async function LocaleMarketingLayout({
  children,
  params,
}: LayoutProps) {
  const { locale: localeParam } = await params;
  if (!hasLocale(routing.locales, localeParam)) {
    notFound();
  }
  const pathLocale = localeParam as PathLocale;
  setRequestLocale(pathLocale);

  const messages = await getMessages(pathLocaleToMessages[pathLocale]);

  return (
    <NextIntlClientProvider locale={pathLocale} messages={messages} timeZone="UTC">
      <MarketingJsonLd pathLocale={pathLocale} />
      {children}
    </NextIntlClientProvider>
  );
}
