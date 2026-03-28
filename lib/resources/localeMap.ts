import type { PathLocale } from "@/lib/i18n/pathLocales";
import { pathLocaleToMessages } from "@/lib/i18n/pathLocales";
import type { HubContentLocale } from "./constants";

/**
 * Map next-intl path segment → Resources Hub DB locale (same BCP-47 tags as `pathLocaleToMessages`).
 */
export function pathLocaleToHubLocale(pathLocale: PathLocale): HubContentLocale {
  return pathLocaleToMessages[pathLocale] as HubContentLocale;
}

export function hubLocaleToPathSegment(locale: HubContentLocale): PathLocale {
  const map: Record<HubContentLocale, PathLocale> = {
    "en-US": "en",
    "de-DE": "de",
    "fr-FR": "fr",
    "es-ES": "es",
    "pt-BR": "pt",
    "sv-SE": "sv",
  };
  return map[locale];
}
