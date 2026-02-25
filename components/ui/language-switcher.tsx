"use client";

import { useState, useRef, useEffect } from "react";
import { useLocale } from "next-intl";
import { SUPPORTED_LOCALES, LOCALE_LABELS, type SupportedLocale } from "@/lib/i18n/config";
import { Globe } from "lucide-react";

const FLAG_EMOJI: Record<SupportedLocale, string> = {
  en: "\uD83C\uDDFA\uD83C\uDDF8",
  sv: "\uD83C\uDDF8\uD83C\uDDEA",
  de: "\uD83C\uDDE9\uD83C\uDDEA",
  fr: "\uD83C\uDDEB\uD83C\uDDF7",
  es: "\uD83C\uDDEA\uD83C\uDDF8",
  pt: "\uD83C\uDDE7\uD83C\uDDF7",
};

export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale() as SupportedLocale;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function switchLocale(next: SupportedLocale) {
    document.cookie = `dd_locale=${next};path=/;max-age=31536000;samesite=lax`;
    setOpen(false);
    window.location.reload();
  }

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-sm text-[#64748B] hover:text-[#0B1220] transition-colors px-2 py-1 rounded-md hover:bg-[#F6F8FB]"
        aria-label="Change language"
      >
        <Globe className="w-4 h-4" />
        <span>{FLAG_EMOJI[locale]}</span>
        <span className="hidden sm:inline">{LOCALE_LABELS[locale]}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white rounded-lg border border-[#E5E7EB] shadow-lg py-1 z-50 min-w-[160px]">
          {SUPPORTED_LOCALES.map((code) => (
            <button
              key={code}
              onClick={() => switchLocale(code)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                code === locale
                  ? "bg-[#EFF6FF] text-[#1D4ED8] font-medium"
                  : "text-[#64748B] hover:bg-[#F6F8FB] hover:text-[#0B1220]"
              }`}
            >
              <span>{FLAG_EMOJI[code]}</span>
              <span>{LOCALE_LABELS[code]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
