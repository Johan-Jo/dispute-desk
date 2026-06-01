import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { routing } from "@/i18n/routing";
import type { PathLocale } from "@/lib/i18n/pathLocales";
import { buildPlaybookReaderMetadata } from "@/lib/marketing/playbookMetadata";
import { PlaybookReader } from "@/components/marketing/PlaybookReader";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: localeParam } = await params;
  if (!hasLocale(routing.locales, localeParam)) {
    return {};
  }
  return buildPlaybookReaderMetadata(localeParam as PathLocale);
}

export default async function PlaybookReadPage({ params }: Props) {
  const { locale: localeParam } = await params;
  if (!hasLocale(routing.locales, localeParam)) {
    notFound();
  }
  const pathLocale = localeParam as PathLocale;
  setRequestLocale(pathLocale);

  return <PlaybookReader base={pathLocale === "en" ? "" : `/${pathLocale}`} />;
}
