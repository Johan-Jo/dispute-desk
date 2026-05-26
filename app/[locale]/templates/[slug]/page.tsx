import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import { routing } from "@/i18n/routing";
import type { PathLocale } from "@/lib/i18n/pathLocales";
import { hubLocaleToPathSegment, pathLocaleToHubLocale } from "@/lib/resources/localeMap";
import {
  getPublishedLocalizationBySlug,
  findLocalizationBySlugAnyLocale,
  getSiblingLocaleUrls,
} from "@/lib/resources/queries";
import { getPublicBaseUrl } from "@/lib/resources/url";
import { getServiceClient } from "@/lib/supabase/server";
import { ResourceBreadcrumbs } from "@/components/resources/ResourceBreadcrumbs";
import { BodyBlocks } from "@/components/resources/BodyBlocks";

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
  const { localization: L } = row;

  return (
    <article className="max-w-[800px] mx-auto px-4 sm:px-8 py-12">
      <ResourceBreadcrumbs
        items={[
          { label: t("breadcrumbHome"), href: `${basePath}/` },
          { label: t("types.template"), href: `${basePath}/templates` },
          { label: L.title },
        ]}
      />
      <h1 className="text-3xl font-bold mt-6">{L.title}</h1>
      <p className="text-[#64748B] mt-2">{L.excerpt}</p>
      <BodyBlocks body={(L.body_json as Record<string, unknown>) ?? {}} />
    </article>
  );
}
