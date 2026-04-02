import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { routing } from "@/i18n/routing";
import type { PathLocale } from "@/lib/i18n/pathLocales";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: localeParam } = await params;
  if (!hasLocale(routing.locales, localeParam)) {
    return {};
  }
  const t = await getTranslations({ locale: localeParam, namespace: "consent" });
  return { title: t("privacyPageTitle") };
}

export default async function PrivacyPage({ params }: Props) {
  const { locale: localeParam } = await params;
  if (!hasLocale(routing.locales, localeParam)) {
    notFound();
  }
  const pathLocale = localeParam as PathLocale;
  setRequestLocale(pathLocale);

  const t = await getTranslations({ locale: pathLocale, namespace: "consent" });

  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        {t("privacyPageTitle")}
      </h1>
      <p className="mt-2 text-sm text-slate-500">{t("privacyPageUpdated")}</p>
      <div className="prose prose-slate mt-8 max-w-none text-sm leading-relaxed">
        <p>{t("privacyPageLead")}</p>
        <p>{t("privacyPageCookies")}</p>
        <p className="text-slate-600">{t("privacyPageContact")}</p>
      </div>
    </main>
  );
}
