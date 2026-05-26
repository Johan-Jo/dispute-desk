import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { routing } from "@/i18n/routing";
import type { PathLocale } from "@/lib/i18n/pathLocales";
import { hubLocaleToPathSegment, pathLocaleToHubLocale } from "@/lib/resources/localeMap";
import {
  getPublishedLocalizationBySlug,
  getSiblingLocaleUrls,
} from "@/lib/resources/queries";
import { getPublicBaseUrl } from "@/lib/resources/url";
import { ResourceBreadcrumbs } from "@/components/resources/ResourceBreadcrumbs";
import { BodyBlocks } from "@/components/resources/BodyBlocks";

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: loc, slug } = await params;
  if (!hasLocale(routing.locales, loc)) return {};
  const hubLocale = pathLocaleToHubLocale(loc as PathLocale);
  const row = await getPublishedLocalizationBySlug({
    routeKind: "case-studies",
    locale: hubLocale,
    slug,
  });
  if (!row) return { title: "Not found" };
  const { localization: L } = row;
  const base = getPublicBaseUrl();
  const pathPrefix = loc === "en" ? "" : `/${loc}`;
  const path = `${pathPrefix}/case-studies/${slug}`;

  const languages = base
    ? await getSiblingLocaleUrls({
        contentItemId: row.item.id,
        routeKind: "case-studies",
        baseUrl: base,
        buildPath: (siblingLocale, siblingSlug) => {
          const seg = hubLocaleToPathSegment(siblingLocale);
          const prefix = seg === "en" ? "" : `/${seg}`;
          return `${prefix}/case-studies/${siblingSlug}`;
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

export default async function CaseStudyDetailPage({ params }: Props) {
  const { locale: loc, slug } = await params;
  if (!hasLocale(routing.locales, loc)) notFound();
  setRequestLocale(loc);
  const pathLocale = loc as PathLocale;
  const hubLocale = pathLocaleToHubLocale(pathLocale);
  const t = await getTranslations({ locale: pathLocale, namespace: "resources" });
  const basePath = pathLocale === "en" ? "" : `/${pathLocale}`;
  const row = await getPublishedLocalizationBySlug({
    routeKind: "case-studies",
    locale: hubLocale,
    slug,
  });
  if (!row) notFound();
  const { localization: L } = row;
  return (
    <article className="max-w-[800px] mx-auto px-4 py-12">
      <ResourceBreadcrumbs
        items={[
          { label: t("breadcrumbHome"), href: `${basePath}/` },
          { label: t("types.case_study"), href: `${basePath}/case-studies` },
          { label: L.title },
        ]}
      />
      <h1 className="text-3xl font-bold mt-6">{L.title}</h1>
      <BodyBlocks body={(L.body_json as Record<string, unknown>) ?? {}} />
    </article>
  );
}
