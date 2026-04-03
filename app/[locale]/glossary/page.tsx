import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import Link from "next/link";
import { routing } from "@/i18n/routing";
import type { PathLocale } from "@/lib/i18n/pathLocales";
import { pathLocaleToHubLocale } from "@/lib/resources/localeMap";
import { listPublishedByRoute } from "@/lib/resources/queries";
import { ResourceBreadcrumbs } from "@/components/resources/ResourceBreadcrumbs";
import { HubSectionNav } from "@/components/resources/HubSectionNav";
import { MARKETING_PAGE_CONTAINER_CLASS } from "@/lib/marketing/pageContainer";

type Props = { params: Promise<{ locale: string }> };

export default async function GlossaryPage({ params }: Props) {
  const { locale: loc } = await params;
  if (!hasLocale(routing.locales, loc)) return null;
  setRequestLocale(loc);
  const pathLocale = loc as PathLocale;
  const hubLocale = pathLocaleToHubLocale(pathLocale);
  const t = await getTranslations({ locale: pathLocale, namespace: "resources" });
  const basePath = pathLocale === "en" ? "" : `/${pathLocale}`;
  let rows: Awaited<ReturnType<typeof listPublishedByRoute>>["rows"] = [];
  try {
    const r = await listPublishedByRoute("glossary", hubLocale, {
      limit: 200,
      includeTotal: false,
    });
    rows = r.rows;
  } catch {
    rows = [];
  }

  return (
    <div className={`${MARKETING_PAGE_CONTAINER_CLASS} py-12`}>
      <ResourceBreadcrumbs
        items={[
          { label: t("breadcrumbHome"), href: `${basePath}/` },
          { label: t("types.glossary_entry") },
        ]}
      />
      <HubSectionNav
        basePath={basePath}
        active="glossary"
        labels={{
          resources: t("hubNav.resources"),
          templates: t("hubNav.templates"),
          caseStudies: t("hubNav.caseStudies"),
          glossary: t("hubNav.glossary"),
        }}
      />
      <h1 className="text-3xl font-bold mb-8">{t("types.glossary_entry")}</h1>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id}>
            <Link href={`${basePath}/glossary/${row.slug}`} className="text-[#1D4ED8] hover:underline">
              {row.title}
            </Link>
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p className="text-[#64748B]">{t("noResults")}</p>}
    </div>
  );
}
