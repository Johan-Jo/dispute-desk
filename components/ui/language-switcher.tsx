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
import { pathLocaleToHubLocale } from "@/lib/resources/localeMap";
import { isResourceHubPillar } from "@/lib/resources/pillars";
import { isMarketingIntlRoute } from "@/lib/i18n/marketingRoutes";
import { Globe } from "lucide-react";

/**
 * `/resources/{pillar}/{slug}` or `/{pathLocale}/resources/{pillar}/{slug}` for published hub articles.
 */
function parseResourceArticlePath(pathname: string): {
  pathLocale: PathLocale;
  pillar: string;
  slug: string;
} | null {
  const parts = pathname.split("/").filter(Boolean);
  if (
    parts.length === 3 &&
    parts[0] === "resources" &&
    isResourceHubPillar(parts[1]) &&
    parts[2].length > 0
  ) {
    return { pathLocale: "en", pillar: parts[1], slug: parts[2] };
  }
  if (
    parts.length === 4 &&
    isPathLocale(parts[0]) &&
    parts[1] === "resources" &&
    isResourceHubPillar(parts[2]) &&
    parts[3].length > 0
  ) {
    return { pathLocale: parts[0], pillar: parts[2], slug: parts[3] };
  }
  return null;
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
    async (next: Locale) => {
      document.cookie = `dd_locale=${next};path=/;max-age=31536000;samesite=lax`;

      if (!isMarketingIntlRoute(fullPathname)) {
        router.refresh();
        setOpen(false);
        return;
      }

      const search =
        typeof window !== "undefined" ? window.location.search : "";
      const nextPathLocale = messagesLocaleToPath(next);

      const resourceArticle = parseResourceArticlePath(fullPathname);
      if (resourceArticle) {
        const fromHub = pathLocaleToHubLocale(resourceArticle.pathLocale);
        const toHub = pathLocaleToHubLocale(nextPathLocale);
        if (fromHub !== toHub) {
          const qs = new URLSearchParams({
            pillar: resourceArticle.pillar,
            slug: resourceArticle.slug,
            from: fromHub,
            to: toHub,
          });
          try {
            const res = await fetch(
              `/api/public/resources/alternate-locale-slug?${qs.toString()}`
            );
            if (res.ok) {
              const body = (await res.json()) as { pillar: string; slug: string };
              intlRouter.replace(
                `/resources/${body.pillar}/${body.slug}${search}`,
                { locale: nextPathLocale }
              );
              setOpen(false);
              return;
            }
          } catch {
            /* fall through */
          }
          intlRouter.replace(`/resources${search}`, { locale: nextPathLocale });
          setOpen(false);
          return;
        }
      }

      const href = `${localizedPathname}${search}`;
      intlRouter.replace(href, { locale: nextPathLocale });
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
