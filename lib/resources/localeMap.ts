import type { PathLocale } from "@/lib/i18n/pathLocales";
import type { HubContentLocale } from "./constants";

/**
 * Map next-intl path segment → Resources Hub DB locale. The hub still
 * stores BCP-47 (en-US, de-DE, …) in `content_localizations.locale` —
 * that's a persisted database value, not a UI/runtime one, so it stays
 * untouched while the app-side Locale type uses short codes.
 */
const PATH_TO_HUB: Record<PathLocale, HubContentLocale> = {
  en: "en-US",
  de: "de-DE",
  fr: "fr-FR",
  es: "es-ES",
  pt: "pt-BR",
  sv: "sv-SE",
};

const HUB_TO_PATH: Record<HubContentLocale, PathLocale> = {
  "en-US": "en",
  "de-DE": "de",
  "fr-FR": "fr",
  "es-ES": "es",
  "pt-BR": "pt",
  "sv-SE": "sv",
};

export function pathLocaleToHubLocale(pathLocale: PathLocale): HubContentLocale {
  return PATH_TO_HUB[pathLocale];
}

export function hubLocaleToPathSegment(locale: HubContentLocale): PathLocale {
  return HUB_TO_PATH[locale];
}
