import { SupportedLocale, DEFAULT_LOCALE, isSupportedLocale } from "./config";

/**
 * Load messages for a given locale. Falls back to English.
 */
export async function getMessages(locale: string): Promise<Record<string, unknown>> {
  const resolved: SupportedLocale = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
  try {
    return (await import(`@/messages/${resolved}.json`)).default;
  } catch {
    return (await import(`@/messages/en.json`)).default;
  }
}
