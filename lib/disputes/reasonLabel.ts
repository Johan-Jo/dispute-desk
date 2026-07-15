/**
 * Canonical dispute-reason casing + label resolution.
 *
 * Shopify hands us the dispute reason in two different casings depending on
 * the transport:
 *   - REST webhook (disputes/create, disputes/update): lowercase snake_case,
 *     e.g. `credit_not_processed`.
 *   - GraphQL (`reasonDetails.reason`): UPPERCASE enum, e.g.
 *     `CREDIT_NOT_PROCESSED`.
 *
 * Everything downstream — the `packs.disputeTypeLabel.*` i18n map, the reason
 * families, the network-reason-code mapper — keys off the UPPERCASE enum. A
 * lowercase reason therefore silently missed every lookup: the label render
 * sites fell through to next-intl's default missing-key behaviour and printed
 * the raw key (`packs.disputeTypeLabel.credit_not_processed`) into the UI.
 *
 * `normalizeDisputeReasonKey` is the single canonicaliser: it upper-cases and
 * collapses whitespace to underscores so both transports converge on the same
 * enum value. The disputeSnapshot normalizers call it so the stored
 * `disputes.reason` is always canonical; the render helpers below call it
 * again defensively so any legacy lowercase rows already in the DB still
 * resolve.
 */

import { safeDynamicT } from "@/lib/i18n/safeDynamicT";

/**
 * Canonicalise a raw Shopify dispute reason to the UPPERCASE enum form used
 * by `packs.disputeTypeLabel.*`, the reason families, and the network-reason
 * mapper. Null/empty → "GENERAL" (the catch-all family).
 */
export function normalizeDisputeReasonKey(reason: string | null | undefined): string {
  const trimmed = reason?.trim();
  if (!trimmed) return "GENERAL";
  return trimmed.toUpperCase().replace(/\s+/g, "_");
}

/**
 * Resolve a dispute reason to its localized label via the `disputeTypeLabel.*`
 * namespace, with a human-readable fallback when the key is unknown.
 *
 * next-intl does NOT throw on a missing key — it returns the key path string.
 * Miss detection is delegated to the shared `safeDynamicT` helper; on a miss
 * we fall back to a title-cased version of the reason instead.
 *
 * @param tPacks a translator scoped to the `packs` namespace (from
 *   `useTranslations("packs")` / `getTranslations("packs")`).
 */
export function resolveDisputeTypeLabel(
  tPacks: (key: string) => string,
  reason: string | null | undefined,
): string {
  const key = normalizeDisputeReasonKey(reason);
  // key is UPPERCASE_SNAKE — lowercase first, then Title Case each word so
  // the miss-fallback reads "Some Unmapped Reason", not "SOME UNMAPPED REASON".
  const fallback = key
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return safeDynamicT(tPacks, `disputeTypeLabel.${key}`, fallback);
}
