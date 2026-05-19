import type { Locale } from "./locales";

/**
 * Load Polaris translations for the given short-code locale.
 * Polaris ships translations under @shopify/polaris/locales (mostly
 * by short code, with Portuguese keyed as `pt-BR` for historical reasons).
 */
export async function getPolarisTranslations(locale: Locale) {
  switch (locale) {
    case "sv":
      return (await import("@shopify/polaris/locales/sv.json")).default;
    case "de":
      return (await import("@shopify/polaris/locales/de.json")).default;
    case "fr":
      return (await import("@shopify/polaris/locales/fr.json")).default;
    case "es":
      return (await import("@shopify/polaris/locales/es.json")).default;
    case "pt":
      return (await import("@shopify/polaris/locales/pt-BR.json")).default;
    default:
      return (await import("@shopify/polaris/locales/en.json")).default;
  }
}
