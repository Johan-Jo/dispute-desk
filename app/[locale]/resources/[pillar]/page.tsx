import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import Link from "next/link";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import type { PathLocale } from "@/lib/i18n/pathLocales";
import { pathLocaleToHubLocale } from "@/lib/resources/localeMap";
import { listPublishedByRoute } from "@/lib/resources/queries";
import { MarketingSiteHeader } from "@/components/marketing/MarketingSiteHeader";
import { ResourceBreadcrumbs } from "@/components/resources/ResourceBreadcrumbs";
import { MARKETING_PAGE_CONTAINER_CLASS } from "@/lib/marketing/pageContainer";

const PILLARS = [
  "chargebacks",
  "dispute-resolution",
  "small-claims",
  "mediation-arbitration",
  "dispute-management-software",
] as const;

type Props = { params: Promise<{ locale: string; pillar: string }> };

export default async function PillarPage({ params }: Props) {
  const { locale: loc, pillar } = await params;
  if (!hasLocale(routing.locales, loc)) notFound();
  if (!PILLARS.includes(pillar as (typeof PILLARS)[number])) notFound();

  setRequestLocale(loc);
  const pathLocale = loc as PathLocale;
  const hubLocale = pathLocaleToHubLocale(pathLocale);
  const t = await getTranslations({ locale: pathLocale, namespace: "resources" });
  const basePath = pathLocale === "en" ? "" : `/${pathLocale}`;

  const rows = await listPublishedByRoute("resources", hubLocale, {
    pillar,
    limit: 48,
  });

  return (
    <>
      <MarketingSiteHeader />
      <div className={`${MARKETING_PAGE_CONTAINER_CLASS} py-12`}>
      <ResourceBreadcrumbs
        items={[
          { label: t("breadcrumbHome"), href: `${basePath}/` },
          { label: t("breadcrumbResources"), href: `${basePath}/resources` },
          { label: t(`pillars.${pillar}` as never) },
        ]}
      />
      <h1 className="text-3xl font-bold text-[#0B1220] mb-8">{t(`pillars.${pillar}` as never)}</h1>
      <ul className="grid gap-4 sm:grid-cols-2">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`${basePath}/resources/${pillar}/${row.slug}`}
              className="block rounded-xl border border-[#E5E7EB] p-5 hover:border-[#1D4ED8]/40"
            >
              <h2 className="text-lg font-semibold text-[#0B1220]">{row.title}</h2>
              <p className="text-sm text-[#64748B] mt-2 line-clamp-2">{row.excerpt}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
    </>
  );
}
