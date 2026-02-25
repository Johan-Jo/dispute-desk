export const SUPPORTED_LOCALES = ["en", "sv", "de", "fr", "es"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = "en";

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: "English",
  sv: "Svenska",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
};

export function isSupportedLocale(v: string): v is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(v);
}

/**
 * Resolve locale from possible sources: shop setting > header > default.
 */
export function resolveLocale(
  shopLocale?: string | null,
  acceptLang?: string | null
): SupportedLocale {
  if (shopLocale && isSupportedLocale(shopLocale)) return shopLocale;

  if (acceptLang) {
    const preferred = acceptLang.split(",").map((s) => s.split(";")[0].trim().slice(0, 2));
    for (const code of preferred) {
      if (isSupportedLocale(code)) return code;
    }
  }

  return DEFAULT_LOCALE;
}
