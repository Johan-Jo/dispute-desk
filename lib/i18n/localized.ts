/**
 * Branded type for strings that have been resolved through the i18n
 * translator. Used at JSX leaf-renderer prop boundaries that consume
 * library-emitted copy — a raw string literal cannot satisfy the
 * `Localized` type, so the compiler enforces that the value arrived
 * through `resolveToken` or a direct translator call.
 */

export type Localized = string & { readonly __localized: unique symbol };

/** Internal constructor. Only `resolveToken` and direct `t()` calls in
 *  UI components should produce `Localized` values. */
export const asLocalized = (s: string): Localized => s as Localized;
