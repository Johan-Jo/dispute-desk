import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  ArrowRight,
  Calendar,
  Clock,
  Search as SearchIcon,
  Star,
} from "lucide-react";
import type { PathLocale } from "@/lib/i18n/pathLocales";
import { pathLocaleToMessages } from "@/lib/i18n/pathLocales";
import type { ContentLocalizationRow, ContentItemRow } from "@/lib/resources/queries";
import { MarketingSiteHeader } from "@/components/marketing/MarketingSiteHeader";
import { MarketingSiteFooter } from "@/components/marketing/MarketingSiteFooter";
import { contentTypeBadgeClass } from "@/components/resources/resourcesHubStyles";
import { ResourcesFilterBar } from "@/components/resources/ResourcesFilterBar";
import { MARKETING_PAGE_CONTAINER_CLASS } from "@/lib/marketing/pageContainer";
import { RESOURCES_HUB } from "@/lib/marketing/resourcesHubTokens";
import { ResourceCardImage } from "@/components/resources/ResourceCardImage";
import { getMarketingShopifyAppInstallUrl } from "@/lib/marketing/shopifyInstallUrl";

type Row = ContentLocalizationRow & { content_items: ContentItemRow };

const STICKY_PILLARS = [
  "chargebacks",
  "dispute-resolution",
  "small-claims",
  "mediation-arbitration",
  "dispute-management-software",
] as const;

const FILTER_LABEL_KEYS = [
  "typeAll",
  "types.cluster_article",
  "types.template",
  "types.case_study",
  "types.legal_update",
  "types.pillar_page",
  "types.checklist",
  "types.glossary_entry",
  "types.faq_entry",
  "moreFilters",
  "clearFilters",
  "additionalTypes",
] as const;

const HUB_CONTAINER = MARKETING_PAGE_CONTAINER_CLASS;

const lime = RESOURCES_HUB.limeAccent;
const blue = RESOURCES_HUB.actionBlue;

function buildHref(
  base: string,
  next: { q?: string; pillar?: string; type?: string; page?: number },
) {
  const p = new URLSearchParams();
  if (next.q) p.set("q", next.q);
  if (next.pillar) p.set("pillar", next.pillar);
  if (next.type) p.set("type", next.type);
  if (next.page != null && next.page > 1) p.set("page", String(next.page));
  const qs = p.toString();
  return `${base}/resources${qs ? `?${qs}` : ""}`;
}

function formatDate(iso: string | null | undefined, pathLocale: PathLocale) {
  if (!iso) return "—";
  const d = new Date(iso);
  const loc = pathLocaleToMessages[pathLocale];
  return d.toLocaleDateString(loc, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type Props = {
  base: string;
  pathLocale: PathLocale;
  pillar?: string;
  contentType?: string;
  search?: string;
  /** Current hub index page (1-based). */
  page: number;
  totalPages: number;
  /** Total published items matching current filters (all pages). */
  totalItems: number;
  rows: Row[];
  /** Published article counts per `primary_pillar` for the sticky topic row. */
  pillarCounts: Record<string, number>;
};

export async function ResourcesHubShell({
  base,
  pathLocale,
  pillar,
  contentType,
  search,
  page,
  totalPages,
  totalItems,
  rows,
  pillarCounts,
}: Props) {
  const t = await getTranslations({ locale: pathLocale, namespace: "resources" });
  const isFiltered = !!(pillar || contentType || search);
  const totalPublished = Object.values(pillarCounts).reduce((a, n) => a + n, 0);

  const featuredItems =
    !isFiltered && page === 1 && rows.length > 0 ? rows.slice(0, 2) : [];
  const gridRows =
    isFiltered
      ? rows
      : page === 1 && rows.length > 2
        ? rows.slice(2)
        : page === 1 && rows.length <= 2
          ? []
          : page > 1
            ? rows
            : [];

  const filterLabels: Record<string, string> = {};
  for (const key of FILTER_LABEL_KEYS) {
    filterLabels[key] = t(key as never);
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: RESOURCES_HUB.pageBg }}>
      <MarketingSiteHeader />

      {/* Hero — Figma Make marketing shell (same gradient + blobs as home `MarketingLandingPageClient`) */}
      <section
        className="relative text-white overflow-hidden pt-10 pb-10 md:pt-14 md:pb-12"
        style={{
          background:
            "linear-gradient(135deg, var(--dd-hero-bg-start) 0%, var(--dd-hero-bg-mid) 40%, var(--dd-hero-bg-end) 100%)",
        }}
      >
        <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
          <div
            className="absolute top-20 left-4 sm:left-10 w-72 sm:w-96 h-72 sm:h-96 rounded-full mix-blend-screen filter blur-3xl opacity-[0.15] dd-hero-blob"
            style={{ backgroundColor: "var(--dd-hero-blob-a)" }}
          />
          <div
            className="absolute top-40 right-4 sm:right-10 w-72 sm:w-96 h-72 sm:h-96 rounded-full mix-blend-screen filter blur-3xl opacity-[0.12] dd-hero-blob dd-hero-blob-delay-2s"
            style={{ backgroundColor: "var(--dd-hero-blob-b)" }}
          />
          <div
            className="absolute -bottom-8 left-1/2 -translate-x-1/2 w-72 sm:w-96 h-72 sm:h-96 rounded-full mix-blend-screen filter blur-3xl opacity-[0.1] dd-hero-blob dd-hero-blob-delay-4s"
            style={{ backgroundColor: "var(--dd-hero-blob-c)" }}
          />
        </div>

        <div className={`${HUB_CONTAINER} relative z-10`}>
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 mb-4 backdrop-blur-sm">
              <Star className="h-4 w-4 shrink-0 text-[#22C55E]" aria-hidden fill="#22C55E" />
              <span className="text-sm font-medium text-white/95">{t("hubBadge")}</span>
            </div>
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4 tracking-tight leading-tight bg-gradient-to-r from-[var(--dd-hero-gradient-from)] via-[var(--dd-hero-gradient-via)] to-[var(--dd-hero-gradient-to)] bg-clip-text text-transparent">
              {t("heroTitle")}
            </h1>
            <p className="text-lg text-slate-300 mb-8 leading-relaxed">{t("heroSubtitle")}</p>

            <form
              action={`${base}/resources`}
              method="get"
              className="relative max-w-3xl flex flex-col sm:flex-row gap-3 sm:items-stretch"
            >
              <div className="relative flex-1 min-w-0">
                <SearchIcon
                  className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none z-10"
                  aria-hidden
                />
                {pillar ? <input type="hidden" name="pillar" value={pillar} /> : null}
                {contentType ? <input type="hidden" name="type" value={contentType} /> : null}
                <input
                  name="q"
                  defaultValue={search ?? ""}
                  type="search"
                  placeholder={t("searchPlaceholder")}
                  className="w-full pl-12 pr-4 py-3.5 sm:py-4 rounded-full bg-white border border-gray-200 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/40 text-gray-900 placeholder-gray-400"
                  aria-label={t("searchPlaceholder")}
                />
              </div>
              <button
                type="submit"
                className="px-6 py-3.5 sm:py-4 rounded-full font-medium shrink-0 text-white shadow-md transition-[filter] hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-white/50"
                style={{ backgroundColor: blue, boxShadow: "0 1px 2px rgba(0, 0, 0, 0.15)" }}
              >
                {t("searchButton")}
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* Spacer between hero and sticky bar on paginated / filtered pages (no featured section) */}
      {featuredItems.length === 0 && <div className="h-6" />}

      {/* Sticky topic row + counts */}
      <div className="sticky z-40 border-b border-gray-200 bg-white top-16 shadow-sm">
        <div className={`${HUB_CONTAINER} py-4`}>
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
            <Link
              href={buildHref(base, { q: search, type: contentType })}
              className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors flex items-center gap-2 shrink-0 ${
                !pillar ? "text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
              style={!pillar ? { backgroundColor: blue } : undefined}
            >
              <span>{t("allArticles")}</span>
              <span
                className={`text-xs px-1.5 py-0.5 rounded ${
                  !pillar ? "bg-white/20" : "bg-gray-200"
                }`}
              >
                {totalPublished}
              </span>
            </Link>
            {STICKY_PILLARS.map((pid) => {
              const active = pillar === pid;
              const count = pillarCounts[pid] ?? 0;
              const href = active
                ? buildHref(base, { q: search, type: contentType })
                : buildHref(base, { q: search, pillar: pid, type: contentType });
              return (
                <Link
                  key={pid}
                  href={href}
                  className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors flex items-center gap-2 shrink-0 ${
                    active ? "text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                  style={active ? { backgroundColor: blue } : undefined}
                >
                  <span>{t(`pillars.${pid}` as never)}</span>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded ${
                      active ? "bg-white/20" : "bg-gray-200"
                    }`}
                  >
                    {count}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {featuredItems.length > 0 && (
        <div className={`${HUB_CONTAINER} py-12`}>
          <div className="flex items-center gap-2 mb-6">
            <div className="h-8 w-1 rounded-full" style={{ backgroundColor: lime }} />
            <h2 className="text-2xl font-bold text-gray-900">{t("featuredLabel")}</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {featuredItems.map((featured) => (
              <Link
                key={featured.id}
                href={`${base}/resources/${featured.content_items.primary_pillar}/${featured.slug}`}
                className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all group border border-gray-200 text-left w-full block"
              >
                <div className="relative">
                  <ResourceCardImage
                    url={featured.content_items.featured_image_url}
                    alt={
                      featured.content_items.featured_image_alt ??
                      featured.title
                    }
                    variant="featured"
                  />
                  <div className="absolute top-4 left-4">
                    <span
                      className="px-3 py-1.5 rounded-full text-xs font-bold text-black"
                      style={{ backgroundColor: lime }}
                    >
                      {t("featuredBadge")}
                    </span>
                  </div>
                </div>
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-3 text-sm text-gray-600 flex-wrap">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs border ${contentTypeBadgeClass(featured.content_items.content_type)}`}
                    >
                      {t(`types.${featured.content_items.content_type}` as never)}
                    </span>
                    {featured.reading_time_minutes != null && (
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="h-4 w-4 shrink-0" aria-hidden />
                        {t("readTime", { minutes: featured.reading_time_minutes })}
                      </span>
                    )}
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2 line-clamp-2 group-hover:text-[#1D4ED8] transition-colors">
                    {featured.title}
                  </h3>
                  <p className="text-gray-600 text-sm mb-4 line-clamp-3">{featured.excerpt}</p>
                  <div
                    className="flex items-center gap-2 font-semibold text-sm group-hover:gap-3 transition-all"
                    style={{ color: blue }}
                  >
                    {t("readArticle")}
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className={`${HUB_CONTAINER} py-12 ${featuredItems.length > 0 ? "pt-0" : ""}`}>
          <div className="flex items-center gap-2 mb-6">
            <div className="h-8 w-1 rounded-full" style={{ backgroundColor: blue }} />
            <h2 className="text-2xl font-bold text-gray-900">{t("latestHeading")}</h2>
          </div>

          <ResourcesFilterBar
            base={base}
            pathLocale={pathLocale}
            pillar={pillar}
            contentType={contentType}
            search={search}
            isFiltered={isFiltered}
            labels={filterLabels}
          />

          <p className="text-sm mb-6 text-gray-600">
            {isFiltered ? (
              t("resultsCountTotal", { count: gridRows.length, total: totalItems })
            ) : (
              t("listingMeta", {
                page,
                totalPages,
                total: totalItems,
                onPage: gridRows.length,
              })
            )}
          </p>

          {totalItems === 0 ? (
            <div className="text-center py-16 rounded-xl border border-gray-200 bg-white">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <SearchIcon className="w-8 h-8 text-gray-400" aria-hidden />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">{t("emptyTitle")}</h3>
              <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">{t("emptyHint")}</p>
              <Link
                href={`${base}/resources`}
                className="inline-block px-6 py-2.5 text-white rounded-lg text-sm font-medium transition-colors"
                style={{ backgroundColor: blue }}
              >
                {t("clearFilters")}
              </Link>
            </div>
          ) : gridRows.length === 0 && !isFiltered ? (
            <p className="text-sm text-gray-500">{t("noMoreArticles")}</p>
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
              {gridRows.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`${base}/resources/${row.content_items.primary_pillar}/${row.slug}`}
                    className="block h-full bg-white rounded-2xl overflow-hidden border border-gray-200 hover:shadow-lg transition-all group text-left"
                  >
                    <ResourceCardImage
                      url={row.content_items.featured_image_url}
                      alt={row.content_items.featured_image_alt ?? row.title}
                      variant="default"
                    />
                    <div className="p-6">
                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium mb-4 border ${contentTypeBadgeClass(row.content_items.content_type)}`}
                      >
                        {t(`types.${row.content_items.content_type}` as never)}
                      </span>
                      <h3 className="text-lg font-bold text-gray-900 mb-3 group-hover:text-[#1D4ED8] transition-colors leading-snug line-clamp-2">
                        {row.title}
                      </h3>
                      <p className="text-sm text-gray-600 mb-4 leading-relaxed line-clamp-3">
                        {row.excerpt}
                      </p>
                      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                        {row.reading_time_minutes != null && (
                          <span className="inline-flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" aria-hidden />
                            {t("readTime", { minutes: row.reading_time_minutes })}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5" aria-hidden />
                          {formatDate(row.last_updated_at ?? row.publish_at, pathLocale)}
                        </span>
                      </div>
                      <span
                        className="mt-4 inline-flex items-center gap-1 text-sm font-semibold group-hover:gap-2 transition-all"
                        style={{ color: blue }}
                      >
                        {t("readMore")}
                        <ArrowRight className="w-4 h-4" aria-hidden />
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {totalPages > 1 ? (
            <nav
              className="flex flex-wrap items-center justify-center gap-4 mb-12"
              aria-label={t("paginationNav")}
            >
              {page > 1 ? (
                <Link
                  href={buildHref(base, {
                    q: search,
                    pillar,
                    type: contentType,
                    page: page - 1,
                  })}
                  className="inline-flex items-center px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-800 hover:bg-gray-50"
                >
                  {t("paginationPrev")}
                </Link>
              ) : (
                <span className="inline-flex items-center px-4 py-2 rounded-lg border border-gray-100 bg-gray-50 text-sm text-gray-400 cursor-not-allowed">
                  {t("paginationPrev")}
                </span>
              )}
              <span className="text-sm text-gray-600 tabular-nums">
                {t("paginationStatus", { page, totalPages })}
              </span>
              {page < totalPages ? (
                <Link
                  href={buildHref(base, {
                    q: search,
                    pillar,
                    type: contentType,
                    page: page + 1,
                  })}
                  className="inline-flex items-center px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-800 hover:bg-gray-50"
                >
                  {t("paginationNext")}
                </Link>
              ) : (
                <span className="inline-flex items-center px-4 py-2 rounded-lg border border-gray-100 bg-gray-50 text-sm text-gray-400 cursor-not-allowed">
                  {t("paginationNext")}
                </span>
              )}
            </nav>
          ) : null}

          {/* Gradient CTA stripe */}
          <div
            className="rounded-2xl p-8 md:p-10 mb-8 text-center text-white"
            style={{
              background: `linear-gradient(135deg, ${blue} 0%, ${RESOURCES_HUB.actionBlueDarkest} 100%)`,
            }}
          >
            <h3 className="text-xl md:text-2xl font-bold mb-3">{t("ctaStripeTitle")}</h3>
            <p className="text-white/90 mb-6 max-w-xl mx-auto text-sm md:text-base">{t("ctaStripeBody")}</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
              <a
                href={getMarketingShopifyAppInstallUrl()}
                className="inline-flex items-center justify-center px-8 py-3 rounded-xl font-semibold text-black transition-colors"
                style={{ backgroundColor: lime }}
              >
                {t("ctaStripePrimary")}
              </a>
              <Link
                href={`${base}/templates`}
                className="inline-flex items-center justify-center px-8 py-3 rounded-xl font-semibold border-2 border-white/80 text-white hover:bg-white/10 transition-colors"
              >
                {t("ctaStripeSecondary")}
              </Link>
            </div>
          </div>

          <p className="text-xs text-gray-400 text-center">{t("designRef")}</p>
        </div>

      <MarketingSiteFooter base={base} />
    </div>
  );
}
