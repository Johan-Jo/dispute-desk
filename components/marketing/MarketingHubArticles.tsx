import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { PathLocale } from "@/lib/i18n/pathLocales";
import {
  getPublishedLocalizationBySlug,
  listPublishedByRoute,
  type ContentItemRow,
  type ContentLocalizationRow,
} from "@/lib/resources/queries";
import { pathLocaleToHubLocale } from "@/lib/resources/localeMap";
import { ResourceCardImage } from "@/components/resources/ResourceCardImage";
import { contentTypeBadgeClass } from "@/components/resources/resourcesHubStyles";
import { MARKETING_PAGE_CONTAINER_CLASS } from "@/lib/marketing/pageContainer";
import { RESOURCES_HUB } from "@/lib/marketing/resourcesHubTokens";

type Props = {
  pathLocale: PathLocale;
  base: string;
};

type Card = ContentLocalizationRow & { content_items: ContentItemRow };

/** Hand-picked English slugs that anchor the hero strip, in display order. */
const EN_PINNED_SLUGS = [
  "understanding-chargeback-software-pricing-models",
  "compare-chargeback-vendors-beyond-win-rate",
] as const;

async function buildEnCards(): Promise<Card[]> {
  const hubLocale = "en-US" as const;
  const pinned: Card[] = [];
  for (const slug of EN_PINNED_SLUGS) {
    try {
      const row = await getPublishedLocalizationBySlug({
        routeKind: "resources",
        locale: hubLocale,
        slug,
      });
      if (row) {
        pinned.push({ ...row.localization, content_items: row.item });
      }
    } catch {
      // Skip a missing/unpublished pin; we'll backfill from pillar pages below.
    }
  }

  // Fill remaining slots (and backfill for any missing pins) with top pillar pages.
  const needed = 3 - pinned.length;
  if (needed <= 0) return pinned.slice(0, 3);

  let pillars: Card[] = [];
  try {
    const r = await listPublishedByRoute("resources", hubLocale, {
      contentType: "pillar_page",
      // Over-fetch so we can skip any pillar that happens to share a slug with a pin.
      limit: needed + EN_PINNED_SLUGS.length,
      offset: 0,
      includeTotal: false,
    });
    pillars = r.rows;
  } catch {
    pillars = [];
  }

  const pinnedSlugs = new Set(pinned.map((p) => p.slug));
  const filler = pillars.filter((p) => !pinnedSlugs.has(p.slug)).slice(0, needed);

  return [...pinned, ...filler];
}

async function buildLocalizedPillarCards(hubLocale: ReturnType<typeof pathLocaleToHubLocale>): Promise<Card[]> {
  try {
    const r = await listPublishedByRoute("resources", hubLocale, {
      contentType: "pillar_page",
      limit: 3,
      offset: 0,
      includeTotal: false,
    });
    return r.rows;
  } catch {
    return [];
  }
}

export async function MarketingHubArticles({ pathLocale, base }: Props) {
  const hubLocale = pathLocaleToHubLocale(pathLocale);

  const rows: Card[] =
    hubLocale === "en-US"
      ? await buildEnCards()
      : await buildLocalizedPillarCards(hubLocale);

  if (rows.length < 3) return null;

  const t = await getTranslations({ locale: pathLocale, namespace: "marketing.fromHub" });
  const tResources = await getTranslations({ locale: pathLocale, namespace: "resources" });
  const blue = RESOURCES_HUB.actionBlue;

  return (
    <section className="py-12 sm:py-16 lg:py-20 bg-[#F6F8FB]">
      <div className={MARKETING_PAGE_CONTAINER_CLASS}>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8 sm:mb-12">
          <div>
            <p className="text-sm uppercase tracking-wide text-[#1D4ED8] font-medium mb-2">
              {t("eyebrow")}
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-[#0B1220] mb-2">
              {t("title")}
            </h2>
            <p className="text-base sm:text-lg text-[#64748B]">{t("subtitle")}</p>
          </div>
          <Link
            href={`${base}/resources`}
            className="inline-flex items-center gap-2 text-sm font-semibold whitespace-nowrap hover:gap-3 transition-all"
            style={{ color: blue }}
          >
            {t("viewAll")}
            <ArrowRight className="w-4 h-4" aria-hidden />
          </Link>
        </div>

        <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`${base}/resources/${row.content_items.primary_pillar}/${row.slug}`}
                className="block h-full bg-white rounded-2xl overflow-hidden border border-[#E5E7EB] hover:shadow-lg transition-all group text-left"
              >
                <ResourceCardImage
                  url={row.content_items.featured_image_url}
                  alt={row.content_items.featured_image_alt ?? row.title}
                  variant="default"
                />
                <div className="p-6">
                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium mb-4 border ${contentTypeBadgeClass(row.content_items.content_type)}`}
                  >
                    {tResources(`types.${row.content_items.content_type}` as never)}
                  </span>
                  <h3 className="text-lg font-bold text-[#0B1220] mb-3 group-hover:text-[#1D4ED8] transition-colors leading-snug line-clamp-2">
                    {row.title}
                  </h3>
                  <p className="text-sm text-[#64748B] mb-4 leading-relaxed line-clamp-3">
                    {row.excerpt}
                  </p>
                  <div className="flex items-center justify-between gap-4">
                    {row.reading_time_minutes != null ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-[#94A3B8]">
                        <Clock className="w-3.5 h-3.5" aria-hidden />
                        {tResources("readTime", { minutes: row.reading_time_minutes })}
                      </span>
                    ) : (
                      <span />
                    )}
                    <span
                      className="inline-flex items-center gap-1 text-sm font-semibold group-hover:gap-2 transition-all"
                      style={{ color: blue }}
                    >
                      {t("readMore")}
                      <ArrowRight className="w-4 h-4" aria-hidden />
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
