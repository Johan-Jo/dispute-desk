/**
 * Resolve an `I18nToken` to a `Localized` string using a *root*
 * translator (one returned by `useTranslations()` with no scope, or
 * `getTranslations({ locale })` server-side). Tokens encode absolute
 * key paths, so a scoped translator would mis-resolve them.
 *
 * Walks `I18nKeyParam` values first (recursively: a key param may itself carry
 * key params), then substitutes the resolved inner strings into the outer
 * template. This is the single helper for token resolution —
 * `useDisputeWorkspace.ts` (and any future consumer) calls it instead of
 * inlining its own resolution logic.
 */

import { asLocalized, type Localized } from "./localized";
import { isI18nKeyParam, type I18nKeyParam, type I18nPrimitive, type I18nToken } from "./token";

type AnyTranslator = (
  key: string,
  params?: Record<string, I18nPrimitive>,
) => string;

function resolveParams(
  t: AnyTranslator,
  params: Record<string, I18nPrimitive | I18nKeyParam>,
): Record<string, I18nPrimitive> {
  const resolved: Record<string, I18nPrimitive> = {};
  for (const [k, v] of Object.entries(params)) {
    resolved[k] = isI18nKeyParam(v) ? t(v.key, v.params ? resolveParams(t, v.params) : undefined) : v;
  }
  return resolved;
}

export function resolveToken(t: AnyTranslator, token: I18nToken): Localized {
  if (!token.params) return asLocalized(t(token.key));
  return asLocalized(t(token.key, resolveParams(t, token.params)));
}
