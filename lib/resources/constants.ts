/** BCP-47 locales stored in content_localizations.locale */
export const HUB_CONTENT_LOCALES = [
  "en-US",
  "de-DE",
  "fr-FR",
  "es-ES",
  "pt-PT",
  "sv-SE",
] as const;

export type HubContentLocale = (typeof HUB_CONTENT_LOCALES)[number];

/** First URL segment for unprefixed paths that must use next-intl middleware */
export const HUB_PUBLIC_PREFIXES = [
  "resources",
  "templates",
  "case-studies",
  "glossary",
  "blog",
] as const;
