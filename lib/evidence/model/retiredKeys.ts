/**
 * Retired collector keys — payload keys AND whole field keys.
 *
 * A retired key is one a collector USED to write and no longer writes, whose
 * recorded value must never again be interpreted as evidence. It is not an
 * accidental unregistered field and it is not a live signal — it is a fact of
 * history that survives in immutable `pack_json`.
 *
 * TWO LEVELS, because the defect class arrives at two granularities:
 *
 *   - a **payload key** (`RETIRED_PAYLOAD_KEYS`) lives INSIDE a section's
 *     `data` and is stripped before anything reads the payload;
 *   - a **field key** (`RETIRED_FIELD_KEYS`) is an entire entry in
 *     `fieldsProvided` / `checklist_v2.field`, and is removed at the boundary
 *     of every derivation, classification and checklist read.
 *
 * The two are deliberately separate registries and never collapsed into one
 * list: a payload key is a property, a field key is an identity, and a
 * consumer that confuses them would strip the wrong thing.
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
 * WHY THE FIELD-KEY REGISTRY EXISTS (PR-C4). `billing_address_match` was
 * graded **strong**, with the registry note "Strong when AVS-confirmed billing
 * matches the cardholder". `orderSource` emitted it when Shopify's own
 * `billingAddress` and `shippingAddress` shared a city and a country — two
 * merchant-held addresses. No AVS result was read, and no cardholder was
 * involved. It is the same defect class PR-C1 retired on the delivery side,
 * and PR-C1 deliberately left it out of scope.
 *
 * The runtime was never the defect: the collector never wrote the `match` key
 * the grader keys on, so `categorizeEvidenceField` has always returned
 * `invalid`. Prod census 2026-08-09 (read-only): 116 packs across 114 disputes
 * carry the field, `data.match === true` on **0**, a `match` key present on
 * **0**, `defence_evidence_facts` rows in the `billing_match` category **0**.
 * What is retired here is therefore the SEMANTICS and the ownership — a
 * strength and claim-authority signal that never carried the authority its
 * grade claimed, and which a single future collector line writing `match: true`
 * would have promoted into AVS-confirmed cardholder evidence.
 *
 * Address verification now has a real owner: the canonical AVS fact from
 * PR-C2 (the AVS/CVV predicate split) and PR-C3 (per-(network, code)
 * normalization). The concept was given a new owner BEFORE the old one was
 * deleted — deletion criterion 1 of the C-14 proposal.
 *
 * Deliberately NOT done here: the billing-vs-shipping comparison itself
 * survives as an explicitly non-evidence OPERATIONAL note under its own new
 * label (decision 4). It is never evidence, never scored, never cited and
 * never a claim input — see `buildInternalSignalsByField` and
 * `classifyBillingShippingAgreement`.
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

/* ── Retired FIELD keys ──────────────────────────────────────────────── */

/**
 * Whole collector fields that are no longer evidence.
 *
 * A key here must NOT be in the `evidence` domain (`domains.ts`), must NOT
 * have a `CANONICAL_EVIDENCE` spec, and must NOT appear in a completeness
 * template. Those three absences are asserted, not assumed —
 * `tests/unit/retiredFieldKeyContainment.test.ts`.
 */
export const RETIRED_FIELD_KEYS = ["billing_address_match"] as const;

export type RetiredFieldKey = (typeof RETIRED_FIELD_KEYS)[number];

const RETIRED_FIELD_SET: ReadonlySet<string> = new Set(RETIRED_FIELD_KEYS);

/** True when this collector field is retired. */
export function isRetiredFieldKey(field: string): field is RetiredFieldKey {
  return RETIRED_FIELD_SET.has(field);
}

/** Retired field keys present in this list, in registry order. Reported
 *  through `nonEvidence.operational.retiredFields` — never dropped silently,
 *  and never reported as an *unregistered* field, which would read as an
 *  accident rather than a decision. */
export function retiredFieldKeysIn(
  fields: readonly string[] | null | undefined,
): RetiredFieldKey[] {
  if (!fields) return [];
  return RETIRED_FIELD_KEYS.filter((k) => fields.includes(k));
}

/**
 * `fields` with every retired field key removed.
 *
 * Returns the SAME reference when nothing was retired, so the overwhelmingly
 * common case allocates nothing.
 */
export function withoutRetiredFieldKeys<T extends readonly string[]>(fields: T): string[] | T {
  return fields.some((f) => RETIRED_FIELD_SET.has(f))
    ? fields.filter((f) => !RETIRED_FIELD_SET.has(f))
    : fields;
}
