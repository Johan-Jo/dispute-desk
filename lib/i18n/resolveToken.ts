/**
 * Resolve an `I18nToken` to a `Localized` string using a *root*
 * translator (one returned by `useTranslations()` with no scope, or
 * `getTranslations({ locale })` server-side). Tokens encode absolute
 * key paths, so a scoped translator would mis-resolve them.
 *
 * Walks `I18nKeyParam` values first, then substitutes the resolved
 * inner strings into the outer template. This is the single helper
 * for token resolution — `useDisputeWorkspace.ts` (and any future
 * consumer) calls it instead of inlining its own resolution logic.
 */

import { asLocalized, type Localized } from "./localized";
import { isI18nKeyParam, type I18nPrimitive, type I18nToken } from "./token";

type AnyTranslator = (
  key: string,
  params?: Record<string, I18nPrimitive>,
) => string;

export function resolveToken(t: AnyTranslator, token: I18nToken): Localized {
  if (!token.params) return asLocalized(t(token.key));
  const resolvedParams: Record<string, I18nPrimitive> = {};
  for (const [k, v] of Object.entries(token.params)) {
    resolvedParams[k] = isI18nKeyParam(v) ? t(v.key, v.params) : v;
  }
  return asLocalized(t(token.key, resolvedParams));
}
