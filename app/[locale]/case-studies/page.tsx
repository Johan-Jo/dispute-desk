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
  const path = pathLocale === "en" ? "/case-studies" : `/${pathLocale}/case-studies`;
  return {
    title: `${t("types.case_study")} — DisputeDesk`,
    alternates: base ? { canonical: `${base}${path}` } : undefined,
  };
}

export default async function CaseStudiesPage({ params }: Props) {
  const { locale: loc } = await params;
  if (!hasLocale(routing.locales, loc)) notFound();
  setRequestLocale(loc);
  const pathLocale = loc as PathLocale;
  const hubLocale = pathLocaleToHubLocale(pathLocale);
  const t = await getTranslations({ locale: pathLocale, namespace: "resources" });
  const basePath = pathLocale === "en" ? "" : `/${pathLocale}`;
  let rows: Awaited<ReturnType<typeof listPublishedByRoute>>["rows"] = [];
  try {
    const r = await listPublishedByRoute("case-studies", hubLocale, {
      limit: 48,
      includeTotal: false,
    });
    rows = r.rows;
  } catch {
    rows = [];
  }
  // 404 when this locale has zero published case studies — an empty grid at
  // 200 OK triggers GSC "crawled, currently not indexed" and pollutes the index.
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
          { label: t("types.case_study") },
        ]}
      />
      <HubSectionNav
        basePath={basePath}
        active="case-studies"
        present={presentHubs}
        labels={{
          resources: t("hubNav.resources"),
          templates: t("hubNav.templates"),
          caseStudies: t("hubNav.caseStudies"),
          glossary: t("hubNav.glossary"),
        }}
      />
      <h1 className="text-3xl font-bold mb-8">{t("types.case_study")}</h1>
      <ul className="grid gap-4">
        {rows.map((row) => (
          <li key={row.id}>
            <Link href={`${basePath}/case-studies/${row.slug}`} className="block border rounded-xl p-5">
              <h2 className="font-semibold">{row.title}</h2>
              <p className="text-sm text-[#64748B] mt-1">{row.excerpt}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
