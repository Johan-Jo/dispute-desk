// ─── BCP-47 Locale Registry ────────────────────────────────────────
// Single source of truth for all locale data across UI, DB, and i18n.

export const LOCALE_LIST = [
  "en-US",
  "de-DE",
  "fr-FR",
  "es-ES",
  "pt-BR",
  "sv-SE",
] as const;

export type Locale = (typeof LOCALE_LIST)[number];

export const DEFAULT_LOCALE: Locale = "en-US";

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
    locale: "en-US",
    language: "en",
    region: "US",
    label: "English (US)",
    nativeName: "English",
    short: "EN",
  },
  {
    locale: "de-DE",
    language: "de",
    region: "DE",
    label: "German",
    nativeName: "Deutsch",
    short: "DE",
  },
  {
    locale: "fr-FR",
    language: "fr",
    region: "FR",
    label: "French",
    nativeName: "Français",
    short: "FR",
  },
  {
    locale: "es-ES",
    language: "es",
    region: "ES",
    label: "Spanish",
    nativeName: "Español",
    short: "ES",
  },
  {
    locale: "pt-BR",
    language: "pt",
    region: "BR",
    label: "Portuguese (BR)",
    nativeName: "Português",
    short: "PT",
  },
  {
    locale: "sv-SE",
    language: "sv",
    region: "SE",
    label: "Swedish",
    nativeName: "Svenska",
    short: "SV",
  },
] as const;

const localeSet = new Set<string>(LOCALE_LIST);
const byLanguage = new Map<string, Locale>();
const byLocale = new Map<Locale, LocaleEntry>();

for (const entry of LOCALES) {
  byLocale.set(entry.locale, entry);
  if (!byLanguage.has(entry.language)) {
    byLanguage.set(entry.language, entry.locale);
  }
}

/** Type guard — checks if an arbitrary string is a supported BCP-47 locale. */
export function isLocale(value: string): value is Locale {
  return localeSet.has(value);
}

/**
 * Best-effort normalisation of freeform locale strings to a supported Locale.
 *
 * Handles: BCP-47 (en-US), underscore variants (pt_BR), bare language codes
 * (sv), and case variations.  Returns null when no reasonable match exists.
 */
export function normalizeLocale(input?: string | null): Locale | null {
  if (!input) return null;

  const trimmed = input.trim();
  if (!trimmed) return null;

  // Normalise separators and casing → "en-us", "pt-br", etc.
  const normalised = trimmed.replace(/_/g, "-");

  // Try exact match (case-insensitive)
  const exact = LOCALE_LIST.find(
    (l) => l.toLowerCase() === normalised.toLowerCase()
  );
  if (exact) return exact;

  // Extract the base language subtag
  const base = normalised.split("-")[0].toLowerCase();

  // Try base language match
  const fromBase = byLanguage.get(base);
  if (fromBase) return fromBase;

  return null;
}

/**
 * Multi-source locale resolution with cascading fallback:
 *   userLocale → shopLocale → shopifyLocale → en-US
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

/** Display metadata for a given locale (safe — returns en-US fallback). */
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
 * Maps a BCP-47 Locale to the legacy 2-letter code used by next-intl message
 * files during migration.  Once message files are renamed to BCP-47 this can
 * be removed.
 */
export function localeToLegacyCode(locale: Locale): string {
  const entry = byLocale.get(locale);
  return entry?.language ?? "en";
}
