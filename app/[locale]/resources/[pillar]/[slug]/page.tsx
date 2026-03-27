import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import type { PathLocale } from "@/lib/i18n/pathLocales";
import { pathLocaleToHubLocale } from "@/lib/resources/localeMap";
import { getPublishedLocalizationBySlug } from "@/lib/resources/queries";
import { getPublicBaseUrl } from "@/lib/resources/url";
import { MarketingSiteHeader } from "@/components/marketing/MarketingSiteHeader";
import { ResourceBreadcrumbs } from "@/components/resources/ResourceBreadcrumbs";
import { BodyBlocks } from "@/components/resources/BodyBlocks";
import { CtaBlock } from "@/components/resources/CtaBlock";
import {
  articleJsonLd,
  breadcrumbJsonLd,
  faqPageJsonLd,
} from "@/lib/resources/schema/jsonLd";
import { getServiceClient } from "@/lib/supabase/server";

type Props = {
  params: Promise<{ locale: string; pillar: string; slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: loc, pillar, slug } = await params;
  if (!hasLocale(routing.locales, loc)) return {};
  const hubLocale = pathLocaleToHubLocale(loc as PathLocale);
  const row = await getPublishedLocalizationBySlug({
    routeKind: "resources",
    locale: hubLocale,
    slug,
  });
  if (!row || row.item.primary_pillar !== pillar) {
    return { title: "Not found" };
  }
  const { localization: L } = row;
  const base = getPublicBaseUrl();
  const pathPrefix = loc === "en" ? "" : `/${loc}`;
  const path = `${pathPrefix}/resources/${pillar}/${slug}`;
  return {
    title: L.meta_title || L.title,
    description: L.meta_description || L.excerpt,
    openGraph: {
      title: L.og_title || L.meta_title || L.title,
      description: L.og_description || L.meta_description || L.excerpt,
      url: base ? `${base}${path}` : path,
    },
    alternates: base ? { canonical: `${base}${path}` } : undefined,
  };
}

export default async function ResourceArticlePage({ params }: Props) {
  const { locale: loc, pillar, slug } = await params;
  if (!hasLocale(routing.locales, loc)) notFound();
  setRequestLocale(loc);
  const pathLocale = loc as PathLocale;
  const hubLocale = pathLocaleToHubLocale(pathLocale);
  const t = await getTranslations({ locale: pathLocale, namespace: "resources" });

  const row = await getPublishedLocalizationBySlug({
    routeKind: "resources",
    locale: hubLocale,
    slug,
  });
  if (!row || row.item.primary_pillar !== pillar) notFound();

  const { item, localization: L } = row;
  const basePath = pathLocale === "en" ? "" : `/${pathLocale}`;
  const origin = getPublicBaseUrl();
  const path = `${basePath}/resources/${pillar}/${slug}`;

  let authorName: string | undefined;
  if (item.author_id) {
    const sb = getServiceClient();
    const { data: a } = await sb.from("authors").select("name").eq("id", item.author_id).maybeSingle();
    authorName = a?.name ?? undefined;
  }

  const faq = (L.body_json as { faq?: { q: string; a: string }[] })?.faq;
  const articleLd = articleJsonLd({
    headline: L.title,
    description: L.excerpt,
    url: origin ? `${origin}${path}` : path,
    locale: hubLocale,
    dateModified: L.last_updated_at ?? undefined,
    authorName,
  });

  const crumbs = breadcrumbJsonLd(
    origin
      ? [
          { name: t("breadcrumbHome"), url: `${origin}${basePath}/` },
          { name: t("breadcrumbResources"), url: `${origin}${basePath}/resources` },
          { name: L.title, url: `${origin}${path}` },
        ]
      : [
          { name: t("breadcrumbHome"), url: `${basePath}/` },
          { name: t("breadcrumbResources"), url: `${basePath}/resources` },
          { name: L.title, url: path },
        ]
  );

  return (
    <>
      <MarketingSiteHeader />
      <article className="max-w-[800px] mx-auto px-4 sm:px-8 py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }}
      />
      <ResourceBreadcrumbs
        items={[
          { label: t("breadcrumbHome"), href: `${basePath}/` },
          { label: t("breadcrumbResources"), href: `${basePath}/resources` },
          { label: L.title },
        ]}
      />
      <header className="mb-8">
        <p className="text-sm text-[#1D4ED8] font-medium mb-2">
          {t(`pillars.${pillar}` as never)}
        </p>
        <h1 className="text-3xl sm:text-4xl font-bold text-[#0B1220]">{L.title}</h1>
        <p className="text-lg text-[#64748B] mt-4">{L.excerpt}</p>
        <div className="flex flex-wrap gap-4 mt-4 text-sm text-[#94A3B8]">
          {L.reading_time_minutes != null && (
            <span>{t("readTime", { minutes: L.reading_time_minutes })}</span>
          )}
          {L.last_updated_at && (
            <span>
              {t("lastUpdated")}: {new Date(L.last_updated_at).toLocaleDateString()}
            </span>
          )}
          {authorName && (
            <span>
              {t("reviewedBy")}: {authorName}
            </span>
          )}
        </div>
      </header>

      <BodyBlocks body={(L.body_json as Record<string, unknown>) ?? {}} />

      {faq?.length ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(faqPageJsonLd(faq)),
          }}
        />
      ) : null}

      <div className="mt-10 flex flex-wrap gap-3">
        <CtaBlock
          label={t("ctaPrimary")}
          href="/portal/connect-shopify"
          locale={hubLocale}
          contentId={item.id}
        />
        <CtaBlock
          label={t("ctaDemo")}
          href="/portal/connect-shopify"
          variant="secondary"
          locale={hubLocale}
          contentId={item.id}
        />
      </div>
    </article>
    </>
  );
}
