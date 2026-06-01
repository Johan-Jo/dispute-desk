import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { routing } from "@/i18n/routing";
import type { PathLocale } from "@/lib/i18n/pathLocales";
import { buildPlaybookMetadata } from "@/lib/marketing/playbookMetadata";
import { PlaybookLandingClient } from "@/components/marketing/PlaybookLandingClient";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: localeParam } = await params;
  if (!hasLocale(routing.locales, localeParam)) {
    return {};
  }
  return buildPlaybookMetadata(localeParam as PathLocale);
}

export default async function PlaybookPage({ params }: Props) {
  const { locale: localeParam } = await params;
  if (!hasLocale(routing.locales, localeParam)) {
    notFound();
  }
  const pathLocale = localeParam as PathLocale;
  setRequestLocale(pathLocale);

  return (
    <PlaybookLandingClient
      base={pathLocale === "en" ? "" : `/${pathLocale}`}
      locale={pathLocale}
    />
  );
}
