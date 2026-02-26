import type { Locale } from "./locales";

/**
 * Load Polaris translations for the given BCP-47 locale.
 * Polaris ships translations under @shopify/polaris/locales.
 */
export async function getPolarisTranslations(locale: Locale) {
  switch (locale) {
    case "sv-SE":
      return (await import("@shopify/polaris/locales/sv.json")).default;
    case "de-DE":
      return (await import("@shopify/polaris/locales/de.json")).default;
    case "fr-FR":
      return (await import("@shopify/polaris/locales/fr.json")).default;
    case "es-ES":
      return (await import("@shopify/polaris/locales/es.json")).default;
    case "pt-BR":
      return (await import("@shopify/polaris/locales/pt-BR.json")).default;
    default:
      return (await import("@shopify/polaris/locales/en.json")).default;
  }
}
