import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { routing } from "@/i18n/routing";
import type { PathLocale } from "@/lib/i18n/pathLocales";
import { NurtureSequenceViewer } from "@/components/marketing/NurtureSequenceViewer";

type Props = { params: Promise<{ locale: string }> };

/** Internal reference page — never indexed. */
export const metadata: Metadata = {
  title: "CE 3.0 Email Course (internal) · DisputeDesk",
  robots: { index: false, follow: false },
};

export default async function PlaybookSequencePage({ params }: Props) {
  const { locale: localeParam } = await params;
  if (!hasLocale(routing.locales, localeParam)) {
    notFound();
  }
  setRequestLocale(localeParam as PathLocale);

  return <NurtureSequenceViewer />;
}
