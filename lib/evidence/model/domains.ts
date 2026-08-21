/**
 * The domain boundary: every collector output lands in a registered typed
 * domain. There is no discard path.
 *
 * WHY. Today `factClassifier.ts:582-583` does `if (!spec) continue` and
 * `caseStrength.ts:512-513` does the same — an unregistered collector key is
 * silently dropped by both, in different places, with no record that it
 * existed. `shopify_protect_coverage` is dropped that way today on purpose,
 * which means the deliberate case and the accidental case are indistinguishable.
 * The plan (approved 2026-08-04) §3.0 requires that not every collected field
 * be evidence, but that every collected field belong to *some* typed domain.
 *
 * Adding a collector? Add its `fieldsProvided` values here. The union type
 * makes an unregistered key a compile error at the collector, and
 * `unregisteredCollectorFields()` catches anything that reaches us at runtime
 * from a non-typed writer (the merchant upload route accepts a free-text
 * `field` from form data — see the note on `supporting_documents` below).
 */

import { CANONICAL_EVIDENCE } from "@/lib/argument/canonicalEvidence";
import { RETIRED_FIELD_KEYS } from "./retiredKeys";

export type CanonicalDomain =
  /** May be scored and/or cited. Has an EvidenceDefinition. */
  | "evidence"
  /** Shopify Protect. A gate on the automation decision; never scored, never cited. */
  | "coverage"
  /** Merchant-internal only, and structurally never bank-facing. */
  | "risk_signal"
  /** Facts about the dispute itself, not about the merchant's case. */
  | "dispute_metadata"
  /**
   * Build diagnostics, and RETIRED fields. Never scored, never cited, never a
   * claim input. A retired field stays registered here on purpose: an
   * unregistered key reads as an accident (`unregisteredFields`), and the whole
   * point of a retirement is that it is a decision with a record.
   */
  | "operational";

/**
 * Every value any collector may put in `EvidenceSection.fieldsProvided`.
 *
 * Verified 2026-08-03 against all 11 collectors in `lib/packs/sources/`:
 * orderSource (6), fulfillmentSource (2), policySource (3),
 * customerCommSource + gorgiasCommSource + manualSource (2),
 * paymentSource (1), threeDSecureSource (1), fraudRiskSource (1),
 * deviceLocationSource (1), coverageSource (1).
 */
export const CANONICAL_DOMAIN = {
  // ── evidence ──────────────────────────────────────────────────────────
  order_confirmation: "evidence",
  refund_record: "evidence",
  no_return_initiated: "evidence",
  /**
   * Merchant-stated outcome for a parcel the carrier returned to sender.
   * `evidence` domain with `citationPolicy` effectively split by key: the
   * `reason` may be cited, the `disposition` may not. Same
   * scorable-vs-citable independence the `device_session_consistency` note
   * below describes, in the other direction — this one is CITABLE but
   * never SCORED (`excludedFromStrength: true`).
   */
  returned_parcel_outcome: "evidence",
  activity_log: "evidence",
  customer_account_info: "evidence",
  shipping_tracking: "evidence",
  delivery_proof: "evidence",
  shipping_policy: "evidence",
  refund_policy: "evidence",
  cancellation_policy: "evidence",
  customer_communication: "evidence",
  /**
   * The merchant upload route (`app/api/packs/[packId]/upload/route.ts:151`)
   * takes `field` straight from form data and falls back here. That is how
   * `product_description` and `duplicate_explanation` are ever satisfied —
   * no collector emits them. Validating that input against this registry is
   * a P2a task; until then `unregisteredCollectorFields()` is the net.
   */
  supporting_documents: "evidence",
  product_description: "evidence",
  duplicate_explanation: "evidence",
  avs_cvv_match: "evidence",
  tds_authentication: "evidence",
  fraud_risk_screening: "evidence",
  ip_location_check: "evidence",
  /**
   * DEVIATION from plan §3.0, which listed this as `risk_signal`.
   *
   * It is never bank-facing (it is the sole member of
   * `factClassifier.INTERNAL_ONLY_FIELDS`), which is what motivated the
   * `risk_signal` placement. But it IS scored: `caseStrength.ts:630-631`
   * reads `strongSignalIds.has("device_session")` and
   * `FRAUD_DECISIVE_SIGNALS` includes it. Putting it outside the `evidence`
   * domain would remove it from `model.fields`, and the assessment layer —
   * which reads only `fields` — would silently stop scoring it. That is the
   * very failure this migration exists to end.
   *
   * So: `evidence` domain, `citationPolicy: "never"`. Scorable-but-never-
   * citable is a real combination and the definition expresses it directly.
   * Same reasoning that keeps `ip_location_check` and `fraud_risk_screening`
   * in `evidence` (flagged in the plan as a judgement to confirm).
   */
  device_session_consistency: "evidence",

  // ── coverage ──────────────────────────────────────────────────────────
  /**
   * `coverageSource.ts:75`. Dropped today by both pipelines via the
   * `if (!spec) continue` path, which made a deliberate exclusion look
   * identical to an accident. It is a gate, consumed by
   * `CaseAutomationDecision`, and must never appear in `fields`.
   */
  shopify_protect_coverage: "coverage",

  // ── operational: RETIRED ───────────────────────────────────────────────
  /**
   * RETIRED 2026-08-09 (PR-C4 / C-14). It was graded `strong` on the promise
   * of "AVS-confirmed billing matches the cardholder" while being emitted from
   * a billing-vs-shipping city+country comparison that read no AVS result and
   * knew no cardholder. Address verification is now carried by the canonical
   * AVS fact (`avs_cvv_match`, PR-C2 + PR-C3).
   *
   * It stays registered so a historical pack that carries it is REPORTED
   * (`nonEvidence.operational.retiredFields`) rather than filed under
   * `unregisteredFields`, which is the shape of an accident. It must never
   * return to the `evidence` domain — `RETIRED_FIELD_KEYS` is the registry and
   * `retiredFieldKeysInEvidenceDomain()` is the guard.
   */
  billing_address_match: "operational",
} as const satisfies Record<string, CanonicalDomain>;

export type CollectorFieldKey = keyof typeof CANONICAL_DOMAIN;

/** Field keys in the `evidence` domain — the ones with an EvidenceDefinition. */
export type EvidenceFieldKey = {
  [K in CollectorFieldKey]: (typeof CANONICAL_DOMAIN)[K] extends "evidence"
    ? K
    : never;
}[CollectorFieldKey];

export function domainOf(field: string): CanonicalDomain | null {
  return (CANONICAL_DOMAIN as Record<string, CanonicalDomain>)[field] ?? null;
}

export function isEvidenceField(field: string): field is EvidenceFieldKey {
  return domainOf(field) === "evidence";
}

export const EVIDENCE_FIELD_KEYS: EvidenceFieldKey[] = (
  Object.keys(CANONICAL_DOMAIN) as CollectorFieldKey[]
).filter(isEvidenceField);

/**
 * Runtime net for keys that reach us from a non-typed writer (the upload
 * route's free-text `field`, or a hand-edited pack). Returns the offenders
 * so the caller can record them rather than silently `continue`.
 */
export function unregisteredCollectorFields(fields: readonly string[]): string[] {
  return [...new Set(fields.filter((f) => domainOf(f) === null))];
}

/**
 * Guard for the registry itself: every key the legacy evidence registry
 * knows about must have a domain here, or the model would be blind to a
 * field that today's scorer can see. The reverse direction is deliberately
 * NOT asserted — `shopify_protect_coverage` is registered here and absent
 * from `CANONICAL_EVIDENCE`, which is the whole point of the boundary.
 */
export function canonicalEvidenceKeysMissingADomain(): string[] {
  return Object.keys(CANONICAL_EVIDENCE).filter((k) => domainOf(k) === null);
}

/**
 * Guard for the retirement itself: a retired field key must never sit in the
 * `evidence` domain. Returns the offenders so the invariant test can name
 * them. Re-adding one here would silently restore its definition, its grade,
 * its checklist append and its citation path in a single line.
 */
export function retiredFieldKeysInEvidenceDomain(): string[] {
  return RETIRED_FIELD_KEYS.filter((k) => domainOf(k) === "evidence");
}
