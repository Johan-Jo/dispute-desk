import { defineRouting } from "next-intl/routing";
import {
  DEFAULT_PATH_LOCALE,
  PATH_LOCALE_LIST,
  type PathLocale,
} from "@/lib/i18n/pathLocales";

/** Two-letter segments: `/` = English, `/de`, `/es`, … */
export const marketingPathLocales = [...PATH_LOCALE_LIST] as readonly PathLocale[];

export const routing = defineRouting({
  locales: marketingPathLocales,
  defaultLocale: DEFAULT_PATH_LOCALE,
  localePrefix: "as-needed",
  // Disable the auto-generated `Link: rel=alternate; hreflang=…` response header.
  // next-intl emits path-identical alternates for every locale, but our Resources
  // Hub slugs differ per locale (e.g. DE article has a different slug than ES).
  // Those bogus alternates make Google crawl redirecting URLs. The sitemap already
  // publishes correct per-locale hreflangs via `alternates.languages`.
  alternateLinks: false,
});
