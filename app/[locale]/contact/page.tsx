import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { routing } from "@/i18n/routing";
import type { PathLocale } from "@/lib/i18n/pathLocales";
import { ContactPageClient } from "@/components/marketing/ContactPageClient";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: localeParam } = await params;
  if (!hasLocale(routing.locales, localeParam)) {
    return {};
  }
  const t = await getTranslations({ locale: localeParam, namespace: "contact" });
  return {
    title: t("seo.title"),
    description: t("seo.description"),
  };
}

export default async function ContactPage({ params }: Props) {
  const { locale: localeParam } = await params;
  if (!hasLocale(routing.locales, localeParam)) {
    notFound();
  }
  const pathLocale = localeParam as PathLocale;
  setRequestLocale(pathLocale);

  return (
    <ContactPageClient base={pathLocale === "en" ? "" : `/${pathLocale}`} />
  );
}
