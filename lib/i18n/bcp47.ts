// ─── BCP-47 boundary shim ─────────────────────────────────────────
// Internal code uses short-code Locales (en, de, es, fr, pt, sv).
// External boundaries that expect BCP-47 — Shopify Accept-Language,
// Polaris locale switch, Intl.DateTimeFormat / NumberFormat, the
// HTML lang attribute when SEO/a11y matters, and email-template
// keys — call `toBcp47()` to get the regional form.

import { DEFAULT_LOCALE, isLocale, type Locale } from "./locales";

const SHORT_TO_BCP47: Record<Locale, string> = {
  en: "en-US",
  de: "de-DE",
  es: "es-ES",
  fr: "fr-FR",
  pt: "pt-BR",
  sv: "sv-SE",
};

/** Convert a canonical short-code Locale into its BCP-47 regional form. */
export function toBcp47(locale: Locale): string {
  return SHORT_TO_BCP47[locale];
}

/**
 * Convert any locale-ish string to BCP-47, defaulting to `en-US` if the input
 * isn't a recognized short-code Locale. Designed for the `useLocale()` →
 * `Intl.*` call sites where the string isn't typed as `Locale`.
 */
export function toBcp47Loose(input: string): string {
  return SHORT_TO_BCP47[isLocale(input) ? input : DEFAULT_LOCALE];
}
