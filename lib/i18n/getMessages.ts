import { type Locale, DEFAULT_LOCALE, isLocale } from "./locales";

/**
 * Load messages for a BCP-47 locale.
 * Falls back to en-US if the locale file is missing.
 */
export async function getMessages(
  locale: string
): Promise<Record<string, unknown>> {
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;

  try {
    return (await import(`@/messages/${resolved}.json`)).default;
  } catch {
    return (await import(`@/messages/en-US.json`)).default;
  }
}
