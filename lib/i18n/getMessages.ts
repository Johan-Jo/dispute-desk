import { type Locale, DEFAULT_LOCALE, isLocale } from "./locales";

/**
 * Load messages for a short-code locale (en / de / es / fr / pt / sv).
 *
 * The legacy silent en.json fallback was removed in the structural-i18n
 * migration (2026-05-24). The locale-parity guardrail
 * (scripts/verify-i18n-parity.mjs) is wired into release verification
 * so every leaf key present in en.json is also present in the other
 * five locale files — a missing locale file is a deploy bug, not a
 * runtime fallback path. An unknown locale string still normalizes to
 * the default before the import resolves.
 */
export async function getMessages(
  locale: string
): Promise<Record<string, unknown>> {
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return (await import(`@/messages/${resolved}.json`)).default;
}
