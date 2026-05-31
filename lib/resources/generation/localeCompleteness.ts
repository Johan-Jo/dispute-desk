/**
 * Partial-locale publish guard.
 *
 * A hub article is one content_item with up to all HUB_CONTENT_LOCALES
 * localizations sharing it (hreflang/language-switcher link siblings via the
 * shared content_item_id). When the generation pipeline produces only a subset
 * of locales (some were rejected by the validators), publishing the successful
 * subset ships a half-localized article with a broken language switcher.
 *
 * This predicate decides whether such an item must be held for human review
 * instead of auto-published. It is pure (no side effects, type-only import) so
 * it can be unit-tested without the Supabase/OpenAI surface of pipeline.ts.
 */
export function shouldHoldForIncompleteLocales(
  results: ReadonlyArray<{ content: unknown | null }>
): boolean {
  if (results.length === 0) return true;
  return results.some((r) => r.content === null);
}
