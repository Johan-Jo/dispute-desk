"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  CONSENT_VALUE_ANALYTICS,
  CONSENT_VALUE_ESSENTIAL,
} from "@/lib/consent/constants";
import {
  grantAnalyticsConsentViaGtag,
  persistConsent,
  readStoredConsent,
} from "@/lib/consent/client";

/**
 * Marketing-site only (mounted from `app/[locale]/layout.tsx`).
 */
export function CookieConsentBar() {
  const t = useTranslations("consent");
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const existing = readStoredConsent();
    setOpen(existing === null);
    setReady(true);
  }, []);

  const acceptAnalytics = () => {
    persistConsent(CONSENT_VALUE_ANALYTICS);
    grantAnalyticsConsentViaGtag();
    setOpen(false);
  };

  const essentialOnly = () => {
    persistConsent(CONSENT_VALUE_ESSENTIAL);
    setOpen(false);
  };

  if (!ready || !open) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[100] border-t border-slate-200/80 bg-white/95 px-4 py-3 shadow-[0_-4px_24px_rgba(15,23,42,0.06)] backdrop-blur-sm supports-[backdrop-filter]:bg-white/90"
      role="dialog"
      aria-label={t("ariaLabel")}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <p className="text-center text-xs leading-relaxed text-slate-600 sm:text-left">
          {t("message")}{" "}
          <Link href="/privacy" className="font-medium text-slate-800 underline underline-offset-2 hover:text-slate-950">
            {t("privacy")}
          </Link>
        </p>
        <div className="flex flex-shrink-0 flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={essentialOnly}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
          >
            {t("essentialOnly")}
          </button>
          <button
            type="button"
            onClick={acceptAnalytics}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800"
          >
            {t("accept")}
          </button>
        </div>
      </div>
    </div>
  );
}
