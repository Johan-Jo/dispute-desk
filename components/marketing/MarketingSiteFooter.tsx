"use client";

import { Shield } from "lucide-react";
import { useTranslations } from "next-intl";
import { MARKETING_PAGE_CONTAINER_CLASS } from "@/lib/marketing/pageContainer";

type Props = {
  /** Locale path prefix: `""` for English, `"/de"` for German, etc. */
  base?: string;
};

function homeHref(base: string, hash: string) {
  return base ? `${base}#${hash}` : `/#${hash}`;
}

function pathHref(base: string, path: string) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

/** Shared marketing footer (home, Resources hub, etc.) — matches Figma Make landing. */
export function MarketingSiteFooter({ base = "" }: Props) {
  const t = useTranslations("marketing");

  return (
    <footer className="bg-[#0B1220] text-white py-8 sm:py-12">
      <div className={MARKETING_PAGE_CONTAINER_CLASS}>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6 sm:gap-8 mb-6 sm:mb-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 bg-[#1D4ED8] rounded-lg flex items-center justify-center">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <span className="text-lg font-bold">DisputeDesk</span>
            </div>
            <p className="text-sm text-gray-400">{t("footer.tagline")}</p>
          </div>
          <div>
            <h3 className="font-semibold mb-4">{t("footer.product")}</h3>
            <ul className="space-y-2 text-sm text-gray-400">
              <li>
                <a href={homeHref(base, "how-it-works")} className="hover:text-white transition-colors">
                  {t("footer.features")}
                </a>
              </li>
              <li>
                <a href={homeHref(base, "pricing")} className="hover:text-white transition-colors">
                  {t("nav.pricing")}
                </a>
              </li>
              <li>
                <a href={homeHref(base, "security")} className="hover:text-white transition-colors">
                  {t("nav.security")}
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold mb-4">{t("footer.company")}</h3>
            <ul className="space-y-2 text-sm text-gray-400">
              <li>
                <a href={homeHref(base, "how-it-works")} className="hover:text-white transition-colors">
                  {t("footer.about")}
                </a>
              </li>
              <li>
                <a href="mailto:support@disputedesk.com" className="hover:text-white transition-colors">
                  {t("footer.contact")}
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold mb-4">{t("footer.legal")}</h3>
            <ul className="space-y-2 text-sm text-gray-400">
              <li>
                <a href={pathHref(base, "/terms")} className="hover:text-white transition-colors">
                  {t("footer.terms")}
                </a>
              </li>
              <li>
                <a href={pathHref(base, "/privacy")} className="hover:text-white transition-colors">
                  {t("footer.privacy")}
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-gray-800 pt-8 text-sm text-gray-400 text-center">
          <p>{t("footer.copyright")}</p>
        </div>
      </div>
    </footer>
  );
}
