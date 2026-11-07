/**
 * WHY a collected field can be absent, for every `auto` / `conditional_auto`
 * field. A REVIEWED CLASSIFICATION, completeness-enforced by
 * `__tests__/emissionClassification.test.ts` — not a proof.
 *
 * The defect this exists for: a checklist row can read `missing` when the
 * reason there is no evidence is a fact about the WORLD (a return is on record,
 * so "no return initiated" cannot exist), not the absence of evidence the
 * merchant could supply. Nearly every field has a collector guard; most mean
 * "no evidence found", where a `missing` row is the right answer. This module
 * forces the decision to be made and written down for each field.
 *
 *  - `world_precondition`: the collector stays silent because the record makes
 *    the fact impossible. MUST have a `FIELD_PRECONDITIONS` entry
 *    (`lib/automation/completeness.ts`), and nothing else may.
 *  - `evidence_absent`: the collector stays silent because it found nothing (or
 *    the gateway/source does not expose it). A `missing` row is correct.
 *  - `needs_decision`: unresolved. Shrink-only; each entry names an owner.
 *
 * Reclassifying `needs_decision` -> `evidence_absent` is not progress and is a
 * reviewed diff (the test snapshots every class).
 */

export type EmissionClass = "world_precondition" | "evidence_absent" | "needs_decision";

export interface EmissionClassification {
  class: EmissionClass;
  /** One line: why this class, citing the collector guard. */
  why: string;
  /** Required for `needs_decision`. */
  owner?: string;
}

export const EMISSION_CLASSIFICATION: Readonly<Record<string, EmissionClassification>> = {
  order_confirmation: {
    class: "evidence_absent",
    why: "orderSource: no order fetched; a missing order is a data gap, not a world fact.",
  },
  customer_account_info: {
    class: "evidence_absent",
    why: "orderSource: guest checkout has no customer record; absence is data, not an impossibility.",
  },
  activity_log: {
    class: "evidence_absent",
    why: "orderSource: none of customer, order events or delivery chronology found.",
  },
  no_return_initiated: {
    class: "world_precondition",
    why: "orderSource emits only when noReturnFactVerdict says emit; a return or refund on record, a merchant answer, or a returned parcel makes it impossible.",
  },
  refund_record: {
    class: "world_precondition",
    why: "orderSource emits only when the refunded total is above zero; on CNP/FRAUDULENT the template row is critical, so a never-refunded order holds a never-satisfiable row. Read-time only (plan 3.1 F-1b): the build-time template change and anything altering the stored score or auto-save is NOT approved.",
  },
  customer_communication: {
    class: "evidence_absent",
    why: "customerCommSource and gorgiasCommSource: no staff note, customer note or approved message found.",
  },
  shipping_tracking: {
    class: "evidence_absent",
    why: "fulfillmentSource: no fulfillment or tracking number; the unfulfilled world fact is already carried by the template mode required_if_fulfilled.",
  },
  delivery_proof: {
    class: "evidence_absent",
    why: "fulfillmentSource: no delivered signal found; absence of a delivered signal is not proof of non-delivery.",
  },
  shipping_policy: {
    class: "evidence_absent",
    why: "policySource: no published or uploaded shipping policy snapshot.",
  },
  refund_policy: {
    class: "evidence_absent",
    why: "policySource: no published or uploaded refund policy snapshot.",
  },
  cancellation_policy: {
    class: "evidence_absent",
    why: "policySource: no published or uploaded cancellation policy snapshot.",
  },
  avs_cvv_match: {
    class: "evidence_absent",
    why: "paymentSource: no gateway codes returned; the card versus non-card world fact is already carried by the template mode required_if_card_payment.",
  },
  ip_location_check: {
    class: "evidence_absent",
    why: "deviceLocationSource: the order carries no client IP.",
  },
  fraud_risk_screening: {
    class: "evidence_absent",
    why: "fraudRiskSource: no Shopify-provider low-risk assessment found; non-card payments and non-fraud reasons are handled by the template and gate.",
  },
  product_description: {
    class: "evidence_absent",
    why: "productSource: no listings collected (flag off or family is not product_not_as_described).",
  },
  tds_authentication: {
    class: "evidence_absent",
    why: "threeDSecureSource: Shopify Payments receipts only; the receipt contract is gateway-defined and the absence of 3-D Secure is never a negative signal (CLAUDE.md).",
  },
  device_session_consistency: {
    class: "evidence_absent",
    why: "Internal-only signal (citation policy never); produced when session data exists, so absence means no session data, not an impossibility.",
  },
};
