import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import Link from "next/link";
import type { Metadata } from "next";
import { routing } from "@/i18n/routing";
import type { PathLocale } from "@/lib/i18n/pathLocales";
import { listPublishedByRoute } from "@/lib/resources/queries";
import { getPublicBaseUrl } from "@/lib/resources/url";
import { ResourceBreadcrumbs } from "@/components/resources/ResourceBreadcrumbs";
import {
  hubLocaleToPathSegment,
  pathLocaleToHubLocale,
} from "@/lib/resources/localeMap";
import type { HubContentLocale } from "@/lib/resources/constants";
import { HUB_CONTENT_LOCALES } from "@/lib/resources/constants";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function resourcesPathForHubLocale(locale: HubContentLocale) {
  const seg = hubLocaleToPathSegment(locale);
  return seg === "en" ? "/resources" : `/${seg}/resources`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: loc } = await params;
  if (!hasLocale(routing.locales, loc)) return {};
  const t = await getTranslations({ locale: loc as PathLocale, namespace: "resources" });
  const base = getPublicBaseUrl();
  const pathLocale = loc as PathLocale;
  const path = resourcesPathForHubLocale(pathLocaleToHubLocale(pathLocale));
  const languages = Object.fromEntries(
    HUB_CONTENT_LOCALES.map((l) => [l, resourcesPathForHubLocale(l)])
  );
  return {
    title: t("hubTitle"),
    description: t("hubSubtitle"),
    alternates: base
      ? {
          canonical: `${base}${path}`,
          languages,
        }
      : undefined,
  };
}

export default async function ResourcesHubPage({ params, searchParams }: Props) {
  const { locale: loc } = await params;
  const sp = await searchParams;
  if (!hasLocale(routing.locales, loc)) {
    return null;
  }
  setRequestLocale(loc);
  const pathLocale = loc as PathLocale;
  const hubLocale = pathLocaleToHubLocale(pathLocale);
  const t = await getTranslations({ locale: pathLocale, namespace: "resources" });

  const pillar =
    typeof sp.pillar === "string" ? sp.pillar : undefined;
  const contentType =
    typeof sp.type === "string" ? sp.type : undefined;
  const search =
    typeof sp.q === "string" ? sp.q : undefined;

  let rows: Awaited<ReturnType<typeof listPublishedByRoute>> = [];
  try {
    rows = await listPublishedByRoute("resources", hubLocale, {
      pillar,
      contentType,
      search,
      limit: 48,
    });
  } catch {
    rows = [];
  }

  const base = pathLocale === "en" ? "" : `/${pathLocale}`;

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-8 py-12">
      <ResourceBreadcrumbs
        items={[
          { label: t("breadcrumbHome"), href: `${base}/` },
          { label: t("breadcrumbResources") },
        ]}
      />
      <header className="mb-10">
        <h1 className="text-3xl sm:text-4xl font-bold text-[#0B1220] mb-3">{t("hubTitle")}</h1>
        <p className="text-lg text-[#64748B] max-w-2xl">{t("hubSubtitle")}</p>
      </header>

      <form className="flex flex-col sm:flex-row gap-3 mb-8" action={`${base}/resources`} method="get">
        <input
          name="q"
          defaultValue={search ?? ""}
          placeholder={t("searchPlaceholder")}
          className="flex-1 rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm"
          aria-label={t("searchPlaceholder")}
        />
        <button type="submit" className="rounded-lg bg-[#0B1220] text-white px-4 py-2 text-sm">
          {t("filterType")}
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="text-[#64748B]">{t("noResults")}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`${base}/resources/${row.content_items.primary_pillar}/${row.slug}`}
                className="block rounded-xl border border-[#E5E7EB] p-5 hover:border-[#1D4ED8]/40 hover:shadow-sm transition-all"
              >
                <span className="text-xs font-medium text-[#1D4ED8] uppercase tracking-wide">
                  {t(`pillars.${row.content_items.primary_pillar}` as never)}
                </span>
                <h2 className="text-lg font-semibold text-[#0B1220] mt-1">{row.title}</h2>
                <p className="text-sm text-[#64748B] mt-2 line-clamp-2">{row.excerpt}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
