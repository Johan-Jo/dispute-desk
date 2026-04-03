import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { routing } from "@/i18n/routing";
import type { PathLocale } from "@/lib/i18n/pathLocales";
import { marketingHomePath } from "@/lib/i18n/pathLocales";
import type { Locale } from "@/lib/i18n/locales";
import { countPublishedByPillar, listPublishedByRoute } from "@/lib/resources/queries";
import { getPublicBaseUrl } from "@/lib/resources/url";
import { ResourcesHubShell } from "@/components/resources/ResourcesHubShell";
import {
  hubLocaleToPathSegment,
  pathLocaleToHubLocale,
} from "@/lib/resources/localeMap";
import type { HubContentLocale } from "@/lib/resources/constants";
import { HUB_CONTENT_LOCALES } from "@/lib/resources/constants";
import { resourcesHubCollectionJsonLd } from "@/lib/resources/schema/jsonLd";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function resourcesPathForHubLocale(locale: HubContentLocale) {
  const seg = hubLocaleToPathSegment(locale);
  return seg === "en" ? "/resources" : `/${seg}/resources`;
}

function hubCanonicalRelative(
  pathLocale: PathLocale,
  sp: Record<string, string | string[] | undefined>,
): string {
  const path = resourcesPathForHubLocale(pathLocaleToHubLocale(pathLocale));
  const pillar = typeof sp.pillar === "string" ? sp.pillar : undefined;
  const contentType = typeof sp.type === "string" ? sp.type : undefined;
  const q = typeof sp.q === "string" ? sp.q : undefined;
  if (!pillar && !contentType && !q) return path;
  const p = new URLSearchParams();
  if (pillar) p.set("pillar", pillar);
  if (contentType) p.set("type", contentType);
  if (q) p.set("q", q);
  return `${path}?${p.toString()}`;
}

export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  const { locale: loc } = await params;
  const sp = await searchParams;
  if (!hasLocale(routing.locales, loc)) return {};
  const pathLocale = loc as PathLocale;
  const hubLocale = pathLocaleToHubLocale(pathLocale);
  const t = await getTranslations({ locale: pathLocale, namespace: "resources" });
  const base = getPublicBaseUrl();
  const isFiltered = !!(
    typeof sp.pillar === "string" ||
    typeof sp.type === "string" ||
    typeof sp.q === "string"
  );
  const title = t("hubTitle");
  const description = t("heroSubtitle");
  const keywords = t("hubKeywords")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const canonicalPath = hubCanonicalRelative(pathLocale, sp);

  const metadata: Metadata = {
    title,
    description,
    keywords,
    openGraph: {
      type: "website",
      title,
      description,
      siteName: "DisputeDesk",
      locale: hubLocale,
      alternateLocale: HUB_CONTENT_LOCALES.filter((l) => l !== hubLocale),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    robots: isFiltered
      ? { index: false, follow: true }
      : { index: true, follow: true },
  };

  if (base) {
    metadata.alternates = {
      canonical: canonicalPath,
      ...(!isFiltered
        ? {
            languages: {
              ...Object.fromEntries(
                HUB_CONTENT_LOCALES.map((l) => [l, resourcesPathForHubLocale(l)]),
              ),
              "x-default": resourcesPathForHubLocale("en-US"),
            },
          }
        : {}),
    };
    metadata.openGraph = {
      ...metadata.openGraph,
      url: canonicalPath,
    };
  }

  return metadata;
}

export default async function ResourcesHubPage({ params, searchParams }: Props) {
  const { locale: loc } = await params;
  const sp = await searchParams;
  if (!hasLocale(routing.locales, loc)) {
    notFound();
  }
  setRequestLocale(loc);
  const pathLocale = loc as PathLocale;
  const hubLocale = pathLocaleToHubLocale(pathLocale);

  const pillar = typeof sp.pillar === "string" ? sp.pillar : undefined;
  const contentType = typeof sp.type === "string" ? sp.type : undefined;
  const search = typeof sp.q === "string" ? sp.q : undefined;
  const isFiltered = !!(pillar || contentType || search);

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
  let pillarCounts: Record<string, number> = {};
  try {
    pillarCounts = await countPublishedByPillar("resources", hubLocale);
  } catch {
    pillarCounts = {};
  }

  const base = pathLocale === "en" ? "" : `/${pathLocale}`;
  const origin = getPublicBaseUrl();
  const t = await getTranslations({ locale: pathLocale, namespace: "resources" });

  const hubJsonLd =
    !isFiltered && origin && rows.length > 0
      ? resourcesHubCollectionJsonLd({
          pageUrl: `${origin}${resourcesPathForHubLocale(hubLocale)}`,
          siteHomeUrl: `${origin}${marketingHomePath(hubLocale as Locale)}`,
          name: t("hubTitle"),
          description: t("heroSubtitle"),
          inLanguage: hubLocale,
          items: rows.slice(0, 24).map((row) => ({
            name: row.title,
            url: `${origin}${base}/resources/${row.content_items.primary_pillar}/${row.slug}`,
          })),
        })
      : null;

  return (
    <>
      {hubJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(hubJsonLd) }}
        />
      ) : null}
      <ResourcesHubShell
        base={base}
        pathLocale={pathLocale}
        pillar={pillar}
        contentType={contentType}
        search={search}
        rows={rows}
        pillarCounts={pillarCounts}
      />
    </>
  );
}
