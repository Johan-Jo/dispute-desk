import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { Calendar, CheckCircle, Clock, Globe } from "lucide-react";
import { routing } from "@/i18n/routing";
import type { PathLocale } from "@/lib/i18n/pathLocales";
import { marketingHomePath } from "@/lib/i18n/pathLocales";
import { hubLocaleToPathSegment, pathLocaleToHubLocale } from "@/lib/resources/localeMap";
import {
  getPublishedLocalizationBySlug,
  findLocalizationBySlugAnyLocale,
  getSiblingLocaleUrls,
  listPublishedByRoute,
} from "@/lib/resources/queries";
import { getPublicBaseUrl } from "@/lib/resources/url";
import { getServiceClient } from "@/lib/supabase/server";
import { getMarketingShopifyAppInstallUrl } from "@/lib/marketing/shopifyInstallUrl";
import { MarketingSiteHeader } from "@/components/marketing/MarketingSiteHeader";
import { ArticleStickyBar } from "@/components/resources/ArticleStickyBar";
import { ResourceBreadcrumbs } from "@/components/resources/ResourceBreadcrumbs";
import { BodyBlocks } from "@/components/resources/BodyBlocks";
import { CtaCard } from "@/components/resources/CtaBlock";
import { contentTypeBadgeClass } from "@/components/resources/resourcesHubStyles";

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: loc, slug } = await params;
  if (!hasLocale(routing.locales, loc)) return {};
  const hubLocale = pathLocaleToHubLocale(loc as PathLocale);
  const row = await getPublishedLocalizationBySlug({
    routeKind: "templates",
    locale: hubLocale,
    slug,
  });
  if (!row) return { title: "Not found" };
  const { localization: L } = row;
  const base = getPublicBaseUrl();
  const pathPrefix = loc === "en" ? "" : `/${loc}`;
  const path = `${pathPrefix}/templates/${slug}`;

  const languages = base
    ? await getSiblingLocaleUrls({
        contentItemId: row.item.id,
        routeKind: "templates",
        baseUrl: base,
        buildPath: (siblingLocale, siblingSlug) => {
          const seg = hubLocaleToPathSegment(siblingLocale);
          const prefix = seg === "en" ? "" : `/${seg}`;
          return `${prefix}/templates/${siblingSlug}`;
        },
      })
    : {};

  return {
    title: L.meta_title || L.title,
    description: L.meta_description || L.excerpt,
    alternates: base
      ? {
          canonical: `${base}${path}`,
          ...(Object.keys(languages).length > 0 ? { languages } : {}),
        }
      : undefined,
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

export default async function TemplateDetailPage({ params }: Props) {
  const { locale: loc, slug } = await params;
  if (!hasLocale(routing.locales, loc)) notFound();
  setRequestLocale(loc);
  const pathLocale = loc as PathLocale;
  const hubLocale = pathLocaleToHubLocale(pathLocale);
  const t = await getTranslations({ locale: pathLocale, namespace: "resources" });
  const basePath = pathLocale === "en" ? "" : `/${pathLocale}`;

  const row = await getPublishedLocalizationBySlug({
    routeKind: "templates",
    locale: hubLocale,
    slug,
  });
  if (!row) {
    const match = await findLocalizationBySlugAnyLocale({ slug });
    if (match) {
      const sb = getServiceClient();
      const { data: targetLoc } = await sb
        .from("content_localizations")
        .select("slug")
        .eq("content_item_id", match.contentItemId)
        .eq("locale", hubLocale)
        .eq("route_kind", match.routeKind)
        .eq("is_published", true)
        .maybeSingle();
      if (targetLoc?.slug) {
        const routePath = match.routeKind === "resources"
          ? `/resources/${match.pillar}/${targetLoc.slug}`
          : `/${match.routeKind}/${targetLoc.slug}`;
        permanentRedirect(`${basePath}${routePath}`);
      }
    }
    notFound();
  }
  const { item, localization: L } = row;

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

  // Related templates: sibling templates in the same locale, excluding this one.
  // Templates have no pillar, so we pull the published list rather than the
  // pillar-scoped getRelatedResources().
  let related: Awaited<ReturnType<typeof listPublishedByRoute>>["rows"] = [];
  try {
    const r = await listPublishedByRoute("templates", hubLocale, {
      limit: 7,
      includeTotal: false,
    });
    related = r.rows.filter((x) => x.content_item_id !== item.id).slice(0, 3);
  } catch {
    related = [];
  }

  const contentTypeLabel = t("types.template");
  const localeName =
    {
      "en-US": "English",
      "de-DE": "Deutsch",
      "fr-FR": "Français",
      "es-ES": "Español",
      "pt-BR": "Português",
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

      <article className="max-w-[840px] mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <ResourceBreadcrumbs
          items={[
            { label: t("breadcrumbHome"), href: `${basePath}/` },
            { label: t("types.template"), href: `${basePath}/templates` },
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
          disclaimerLabel={t("disclaimerLabel")}
          disclaimerText={t("disclaimerText")}
          updatesLabel={t("updatesLabel")}
        />

        {/* CTA Card */}
        <CtaCard
          title={t("ctaCardTitle")}
          body={t("ctaCardBody")}
          ctaLabel={t("ctaDownloadAppTryFree")}
          ctaHref={getMarketingShopifyAppInstallUrl()}
          secondaryCtaLabel={t("ctaSeePlans")}
          secondaryCtaHref={`${marketingHomePath(hubLocaleToPathSegment(hubLocale))}#pricing`}
          locale={hubLocale}
          contentId={item.id}
        />

        {/* Related Templates */}
        {related.length > 0 && (
          <div className="mt-16 pt-8 border-t border-[#E5E7EB]">
            <h3 className="text-xl font-bold text-[#0B1220] mb-6">
              {t("relatedTemplates")}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {related.map((r) => (
                <Link
                  key={r.id}
                  href={`${basePath}/templates/${r.slug}`}
                  className="bg-white border border-[#E5E7EB] rounded-xl p-5 hover:border-[#0066FF] transition-all block"
                >
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium mb-3 border bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]">
                    {t("types.template")}
                  </div>
                  <h4 className="font-bold text-[#0B1220] mb-2 line-clamp-2">{r.title}</h4>
                  {"reading_time_minutes" in r && r.reading_time_minutes != null && (
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
