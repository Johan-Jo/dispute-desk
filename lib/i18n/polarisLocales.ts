import type { SupportedLocale } from "./config";

/**
 * Load Polaris translations for the given locale.
 * Polaris ships translations for many locales under @shopify/polaris/locales.
 */
export async function getPolarisTranslations(locale: SupportedLocale) {
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
