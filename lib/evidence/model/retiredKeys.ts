/**
 * Retired collector payload keys.
 *
 * A retired key is one a collector USED to write and no longer writes, whose
 * recorded value must never again be interpreted as evidence. It is not an
 * accidental unregistered field and it is not a live signal — it is a fact of
 * history that survives in immutable `pack_json`.
 *
 * WHY THIS EXISTS (PR-C1). `deliveredToVerifiedAddress` and
 * `collectedByCustomer` each upgraded a `delivered_confirmed` shipment to
 * STRONG and licensed an issuer-facing "delivered to the verified address"
 * assertion. Neither was substantiated:
 *
 *   - `deliveredToVerifiedAddress` was derived from `shippedToVerifiedAddress`,
 *     which compared Shopify's own billing and shipping addresses on city and
 *     country. Two merchant-held addresses. No AVS result was read at any
 *     point, so the Visa CE-chart Item 3 remedy it purported to satisfy
 *     ("delivered to the same physical address for which the Merchant received
 *     a qualifying AVS match — see register R-E and the canonical cells in
 *     `lib/argument/avsCodeMap.ts`) had no AVS input at all.
 *   - `collectedByCustomer` was set from a carrier event message classified as
 *     `collected_at_pickup`. No signature, identification or BankID artifact is
 *     read or required; the "ID-verified collection" premise was a
 *     jurisdictional assumption in a comment, not data.
 *
 * Both are therefore stripped at the boundary of every derivation, so a
 * historical pack can be READ without its retired keys re-entering a canonical
 * record, a bank fact, an LLM payload, a category, a strength grade, a
 * completeness credit, a citation, or a claim capability.
 *
 * Deliberately NOT done here: rewriting `pack_json`. The pack is the immutable
 * record of what was collected when, and a retired key remains visible through
 * `CaseEvidenceModel.nonEvidence.operational.retiredFields` — reported, never
 * silently dropped (the #352552 invariant).
 *
 * A retired key must never be given a fake `EvidenceDefinition`, `SignalId`,
 * weight or fact category to keep a consumer compiling.
 */

export const RETIRED_PAYLOAD_KEYS = [
  "deliveredToVerifiedAddress",
  "collectedByCustomer",
] as const;

export type RetiredPayloadKey = (typeof RETIRED_PAYLOAD_KEYS)[number];

const RETIRED_SET: ReadonlySet<string> = new Set(RETIRED_PAYLOAD_KEYS);

/** Retired keys actually present on this raw payload, in registry order. */
export function retiredPayloadKeysIn(
  raw: Record<string, unknown> | null | undefined,
): RetiredPayloadKey[] {
  if (!raw) return [];
  return RETIRED_PAYLOAD_KEYS.filter((k) => k in raw);
}

/**
 * A copy of `raw` with every retired key removed.
 *
 * Returns the SAME reference when nothing was retired, so the overwhelmingly
 * common case allocates nothing and object identity is preserved for callers
 * that memoise on it.
 */
export function stripRetiredPayloadKeys<T extends Record<string, unknown> | null | undefined>(
  raw: T,
): T {
  if (!raw) return raw;
  let hit = false;
  for (const k of RETIRED_PAYLOAD_KEYS) {
    if (k in raw) {
      hit = true;
      break;
    }
  }
  if (!hit) return raw;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (RETIRED_SET.has(k)) continue;
    out[k] = v;
  }
  return out as T;
}

/** True when this key is retired. Kept as a function so callers do not
 *  re-derive the set. */
export function isRetiredPayloadKey(key: string): key is RetiredPayloadKey {
  return RETIRED_SET.has(key);
}
