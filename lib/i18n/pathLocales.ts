import type { Locale } from "./locales";

/** Two-letter URL segments for marketing (next-intl routing). Default `en` is omitted from paths. */
export const PATH_LOCALE_LIST = ["en", "de", "es", "fr", "pt", "sv"] as const;

export type PathLocale = (typeof PATH_LOCALE_LIST)[number];

export const DEFAULT_PATH_LOCALE: PathLocale = "en";

const pathLocaleSet = new Set<string>(PATH_LOCALE_LIST);

/** Path segments that appear in URLs (excludes default `en`). */
export const PATH_LOCALES_WITH_PREFIX = [
  "de",
  "es",
  "fr",
  "pt",
  "sv",
] as const;

/** Regex fragment for middleware: first segment when locale is prefixed. */
export const PATH_LOCALE_PREFIX_PATTERN =
  PATH_LOCALES_WITH_PREFIX.join("|");

export const pathLocaleToMessages: Record<PathLocale, Locale> = {
  en: "en-US",
  de: "de-DE",
  es: "es-ES",
  fr: "fr-FR",
  pt: "pt-BR",
  sv: "sv-SE",
};

const messagesToPath = new Map<Locale, PathLocale>(
  (Object.entries(pathLocaleToMessages) as [PathLocale, Locale][]).map(
    ([path, msg]) => [msg, path]
  )
);

export function isPathLocale(value: string): value is PathLocale {
  return pathLocaleSet.has(value);
}

export function messagesLocaleToPath(messagesLocale: Locale): PathLocale {
  return messagesToPath.get(messagesLocale) ?? DEFAULT_PATH_LOCALE;
}

/** Marketing home path for this messages locale: `/` for English, `/de`, etc. */
export function marketingHomePath(messagesLocale: Locale): string {
  const path = messagesLocaleToPath(messagesLocale);
  return path === DEFAULT_PATH_LOCALE ? "/" : `/${path}`;
}
