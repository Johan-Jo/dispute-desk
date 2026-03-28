import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  ArrowRight,
  Calendar,
  Clock,
  Search as SearchIcon,
} from "lucide-react";
import type { PathLocale } from "@/lib/i18n/pathLocales";
import { pathLocaleToMessages } from "@/lib/i18n/pathLocales";
import type { ContentLocalizationRow, ContentItemRow } from "@/lib/resources/queries";
import { MarketingSiteHeader } from "@/components/marketing/MarketingSiteHeader";
import { contentTypeBadgeClass } from "@/components/resources/resourcesHubStyles";
import { ResourcesFilterBar } from "@/components/resources/ResourcesFilterBar";
import { MARKETING_PAGE_CONTAINER_CLASS } from "@/lib/marketing/pageContainer";

type Row = ContentLocalizationRow & { content_items: ContentItemRow };

const QUICK_PILLARS = [
  "chargebacks",
  "dispute-resolution",
  "small-claims",
  "mediation-arbitration",
] as const;

const BROWSE_PILLARS = [
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

/** Same width + horizontal padding as MarketingSiteHeader so hero and body align with the logo. */
const HUB_CONTAINER = MARKETING_PAGE_CONTAINER_CLASS;

function buildHref(
  base: string,
  next: { q?: string; pillar?: string; type?: string },
) {
  const p = new URLSearchParams();
  if (next.q) p.set("q", next.q);
  if (next.pillar) p.set("pillar", next.pillar);
  if (next.type) p.set("type", next.type);
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
  rows: Row[];
};

export async function ResourcesHubShell({
  base,
  pathLocale,
  pillar,
  contentType,
  search,
  rows,
}: Props) {
  const t = await getTranslations({ locale: pathLocale, namespace: "resources" });
  const isFiltered = !!(pillar || contentType || search);
  const featured = !isFiltered && rows.length > 0 ? rows[0] : null;
  const gridRows = featured ? rows.slice(1) : rows;

  const filterLabels: Record<string, string> = {};
  for (const key of FILTER_LABEL_KEYS) {
    filterLabels[key] = t(key as never);
  }

  return (
    <div className="min-h-screen bg-white">
      <MarketingSiteHeader />
      {/* Hero — Figma Make: gradient + search + topic chips */}
      <section className="bg-gradient-to-br from-[#0B1220] via-[#1D4ED8] to-[#0B1220] text-white">
        <div className={`${HUB_CONTAINER} py-12 sm:py-16`}>
            <h1 className="text-3xl sm:text-4xl font-bold mb-3">{t("heroTitle")}</h1>
            <p className="text-lg text-white/90 mb-8 max-w-3xl">{t("heroSubtitle")}</p>
            <form action={`${base}/resources`} method="get" className="flex flex-col sm:flex-row gap-3 w-full">
              <div className="relative flex-1">
                <SearchIcon
                  className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#667085] pointer-events-none"
                  aria-hidden
                />
                {pillar ? <input type="hidden" name="pillar" value={pillar} /> : null}
                {contentType ? <input type="hidden" name="type" value={contentType} /> : null}
                <input
                  name="q"
                  defaultValue={search ?? ""}
                  placeholder={t("searchPlaceholder")}
                  className="w-full pl-12 pr-4 py-3.5 bg-white text-[#0B1220] rounded-lg text-base shadow-lg focus:outline-none focus:ring-2 focus:ring-white/30"
                  aria-label={t("searchPlaceholder")}
                />
              </div>
              <button
                type="submit"
                className="px-6 py-3.5 bg-white/15 text-white rounded-lg font-medium border border-white/25 hover:bg-white/25 transition-colors shrink-0"
              >
                {t("searchButton")}
              </button>
            </form>
            <div className="flex flex-wrap gap-2 mt-6">
              {QUICK_PILLARS.map((pid) => {
                const active = pillar === pid;
                const href = buildHref(base, { q: search, pillar: active ? undefined : pid, type: contentType });
                return (
                  <Link
                    key={pid}
                    href={href}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all border ${
                      active
                        ? "bg-white text-[#1D4ED8] border-white"
                        : "bg-white/10 text-white border-white/20 hover:bg-white/20"
                    }`}
                  >
                    {t(`pillars.${pid}` as never)}
                  </Link>
                );
              })}
            </div>
        </div>
      </section>

      <div className={`${HUB_CONTAINER} py-12`}>
        {/* Featured */}
        {featured && (
          <div className="mb-12">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1 h-6 bg-[#1D4ED8] rounded-full" aria-hidden />
              <h2 className="text-xl font-bold text-[#0B1220]">{t("featuredLabel")}</h2>
            </div>
            <div className="bg-gradient-to-br from-[#1D4ED8] to-[#0B1220] rounded-xl p-6 sm:p-8 text-white shadow-lg">
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium mb-4 border bg-white/20 text-white border-white/30`}
              >
                {t(`types.${featured.content_items.content_type}` as never)}
              </span>
              <h3 className="text-2xl font-bold mb-3">{featured.title}</h3>
              <p className="text-white/90 mb-6 leading-relaxed line-clamp-3">{featured.excerpt}</p>
              <div className="flex flex-wrap items-center gap-6 mb-6 text-sm text-white/80">
                {featured.reading_time_minutes != null && (
                  <span className="inline-flex items-center gap-2">
                    <Clock className="w-4 h-4" aria-hidden />
                    {t("readTime", { minutes: featured.reading_time_minutes })}
                  </span>
                )}
                <span className="inline-flex items-center gap-2">
                  <Calendar className="w-4 h-4" aria-hidden />
                  {t("lastUpdated")}: {formatDate(featured.last_updated_at ?? featured.publish_at, pathLocale)}
                </span>
              </div>
              <Link
                href={`${base}/resources/${featured.content_items.primary_pillar}/${featured.slug}`}
                className="inline-flex items-center gap-2 px-6 py-3 bg-white text-[#1D4ED8] rounded-lg font-medium hover:bg-white/95 transition-colors"
              >
                {t("readArticle")}
                <ArrowRight className="w-4 h-4" aria-hidden />
              </Link>
            </div>
          </div>
        )}

        {/* Browse by topic */}
        <div className="mb-10">
          <h2 className="text-xl font-bold text-[#0B1220] mb-4">{t("browseTopicsTitle")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {BROWSE_PILLARS.map((pid) => {
              const active = pillar === pid;
              const href = buildHref(base, { q: search, pillar: active ? undefined : pid, type: contentType });
              return (
                <Link
                  key={pid}
                  href={href}
                  className={`p-4 rounded-lg border-2 text-left transition-all block ${
                    active
                      ? "border-[#1D4ED8] bg-[#EFF6FF]"
                      : "border-[#E1E3E5] bg-white hover:border-[#C9CCCF]"
                  }`}
                >
                  <h3
                    className={`text-sm font-semibold mb-1 ${
                      active ? "text-[#1D4ED8]" : "text-[#0B1220]"
                    }`}
                  >
                    {t(`pillars.${pid}` as never)}
                  </h3>
                  <p className="text-xs text-[#667085] line-clamp-2">{t(`topicBlurbs.${pid}` as never)}</p>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Type filters — Figma filter bar with icons, More Filters toggle, language picker */}
        <ResourcesFilterBar
          base={base}
          pathLocale={pathLocale}
          pillar={pillar}
          contentType={contentType}
          search={search}
          isFiltered={isFiltered}
          labels={filterLabels}
        />

        <p className="text-sm text-[#667085] mb-6">
          {t("resultsCount", { count: rows.length })}
        </p>

        {rows.length === 0 ? (
          <div className="text-center py-16 rounded-xl border border-[#E1E3E5] bg-[#FAFAFA]">
            <div className="w-16 h-16 bg-[#F6F8FB] rounded-full flex items-center justify-center mx-auto mb-4">
              <SearchIcon className="w-8 h-8 text-[#667085]" aria-hidden />
            </div>
            <h3 className="text-lg font-semibold text-[#0B1220] mb-2">{t("emptyTitle")}</h3>
            <p className="text-sm text-[#667085] mb-6 max-w-md mx-auto">{t("emptyHint")}</p>
            <Link
              href={`${base}/resources`}
              className="inline-block px-6 py-2.5 bg-[#1D4ED8] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] transition-colors"
            >
              {t("clearFilters")}
            </Link>
          </div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
            {gridRows.map((row) => (
              <li key={row.id}>
                <Link
                  href={`${base}/resources/${row.content_items.primary_pillar}/${row.slug}`}
                  className="block h-full bg-white rounded-lg border border-[#E1E3E5] p-6 hover:border-[#1D4ED8] hover:shadow-lg transition-all group"
                >
                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium mb-4 border ${contentTypeBadgeClass(row.content_items.content_type)}`}
                  >
                    {t(`types.${row.content_items.content_type}` as never)}
                  </span>
                  <h3 className="text-lg font-bold text-[#0B1220] mb-3 group-hover:text-[#1D4ED8] transition-colors leading-snug line-clamp-2">
                    {row.title}
                  </h3>
                  <p className="text-sm text-[#667085] mb-4 leading-relaxed line-clamp-3">{row.excerpt}</p>
                  <div className="flex flex-wrap items-center gap-4 text-xs text-[#667085]">
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
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-[#1D4ED8] group-hover:gap-2 transition-all">
                    {t("readMore")}
                    <ArrowRight className="w-4 h-4" aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {/* Secondary CTA — Figma bottom cards */}
        <div className="bg-white rounded-xl border border-[#E1E3E5] p-6 sm:p-8 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <h3 className="text-xl font-bold text-[#0B1220] mb-3">{t("ctaDemoTitle")}</h3>
              <p className="text-sm text-[#667085] mb-6">{t("ctaDemoBody")}</p>
              <Link
                href={`${base}/portal/connect-shopify`}
                className="inline-block px-6 py-3 bg-[#1D4ED8] text-white rounded-lg font-medium hover:bg-[#1e40af] transition-colors text-center"
              >
                {t("ctaDemoButton")}
              </Link>
            </div>
            <div>
              <h3 className="text-xl font-bold text-[#0B1220] mb-3">{t("ctaTemplatesTitle")}</h3>
              <p className="text-sm text-[#667085] mb-6">{t("ctaTemplatesBody")}</p>
              <Link
                href={`${base}/templates`}
                className="inline-flex items-center gap-2 px-6 py-3 bg-white text-[#1D4ED8] border-2 border-[#1D4ED8] rounded-lg font-medium hover:bg-[#EFF6FF] transition-colors"
              >
                {t("ctaTemplatesButton")}
              </Link>
            </div>
          </div>
        </div>

        <p className="text-xs text-[#94A3B8] text-center">
          {t("designRef")}
        </p>
      </div>
    </div>
  );
}
