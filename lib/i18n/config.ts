// ─── Legacy re-exports ─────────────────────────────────────────────
// All locale logic now lives in ./locales.ts.
// This file re-exports for backward compatibility during migration.

export {
  LOCALE_LIST as SUPPORTED_LOCALES,
  type Locale as SupportedLocale,
  DEFAULT_LOCALE,
  isLocale as isSupportedLocale,
  resolveLocale,
  LOCALES,
  getLocaleDisplay,
  normalizeLocale,
} from "./locales";
