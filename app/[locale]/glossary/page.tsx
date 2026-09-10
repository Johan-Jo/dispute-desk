import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { routing } from "@/i18n/routing";
import type { PathLocale } from "@/lib/i18n/pathLocales";
import { pathLocaleToHubLocale } from "@/lib/resources/localeMap";
import {
  getNonEmptyHubsForLocale,
  listPublishedByRoute,
} from "@/lib/resources/queries";
import { getPublicBaseUrl } from "@/lib/resources/url";
import { ResourceBreadcrumbs } from "@/components/resources/ResourceBreadcrumbs";
import { HubSectionNav } from "@/components/resources/HubSectionNav";
import { MARKETING_PAGE_CONTAINER_CLASS } from "@/lib/marketing/pageContainer";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: loc } = await params;
  if (!hasLocale(routing.locales, loc)) return {};
  const pathLocale = loc as PathLocale;
  const t = await getTranslations({ locale: pathLocale, namespace: "resources" });
  const base = getPublicBaseUrl();
  const path = pathLocale === "en" ? "/glossary" : `/${pathLocale}/glossary`;
  return {
    title: `${t("types.glossary_entry")} — DisputeDesk`,
    alternates: base ? { canonical: `${base}${path}` } : undefined,
  };
}

export default async function GlossaryPage({ params }: Props) {
  const { locale: loc } = await params;
  if (!hasLocale(routing.locales, loc)) notFound();
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
  // 404 when this locale has zero published glossary entries — see case-studies/page.tsx.
  if (rows.length === 0) notFound();

  let presentHubs: Awaited<ReturnType<typeof getNonEmptyHubsForLocale>> =
    new Set();
  try {
    presentHubs = await getNonEmptyHubsForLocale(hubLocale);
  } catch {
    presentHubs = new Set();
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
        present={presentHubs}
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
    </div>
  );
}
