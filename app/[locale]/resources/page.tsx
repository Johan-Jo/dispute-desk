import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import type { Metadata } from "next";
import { routing } from "@/i18n/routing";
import type { PathLocale } from "@/lib/i18n/pathLocales";
import { listPublishedByRoute } from "@/lib/resources/queries";
import { getPublicBaseUrl } from "@/lib/resources/url";
import { ResourcesHubShell } from "@/components/resources/ResourcesHubShell";
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
    <ResourcesHubShell
      base={base}
      pathLocale={pathLocale}
      pillar={pillar}
      contentType={contentType}
      search={search}
      rows={rows}
    />
  );
}
