"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { LOCALES, isLocale, type Locale } from "@/lib/i18n/locales";
import {
  DEFAULT_PATH_LOCALE,
  isPathLocale,
  messagesLocaleToPath,
  pathLocaleToMessages,
  type PathLocale,
} from "@/lib/i18n/pathLocales";
import { Globe } from "lucide-react";

export function LanguageSwitcher({ className }: { className?: string }) {
  const rawLocale = useLocale();
  const locale: Locale = isLocale(rawLocale)
    ? rawLocale
    : isPathLocale(rawLocale)
      ? pathLocaleToMessages[rawLocale as PathLocale]
      : "en-US";
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const switchLocale = useCallback(
    (next: Locale) => {
      const nextPath = messagesLocaleToPath(next);
      document.cookie = `dd_locale=${next};path=/;max-age=31536000;samesite=lax`;

      const segments = pathname.split("/").filter(Boolean);
      const first = segments[0];

      if (first && isPathLocale(first)) {
        const rest = segments.slice(1).join("/");
        const prefix =
          nextPath === DEFAULT_PATH_LOCALE ? "" : `/${nextPath}`;
        const href = rest ? `${prefix}/${rest}` : prefix || "/";
        router.push(href);
        setOpen(false);
        return;
      }

      if (first && isLocale(first)) {
        const rest = segments.slice(1).join("/");
        const prefix =
          nextPath === DEFAULT_PATH_LOCALE ? "" : `/${nextPath}`;
        const href = rest ? `${prefix}/${rest}` : prefix || "/";
        router.push(href);
        setOpen(false);
        return;
      }

      const isMarketingHome = !first || pathname === "/";
      if (isMarketingHome) {
        router.push(nextPath === DEFAULT_PATH_LOCALE ? "/" : `/${nextPath}`);
      } else {
        router.refresh();
      }
      setOpen(false);
    },
    [pathname, router]
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
