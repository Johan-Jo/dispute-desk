import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, FileText, Clock, Calendar } from "lucide-react";
import { routing } from "@/i18n/routing";
import type { PathLocale } from "@/lib/i18n/pathLocales";
import { pathLocaleToMessages } from "@/lib/i18n/pathLocales";
import { pathLocaleToHubLocale } from "@/lib/resources/localeMap";
import { listPublishedByRoute } from "@/lib/resources/queries";
import { getPublicBaseUrl } from "@/lib/resources/url";
import { MarketingSiteHeader } from "@/components/marketing/MarketingSiteHeader";
import { HubSectionNav } from "@/components/resources/HubSectionNav";
import { MARKETING_PAGE_CONTAINER_CLASS } from "@/lib/marketing/pageContainer";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: loc } = await params;
  if (!hasLocale(routing.locales, loc)) return {};
  const t = await getTranslations({
    locale: loc as PathLocale,
    namespace: "resources",
  });
  const base = getPublicBaseUrl();
  const pathLocale = loc as PathLocale;
  const path = pathLocale === "en" ? "/templates" : `/${pathLocale}/templates`;
  return {
    title: `${t("types.template")} — DisputeDesk`,
    description: t("templateHeroSubtitle"),
    alternates: base ? { canonical: `${base}${path}` } : undefined,
  };
}

function formatDate(iso: string | null | undefined, pathLocale: PathLocale) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(pathLocaleToMessages[pathLocale], {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function TemplatesHubPage({ params }: Props) {
  const { locale: loc } = await params;
  if (!hasLocale(routing.locales, loc)) return null;
  setRequestLocale(loc);
  const pathLocale = loc as PathLocale;
  const hubLocale = pathLocaleToHubLocale(pathLocale);
  const t = await getTranslations({
    locale: pathLocale,
    namespace: "resources",
  });
  const basePath = pathLocale === "en" ? "" : `/${pathLocale}`;

  let rows: Awaited<ReturnType<typeof listPublishedByRoute>> = [];
  try {
    rows = await listPublishedByRoute("templates", hubLocale, { limit: 48 });
  } catch {
    rows = [];
  }

  return (
    <div className="min-h-screen bg-white">
      <MarketingSiteHeader />

      {/* Hero */}
      <section className="bg-gradient-to-br from-[#0B1220] via-[#1D4ED8] to-[#0B1220] text-white">
        <div className={`${MARKETING_PAGE_CONTAINER_CLASS} py-12 sm:py-16`}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-white/15 rounded-lg flex items-center justify-center border border-white/20">
              <FileText className="w-5 h-5 text-white" aria-hidden />
            </div>
            <span className="text-sm font-medium text-white/70 uppercase tracking-wide">
              {t("types.template")}
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold mb-3">
            {t("templateHeroTitle")}
          </h1>
          <p className="text-lg text-white/90 mb-0 max-w-3xl">
            {t("templateHeroSubtitle")}
          </p>
        </div>
      </section>

      <div className={`${MARKETING_PAGE_CONTAINER_CLASS} py-12`}>
        <HubSectionNav
          basePath={basePath}
          active="templates"
          labels={{
            resources: t("hubNav.resources"),
            templates: t("hubNav.templates"),
            caseStudies: t("hubNav.caseStudies"),
            glossary: t("hubNav.glossary"),
          }}
        />

        {rows.length === 0 ? (
          <div className="text-center py-16 rounded-xl border border-[#E1E3E5] bg-[#FAFAFA]">
            <div className="w-16 h-16 bg-[#F6F8FB] rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8 text-[#667085]" aria-hidden />
            </div>
            <h3 className="text-lg font-semibold text-[#0B1220] mb-2">
              {t("noResults")}
            </h3>
            <p className="text-sm text-[#667085] mb-6 max-w-md mx-auto">
              {t("templateEmptyHint")}
            </p>
            <Link
              href={`${basePath}/resources`}
              className="inline-block px-6 py-2.5 bg-[#1D4ED8] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] transition-colors"
            >
              {t("hubNav.resources")}
            </Link>
          </div>
        ) : (
          <>
            <p className="text-sm text-[#667085] mb-6">
              {t("resultsCount", { count: rows.length })}
            </p>
            <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
              {rows.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`${basePath}/templates/${row.slug}`}
                    className="block h-full bg-white rounded-lg border border-[#E1E3E5] p-6 hover:border-[#1D4ED8] hover:shadow-lg transition-all group"
                  >
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium mb-4 border bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]">
                      {t("types.template")}
                    </span>
                    <h3 className="text-lg font-bold text-[#0B1220] mb-3 group-hover:text-[#1D4ED8] transition-colors leading-snug line-clamp-2">
                      {row.title}
                    </h3>
                    <p className="text-sm text-[#667085] mb-4 leading-relaxed line-clamp-3">
                      {row.excerpt}
                    </p>
                    <div className="flex flex-wrap items-center gap-4 text-xs text-[#667085]">
                      {"reading_time_minutes" in row &&
                        row.reading_time_minutes != null && (
                          <span className="inline-flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" aria-hidden />
                            {t("readTime", {
                              minutes: row.reading_time_minutes,
                            })}
                          </span>
                        )}
                      <span className="inline-flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5" aria-hidden />
                        {formatDate(
                          row.last_updated_at ?? row.publish_at,
                          pathLocale
                        )}
                      </span>
                    </div>
                    <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-[#1D4ED8] group-hover:gap-2 transition-all">
                      {t("viewTemplate")}
                      <ArrowRight className="w-4 h-4" aria-hidden />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}

        {/* CTA */}
        <div className="bg-white rounded-xl border border-[#E1E3E5] p-6 sm:p-8 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <h3 className="text-xl font-bold text-[#0B1220] mb-3">
                {t("ctaDemoTitle")}
              </h3>
              <p className="text-sm text-[#667085] mb-6">
                {t("ctaDemoBody")}
              </p>
              <Link
                href={`${basePath}/portal/connect-shopify`}
                className="inline-block px-6 py-3 bg-[#1D4ED8] text-white rounded-lg font-medium hover:bg-[#1e40af] transition-colors text-center"
              >
                {t("ctaDemoButton")}
              </Link>
            </div>
            <div>
              <h3 className="text-xl font-bold text-[#0B1220] mb-3">
                {t("ctaResourcesTitle")}
              </h3>
              <p className="text-sm text-[#667085] mb-6">
                {t("ctaResourcesBody")}
              </p>
              <Link
                href={`${basePath}/resources`}
                className="inline-flex items-center gap-2 px-6 py-3 bg-white text-[#1D4ED8] border-2 border-[#1D4ED8] rounded-lg font-medium hover:bg-[#EFF6FF] transition-colors"
              >
                {t("ctaResourcesButton")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
