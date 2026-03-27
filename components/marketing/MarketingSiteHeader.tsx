"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, Shield, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import { Link } from "@/i18n/navigation";
import {
  isPathLocale,
  marketingHomePath,
  pathLocaleToMessages,
  type PathLocale,
} from "@/lib/i18n/pathLocales";
import { MARKETING_PAGE_CONTAINER_CLASS } from "@/lib/marketing/pageContainer";

function useMarketingHomeHref(): string {
  const raw = useLocale();
  const pathLocale: PathLocale = isPathLocale(raw) ? raw : "en";
  return marketingHomePath(pathLocaleToMessages[pathLocale]);
}

const NAV_BASE = "text-sm transition-colors";
const NAV_IDLE = `${NAV_BASE} text-[#64748B] hover:text-[#0B1220]`;
const NAV_ACTIVE = `${NAV_BASE} text-[#1D4ED8] font-semibold`;

function useActiveSection(): string | null {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const stripped = isPathLocale(segments[0]) ? segments.slice(1) : segments;
  if (stripped[0] === "resources" || stripped[0] === "templates" || stripped[0] === "case-studies" || stripped[0] === "glossary") {
    return "resources";
  }
  return null;
}

export function MarketingSiteHeader() {
  const t = useTranslations("marketing");
  const [mobileNav, setMobileNav] = useState(false);
  const home = useMarketingHomeHref();
  const activeSection = useActiveSection();

  return (
    <header className="border-b border-[#E5E7EB] sticky top-0 bg-white z-50">
      <div
        className={`${MARKETING_PAGE_CONTAINER_CLASS} h-16 flex items-center justify-between`}
      >
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <div className="w-8 h-8 bg-[#1D4ED8] rounded-lg flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold text-[#0B1220]">DisputeDesk</span>
        </Link>

        <nav className="hidden md:flex items-center gap-8">
          <Link
            href="/resources"
            className={activeSection === "resources" ? NAV_ACTIVE : NAV_IDLE}
          >
            {t("nav.resources")}
          </Link>
          <a href={`${home}#how-it-works`} className={NAV_IDLE}>
            {t("nav.product")}
          </a>
          <a href={`${home}#how-it-works`} className={NAV_IDLE}>
            {t("nav.howItWorks")}
          </a>
          <a href={`${home}#security`} className={NAV_IDLE}>
            {t("nav.security")}
          </a>
          <a href={`${home}#pricing`} className={NAV_IDLE}>
            {t("nav.pricing")}
          </a>
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <LanguageSwitcher />
          <a href="/auth/sign-in" className="hidden sm:block">
            <Button variant="ghost" size="sm">
              {t("nav.signIn")}
            </Button>
          </a>
          <a href="/portal/connect-shopify" className="hidden sm:block">
            <Button variant="primary" size="sm">
              {t("nav.installOnShopify")}
            </Button>
          </a>
          <button
            type="button"
            onClick={() => setMobileNav(!mobileNav)}
            className="md:hidden w-10 h-10 flex items-center justify-center rounded-lg hover:bg-[#F1F5F9] text-[#64748B]"
            aria-expanded={mobileNav}
            aria-label={mobileNav ? "Close menu" : "Open menu"}
          >
            {mobileNav ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {mobileNav ? (
        <div className={`md:hidden border-t border-[#E5E7EB] bg-white py-4 space-y-3 ${MARKETING_PAGE_CONTAINER_CLASS}`}>
          <Link
            href="/resources"
            onClick={() => setMobileNav(false)}
            className={`block py-2 ${activeSection === "resources" ? NAV_ACTIVE : NAV_IDLE}`}
          >
            {t("nav.resources")}
          </Link>
          <a
            href={`${home}#how-it-works`}
            onClick={() => setMobileNav(false)}
            className={`block py-2 ${NAV_IDLE}`}
          >
            {t("nav.product")}
          </a>
          <a
            href={`${home}#how-it-works`}
            onClick={() => setMobileNav(false)}
            className={`block py-2 ${NAV_IDLE}`}
          >
            {t("nav.howItWorks")}
          </a>
          <a
            href={`${home}#security`}
            onClick={() => setMobileNav(false)}
            className={`block py-2 ${NAV_IDLE}`}
          >
            {t("nav.security")}
          </a>
          <a
            href={`${home}#pricing`}
            onClick={() => setMobileNav(false)}
            className={`block py-2 ${NAV_IDLE}`}
          >
            {t("nav.pricing")}
          </a>
          <div className="pt-3 border-t border-[#E5E7EB] flex flex-col gap-2">
            <a href="/auth/sign-in">
              <Button variant="ghost" size="sm" className="w-full">
                {t("nav.signIn")}
              </Button>
            </a>
            <a href="/portal/connect-shopify">
              <Button variant="primary" size="sm" className="w-full">
                {t("nav.installOnShopify")}
              </Button>
            </a>
          </div>
        </div>
      ) : null}
    </header>
  );
}
