import type { PathLocale } from "@/lib/i18n/pathLocales";
import { pathLocaleToMessages } from "@/lib/i18n/pathLocales";
import type { HubContentLocale } from "./constants";

/**
 * Map next-intl path segment → Resources Hub DB locale.
 * Portuguese path `pt` uses pt-PT in CMS (per product spec); app i18n may still use pt-BR messages.
 */
export function pathLocaleToHubLocale(pathLocale: PathLocale): HubContentLocale {
  if (pathLocale === "pt") return "pt-PT";
  return pathLocaleToMessages[pathLocale] as HubContentLocale;
}

export function hubLocaleToPathSegment(locale: HubContentLocale): PathLocale {
  const map: Record<HubContentLocale, PathLocale> = {
    "en-US": "en",
    "de-DE": "de",
    "fr-FR": "fr",
    "es-ES": "es",
    "pt-PT": "pt",
    "sv-SE": "sv",
  };
  return map[locale];
}
