import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LOCALE_LIST } from "@/lib/i18n/locales";
import { getMessages } from "@/lib/i18n/getMessages";
import { routing } from "@/i18n/routing";
import {
  PATH_LOCALE_LIST,
  type PathLocale,
  marketingHomePath,
  pathLocaleToMessages,
} from "@/lib/i18n/pathLocales";

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
  const pathLocale = localeParam as PathLocale;
  const messagesLocale = pathLocaleToMessages[pathLocale];

  const t = await getTranslations({ locale: pathLocale, namespace: "marketing" });
  const title = t("seo.title");
  const description = t("seo.description");
  const keywords = t("seo.keywords")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const origin = publicSiteOrigin();

  const languageAlternates = Object.fromEntries(
    LOCALE_LIST.map((l) => [l, marketingHomePath(l)])
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
    metadata.metadataBase = new URL(origin);
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
