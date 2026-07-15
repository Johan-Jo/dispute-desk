/**
 * safeDynamicT — the ONE correct way to resolve a dynamically-built i18n
 * key (`t(`${namespace}.${field}`)`-style lookups) without ever leaking a
 * raw key path into the UI.
 *
 * Why this exists (2026-07-15, dispute #C89276B6): next-intl does NOT
 * throw on a missing key — it returns the FULL key path including the
 * translator's namespace (e.g. a translator scoped to `disputes.whyText`
 * called with `"refund_record"` returns `"disputes.whyText.refund_record"`
 * on a miss). The codebase had grown four divergent hand-rolled guards,
 * each a different half-broken guess at that behaviour:
 *
 *   - `v === key`                  — never matches for SCOPED translators
 *                                    (the miss value is the full path, the
 *                                    compared key is the scoped suffix), so
 *                                    the raw path rendered in the UI
 *                                    (`disputes.whyText.refund_record`).
 *   - `v.startsWith("disputeTimeline.")` — hardcodes one namespace; silently
 *                                    wrong the moment it's copy-pasted next
 *                                    to a different namespace.
 *   - bare try/catch               — dead code; next-intl doesn't throw.
 *
 * The correct API is the translator's own `.has(key)` — it answers "does
 * this key exist in the loaded messages" for both scoped and root
 * translators. This helper uses it, with a defensive string check for
 * translator-like callables that lack `.has`.
 *
 * Use this for EVERY dynamic key lookup. Do not hand-roll another guard.
 * (Static keys known at compile time don't need it — a missing static key
 * is caught by scripts/verify-i18n-parity.mjs at build time.)
 */

/** Minimal structural type satisfied by next-intl's `useTranslations()` /
 *  `getTranslations()` return values. */
export interface DynamicTranslator {
  (key: string): string;
  has?: (key: string) => boolean;
}

/**
 * Resolve `key` via `t`, returning `fallback` when the key doesn't exist.
 *
 * @param t        a next-intl translator (root- or namespace-scoped)
 * @param key      the dynamic key relative to the translator's scope
 * @param fallback returned when the key is missing (default "")
 */
export function safeDynamicT(
  t: DynamicTranslator,
  key: string,
  fallback = "",
): string {
  try {
    // Primary: the translator knows authoritatively whether the key exists.
    if (typeof t.has === "function") {
      return t.has(key) ? t(key) : fallback;
    }
    // Defensive path for translator-like callables without `.has`:
    // a miss echoes the key path back — either exactly (root translator)
    // or as a namespace-prefixed suffix (scoped translator).
    const v = t(key);
    if (v === key || v.endsWith(`.${key}`)) return fallback;
    return v;
  } catch {
    return fallback;
  }
}
