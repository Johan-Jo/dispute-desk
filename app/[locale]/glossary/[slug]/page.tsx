import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import type { PathLocale } from "@/lib/i18n/pathLocales";
import { pathLocaleToHubLocale } from "@/lib/resources/localeMap";
import { getPublishedLocalizationBySlug } from "@/lib/resources/queries";
import { ResourceBreadcrumbs } from "@/components/resources/ResourceBreadcrumbs";
import { BodyBlocks } from "@/components/resources/BodyBlocks";

type Props = { params: Promise<{ locale: string; slug: string }> };

export default async function GlossaryEntryPage({ params }: Props) {
  const { locale: loc, slug } = await params;
  if (!hasLocale(routing.locales, loc)) notFound();
  setRequestLocale(loc);
  const pathLocale = loc as PathLocale;
  const hubLocale = pathLocaleToHubLocale(pathLocale);
  const t = await getTranslations({ locale: pathLocale, namespace: "resources" });
  const basePath = pathLocale === "en" ? "" : `/${pathLocale}`;
  const row = await getPublishedLocalizationBySlug({
    routeKind: "glossary",
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
          { label: t("types.glossary_entry"), href: `${basePath}/glossary` },
          { label: L.title },
        ]}
      />
      <h1 className="text-3xl font-bold mt-6">{L.title}</h1>
      <BodyBlocks body={(L.body_json as Record<string, unknown>) ?? {}} />
    </article>
  );
}
