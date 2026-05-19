import { type Locale, DEFAULT_LOCALE, isLocale } from "./locales";

/**
 * Load messages for a short-code locale (en / de / es / fr / pt / sv).
 * Falls back to `en` if the locale file is missing.
 */
export async function getMessages(
  locale: string
): Promise<Record<string, unknown>> {
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;

  try {
    return (await import(`@/messages/${resolved}.json`)).default;
  } catch {
    return (await import(`@/messages/en.json`)).default;
  }
}
