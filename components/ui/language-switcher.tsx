"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname as useFullPathname, useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { LOCALES, isLocale, type Locale } from "@/lib/i18n/locales";
import {
  isPathLocale,
  messagesLocaleToPath,
  pathLocaleToMessages,
  type PathLocale,
} from "@/lib/i18n/pathLocales";
import { usePathname as useLocalizedPathname, useRouter as useIntlRouter } from "@/i18n/navigation";
import { Globe } from "lucide-react";

const HUB_PREFIXES = [
  "resources",
  "templates",
  "case-studies",
  "glossary",
  "blog",
] as const;

/** Routes that use next-intl locale prefixes (`/`, `/resources`, `/sv`, …). */
function isMarketingIntlRoute(pathname: string): boolean {
  if (
    pathname.startsWith("/portal") ||
    pathname.startsWith("/app") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/auth")
  ) {
    return false;
  }
  if (pathname.startsWith("/api")) return false;
  if (pathname === "/") return true;
  const seg = pathname.split("/").filter(Boolean)[0];
  if (!seg) return true;
  if (isPathLocale(seg)) return true;
  return (HUB_PREFIXES as readonly string[]).includes(seg);
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const rawLocale = useLocale();
  const locale: Locale = isLocale(rawLocale)
    ? rawLocale
    : isPathLocale(rawLocale)
      ? pathLocaleToMessages[rawLocale as PathLocale]
      : "en-US";
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fullPathname = useFullPathname();
  const localizedPathname = useLocalizedPathname();
  const router = useRouter();
  const intlRouter = useIntlRouter();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const switchLocale = useCallback(
    (next: Locale) => {
      document.cookie = `dd_locale=${next};path=/;max-age=31536000;samesite=lax`;

      if (!isMarketingIntlRoute(fullPathname)) {
        router.refresh();
        setOpen(false);
        return;
      }

      const search =
        typeof window !== "undefined" ? window.location.search : "";
      const href = `${localizedPathname}${search}`;
      intlRouter.replace(href, { locale: messagesLocaleToPath(next) });
      setOpen(false);
    },
    [fullPathname, intlRouter, localizedPathname, router]
  );

  const current = LOCALES.find((l) => l.locale === locale) ?? LOCALES[0];

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-sm text-[#64748B] hover:text-[#0B1220] transition-colors px-2 py-1 rounded-md hover:bg-[#F6F8FB]"
        aria-label="Change language"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <Globe className="w-4 h-4" />
        <span className="hidden sm:inline">{current.nativeName}</span>
        <span className="text-xs text-[#94A3B8] hidden sm:inline">
          {current.short}
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Select language"
          className="absolute right-0 top-full mt-1 bg-white rounded-lg border border-[#E5E7EB] shadow-lg py-1 z-50 min-w-[180px]"
        >
          {LOCALES.map((entry) => (
            <button
              key={entry.locale}
              role="option"
              aria-selected={entry.locale === locale}
              onClick={() => switchLocale(entry.locale)}
              className={`w-full flex items-center justify-between gap-2.5 px-3 py-2 text-sm transition-colors ${
                entry.locale === locale
                  ? "bg-[#EFF6FF] text-[#1D4ED8] font-medium"
                  : "text-[#64748B] hover:bg-[#F6F8FB] hover:text-[#0B1220]"
              }`}
            >
              <span>{entry.nativeName}</span>
              <span className="text-xs text-[#94A3B8]">{entry.short}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
