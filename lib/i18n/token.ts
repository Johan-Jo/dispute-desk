/**
 * Canonical i18n token contract used across the codebase.
 *
 * Library code (`lib/**`) and persisted data (`pack_json`) reference
 * user-facing copy as `I18nToken`s — never as resolved English. UI
 * components resolve tokens through `resolveToken` at the leaf JSX
 * boundary, producing branded `Localized` strings.
 *
 * Nested-key params: a param may itself be a translation key
 * (`I18nKeyParam`), which the resolver looks up first and then
 * substitutes into the outer message template. This is the load-bearing
 * shape for sentences like "{primary} and {secondary} support this
 * defense" where the labels themselves are translated. The
 * `type: "i18n-key"` discriminator prevents a future developer from
 * passing a literal string that happens to look like a key and
 * wondering why it renders as the raw key path.
 */

export type I18nKey = string;

export type I18nPrimitive = string | number;

/** A param that is itself an i18n key — the resolver looks it up
 *  before substituting into the outer template. Inner params are
 *  primitives only (one level of resolution is sufficient for every
 *  message in this codebase). */
export type I18nKeyParam = {
  type: "i18n-key";
  key: I18nKey;
  params?: Record<string, I18nPrimitive>;
};

export type I18nTokenParam = I18nPrimitive | I18nKeyParam;

export type I18nToken = {
  key: I18nKey;
  params?: Record<string, I18nTokenParam>;
};

/** Type guard for the I18nKeyParam discriminator. */
export const isI18nKeyParam = (v: I18nTokenParam): v is I18nKeyParam =>
  typeof v === "object" && v !== null && (v as I18nKeyParam).type === "i18n-key";
