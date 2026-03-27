import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Calendar, CheckCircle, Clock, Globe } from "lucide-react";
import { routing } from "@/i18n/routing";
import type { PathLocale } from "@/lib/i18n/pathLocales";
import { pathLocaleToHubLocale } from "@/lib/resources/localeMap";
import {
  getPublishedLocalizationBySlug,
  getRelatedResources,
} from "@/lib/resources/queries";
import { getPublicBaseUrl } from "@/lib/resources/url";
import { MarketingSiteHeader } from "@/components/marketing/MarketingSiteHeader";
import { ArticleStickyBar } from "@/components/resources/ArticleStickyBar";
import { ResourceBreadcrumbs } from "@/components/resources/ResourceBreadcrumbs";
import { BodyBlocks } from "@/components/resources/BodyBlocks";
import { CtaCard } from "@/components/resources/CtaBlock";
import { contentTypeBadgeClass } from "@/components/resources/resourcesHubStyles";
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

function AuthorAvatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="w-10 h-10 bg-gradient-to-br from-[#3B82F6] to-[#1D4ED8] rounded-full flex items-center justify-center">
      <span className="text-sm font-bold text-white">{initials}</span>
    </div>
  );
}

export default async function ResourceArticlePage({ params }: Props) {
  const { locale: loc, pillar, slug } = await params;
  if (!hasLocale(routing.locales, loc)) notFound();
  setRequestLocale(loc);
  const pathLocale = loc as PathLocale;
  const hubLocale = pathLocaleToHubLocale(pathLocale);
  const t = await getTranslations({
    locale: pathLocale,
    namespace: "resources",
  });

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
  let authorRole: string | undefined;
  if (item.author_id) {
    const sb = getServiceClient();
    const { data: a } = await sb
      .from("authors")
      .select("name, role")
      .eq("id", item.author_id)
      .maybeSingle();
    authorName = a?.name ?? undefined;
    authorRole = a?.role ?? undefined;
  }

  const related = await getRelatedResources({
    routeKind: "resources",
    locale: hubLocale,
    pillar,
    excludeItemId: item.id,
    limit: 2,
  });

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
          {
            name: t("breadcrumbResources"),
            url: `${origin}${basePath}/resources`,
          },
          { name: L.title, url: `${origin}${path}` },
        ]
      : [
          { name: t("breadcrumbHome"), url: `${basePath}/` },
          { name: t("breadcrumbResources"), url: `${basePath}/resources` },
          { name: L.title, url: path },
        ]
  );

  const contentTypeLabel = t(
    `types.${item.content_type}` as never
  ) as string;

  const localeName =
    {
      "en-US": "English",
      "de-DE": "Deutsch",
      "fr-FR": "Français",
      "es-ES": "Español",
      "pt-PT": "Português",
      "sv-SE": "Svenska",
    }[hubLocale] ?? hubLocale;

  const showAuthorRole =
    authorRole &&
    authorName &&
    !authorName.toLowerCase().trim().endsWith(authorRole.toLowerCase().trim());

  return (
    <div className="min-h-screen bg-[#F6F8FB]">
      <MarketingSiteHeader />
      <ArticleStickyBar />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }}
      />

      <article className="max-w-[840px] mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <ResourceBreadcrumbs
          items={[
            { label: t("breadcrumbHome"), href: `${basePath}/` },
            {
              label: t("breadcrumbResources"),
              href: `${basePath}/resources`,
            },
            { label: L.title },
          ]}
        />

        {/* Article Header */}
        <div className="mb-12">
          <div
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium mb-6 border ${contentTypeBadgeClass(item.content_type)}`}
          >
            <CheckCircle className="w-3.5 h-3.5" />
            {contentTypeLabel}
          </div>

          <h1 className="text-4xl sm:text-5xl font-bold text-[#0B1220] mb-6 leading-tight">
            {L.title}
          </h1>

          <p className="text-xl text-[#64748B] mb-8 leading-relaxed">
            {L.excerpt}
          </p>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-6 pb-8 border-b border-[#E5E7EB]">
            {authorName && (
              <div className="flex items-center gap-2">
                <AuthorAvatar name={authorName} />
                <div>
                  <p className="text-sm font-medium text-[#0B1220]">
                    {authorName}
                  </p>
                  {showAuthorRole && (
                    <p className="text-xs text-[#64748B]">{authorRole}</p>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center gap-4 text-sm text-[#64748B]">
              {L.last_updated_at && (
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4" />
                  {new Date(L.last_updated_at).toLocaleDateString(hubLocale, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </div>
              )}
              {L.reading_time_minutes != null && (
                <div className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4" />
                  {t("readTime", { minutes: L.reading_time_minutes })}
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <Globe className="w-4 h-4" />
                {localeName}
              </div>
            </div>
          </div>
        </div>

        {/* Article Body */}
        <BodyBlocks
          body={(L.body_json as Record<string, unknown>) ?? {}}
          takeawaysLabel={t("keyTakeaways")}
        />

        {faq?.length ? (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify(faqPageJsonLd(faq)),
            }}
          />
        ) : null}

        {/* CTA Card */}
        <CtaCard
          title={t("ctaCardTitle")}
          body={t("ctaCardBody")}
          primaryLabel={t("ctaStartTrial")}
          primaryHref="/portal/connect-shopify"
          secondaryLabel={t("ctaLearnMore")}
          secondaryHref="/"
          locale={hubLocale}
          contentId={item.id}
        />

        {/* Related Resources */}
        {related.length > 0 && (
          <div className="mt-16 pt-8 border-t border-[#E5E7EB]">
            <h3 className="text-xl font-bold text-[#0B1220] mb-6">
              {t("relatedResources")}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {related.map((r) => (
                <Link
                  key={r.id}
                  href={`${basePath}/resources/${r.content_items.primary_pillar}/${r.slug}`}
                  className="bg-white border border-[#E5E7EB] rounded-lg p-6 hover:border-[#1D4ED8] transition-all block"
                >
                  <div className="text-xs font-medium text-[#64748B] mb-2">
                    {t(`types.${r.content_items.content_type}` as never)}
                  </div>
                  <h4 className="font-bold text-[#0B1220] mb-2">{r.title}</h4>
                  {r.reading_time_minutes != null && (
                    <div className="flex items-center gap-2 text-sm text-[#64748B]">
                      <Clock className="w-3.5 h-3.5" />
                      {t("readTime", { minutes: r.reading_time_minutes })}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}
      </article>
    </div>
  );
}
