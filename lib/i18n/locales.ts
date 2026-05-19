// ─── Locale Registry ──────────────────────────────────────────────
// Canonical Locale is the 2-letter short code (en, de, es, fr, pt, sv).
// External systems that need BCP-47 (Shopify Accept-Language, Intl.*,
// Polaris locale switch, email templates) convert via `toBcp47()` in
// `./bcp47.ts`. Internal code — including next-intl message loading —
// uses short codes exclusively.

export const LOCALE_LIST = [
  "en",
  "de",
  "fr",
  "es",
  "pt",
  "sv",
] as const;

export type Locale = (typeof LOCALE_LIST)[number];

export const DEFAULT_LOCALE: Locale = "en";

export interface LocaleEntry {
  locale: Locale;
  language: string;
  region: string;
  label: string;
  nativeName: string;
  short: string;
}

export const LOCALES: readonly LocaleEntry[] = [
  {
    locale: "en",
    language: "en",
    region: "US",
    label: "English (US)",
    nativeName: "English",
    short: "EN",
  },
  {
    locale: "de",
    language: "de",
    region: "DE",
    label: "German",
    nativeName: "Deutsch",
    short: "DE",
  },
  {
    locale: "fr",
    language: "fr",
    region: "FR",
    label: "French",
    nativeName: "Français",
    short: "FR",
  },
  {
    locale: "es",
    language: "es",
    region: "ES",
    label: "Spanish",
    nativeName: "Español",
    short: "ES",
  },
  {
    locale: "pt",
    language: "pt",
    region: "BR",
    label: "Portuguese (BR)",
    nativeName: "Português",
    short: "PT",
  },
  {
    locale: "sv",
    language: "sv",
    region: "SE",
    label: "Swedish",
    nativeName: "Svenska",
    short: "SV",
  },
] as const;

const localeSet = new Set<string>(LOCALE_LIST);
const byLocale = new Map<Locale, LocaleEntry>();

for (const entry of LOCALES) {
  byLocale.set(entry.locale, entry);
}

/** Map BCP-47 inputs (en-US, de-DE, …) to their canonical short code. */
const BCP47_TO_SHORT: Record<string, Locale> = {
  "en-us": "en",
  "en-gb": "en",
  en: "en",
  "de-de": "de",
  "de-at": "de",
  "de-ch": "de",
  de: "de",
  "fr-fr": "fr",
  "fr-ca": "fr",
  fr: "fr",
  "es-es": "es",
  "es-mx": "es",
  "es-ar": "es",
  es: "es",
  "pt-br": "pt",
  "pt-pt": "pt",
  pt: "pt",
  "sv-se": "sv",
  sv: "sv",
};

/** Type guard — checks if an arbitrary string is a supported short-code Locale. */
export function isLocale(value: string): value is Locale {
  return localeSet.has(value);
}

/**
 * Best-effort normalisation of freeform locale strings to a supported Locale.
 *
 * Accepts BCP-47 (en-US, pt_BR), underscore variants, bare language codes,
 * and case variations. Always returns a short-code Locale (en, de, es, fr,
 * pt, sv) or null if no reasonable match exists.
 */
export function normalizeLocale(input?: string | null): Locale | null {
  if (!input) return null;

  const trimmed = input.trim();
  if (!trimmed) return null;

  const normalised = trimmed.replace(/_/g, "-").toLowerCase();

  // Direct short-code match
  if (localeSet.has(normalised)) return normalised as Locale;

  // BCP-47 → short map
  const mapped = BCP47_TO_SHORT[normalised];
  if (mapped) return mapped;

  // Last resort: take the base subtag (en-XX → en) and try again
  const base = normalised.split("-")[0];
  if (localeSet.has(base)) return base as Locale;

  return null;
}

/**
 * Multi-source locale resolution with cascading fallback:
 *   userLocale → shopLocale → shopifyLocale → en
 */
export function resolveLocale({
  userLocale,
  shopLocale,
  shopifyLocale,
}: {
  userLocale?: string | null;
  shopLocale?: string | null;
  shopifyLocale?: string | null;
}): Locale {
  return (
    normalizeLocale(userLocale) ??
    normalizeLocale(shopLocale) ??
    normalizeLocale(shopifyLocale) ??
    DEFAULT_LOCALE
  );
}

/** Display metadata for a given locale (safe — returns en fallback). */
export function getLocaleDisplay(locale: Locale): {
  label: string;
  nativeName: string;
  short: string;
} {
  const entry = byLocale.get(locale) ?? byLocale.get(DEFAULT_LOCALE)!;
  return {
    label: entry.label,
    nativeName: entry.nativeName,
    short: entry.short,
  };
}

/**
 * Historical helper from the BCP-47 → short-code migration. Locale is now
 * already a short code, so this is an identity function. Kept exported so
 * external callers don't break; safe to delete in a future cleanup.
 */
export function localeToLegacyCode(locale: Locale): string {
  return locale;
}
