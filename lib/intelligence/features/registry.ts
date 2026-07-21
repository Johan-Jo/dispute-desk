/**
 * Feature registry (design §6) — the single source of truth for what each
 * analytical feature is, when it becomes known (`available_at` rule +
 * governing timestamp), and whether it may enter a prevention or response-win
 * model. Leakage rules are invariants asserted by tests.
 *
 * v1 posture for Blume Box: nearly everything is descriptive-only. Fields
 * flagged `unverifiedPendingProvenance` are held descriptive-only until the
 * §14 provenance tasks are resolved; risk is retrospective; analytical
 * outcomes (submission timing, pack completeness) are never model features.
 */

import type { FeatureDescriptor } from "../types";
import { FEATURE_REGISTRY_VERSION } from "../config";

export { FEATURE_REGISTRY_VERSION };

export const FEATURE_REGISTRY: FeatureDescriptor[] = [
  {
    key: "order_value_time_fields",
    source: "shopify_orders.order_total/currency/country/is_cross_border + derived hour/weekday/value_band",
    definition: "Presumed order-time order attributes.",
    stage: "ORDER_DECISION_TIME",
    availableAtRule:
      "created_at_shopify dates order creation but does NOT prove the persisted value is the original vs a later backfill snapshot",
    governingTime: "source_event",
    missingMeans: "unknown",
    preventionModelEligible: false, // §14.10 immutability unproven
    responseModelEligible: false,
    analyticalOutcomeOnly: false,
    unverifiedPendingProvenance: true,
    retrospectiveOnly: false,
  },
  {
    key: "payment_gateway",
    source: "shopify_orders.payment_gateway",
    definition: "Payment gateway used.",
    stage: "ORDER_DECISION_TIME",
    availableAtRule: "may only be known AFTER transaction processing — unverified",
    governingTime: "source_event",
    missingMeans: "unknown (not 'other')",
    preventionModelEligible: false,
    responseModelEligible: false,
    analyticalOutcomeOnly: false,
    unverifiedPendingProvenance: true,
    retrospectiveOnly: false,
  },
  {
    key: "customer_tenure",
    source: "derived from shopify_orders.customer_shopify_id (as-of order date)",
    definition: "returning / first_seen_in_observed_history / unknown (never bare 'new').",
    stage: "ORDER_DECISION_TIME",
    availableAtRule: "as-of created_at_shopify; left-censored at coverage boundary → unknown",
    governingTime: "source_event",
    missingMeans: "unknown tenure",
    preventionModelEligible: true, // only when tenure ≠ unknown, enforced at use
    responseModelEligible: true,
    analyticalOutcomeOnly: false,
    unverifiedPendingProvenance: false,
    retrospectiveOnly: false,
  },
  {
    key: "shipping_carrier_choice",
    source: "shopify_orders / trackings",
    definition: "Shipping method / carrier chosen.",
    stage: "SHIP_DECISION_TIME",
    availableAtRule: "fulfilled_at records the action, not necessarily when the choice became available — unverified",
    governingTime: "source_event",
    missingMeans: "unknown",
    preventionModelEligible: false,
    responseModelEligible: false,
    analyticalOutcomeOnly: false,
    unverifiedPendingProvenance: true,
    retrospectiveOnly: false,
  },
  {
    key: "delivery_signature",
    source: "shopify_orders.delivery_status/delivered_at_tracking/signed_by_name; trackings.terminal_at",
    definition: "Delivery + signature outcomes (later observations).",
    stage: "POST_SHIP_OBSERVATION",
    availableAtRule: "underlying-event time (delivery scan) must be a real event time, proven ≤ scored_at",
    governingTime: "source_event",
    missingMeans: "unknown (NOT 'not delivered')",
    preventionModelEligible: false, // post-decision outcome
    responseModelEligible: false, // only per-row when event ts ≤ scored_at proven (§14.11)
    analyticalOutcomeOnly: false,
    unverifiedPendingProvenance: true,
    retrospectiveOnly: false,
  },
  {
    key: "risk_level_initial",
    source: "shopify_orders.risk_level_initial",
    definition: "Shopify risk level at (claimed) order time.",
    stage: "POST_OUTCOME_ONLY",
    availableAtRule: "timestamp provenance unproven; ingest lag indicates post-hoc (§14.1)",
    governingTime: "ingestion",
    missingMeans: "unknown",
    preventionModelEligible: false,
    responseModelEligible: false,
    analyticalOutcomeOnly: false,
    unverifiedPendingProvenance: true,
    retrospectiveOnly: true,
  },
  {
    key: "dispute_reason_raw",
    source: "disputes.reason",
    definition: "Coarse Shopify dispute reason (canonical ALL_DISPUTE_REASONS).",
    stage: "DISPUTE_RESPONSE_TIME",
    availableAtRule: "raw provider reason plausibly at initiated_at",
    governingTime: "source_event",
    missingMeans: "GENERAL / unknown",
    preventionModelEligible: false,
    responseModelEligible: true,
    analyticalOutcomeOnly: false,
    unverifiedPendingProvenance: false,
    retrospectiveOnly: false,
  },
  {
    key: "dispute_phase",
    source: "disputes.phase",
    definition: "inquiry / chargeback.",
    stage: "DISPUTE_RESPONSE_TIME",
    availableAtRule: "initiated_at (synced from Shopify type)",
    governingTime: "source_event",
    missingMeans: "unknown",
    preventionModelEligible: false,
    responseModelEligible: true,
    analyticalOutcomeOnly: false,
    unverifiedPendingProvenance: false,
    retrospectiveOnly: false,
  },
  {
    key: "network_reason_code",
    source: "disputes.network_reason_code (+confidence)",
    definition: "Visa/MC network reason code (inferred for Blume Box).",
    stage: "DISPUTE_RESPONSE_TIME",
    availableAtRule: "requires a persisted classification-generation timestamp to be response-eligible — none today",
    governingTime: "classification_generation",
    missingMeans: "unknown",
    preventionModelEligible: false,
    responseModelEligible: false, // descriptive-only until §14.8
    analyticalOutcomeOnly: false,
    unverifiedPendingProvenance: true,
    retrospectiveOnly: false,
  },
  {
    key: "evidence_and_submission",
    source: "evidence_packs.completeness_score / composition / disputes.submitted_at / submission timing",
    definition: "Evidence completeness, pack composition, submission timing.",
    stage: "POST_OUTCOME_ONLY",
    availableAtRule: "pack scores often computed AFTER submission — non-predictive",
    governingTime: "classification_generation",
    missingMeans: "unknown",
    preventionModelEligible: false,
    responseModelEligible: false,
    analyticalOutcomeOnly: true, // §5.2: retrospective response analysis only
    unverifiedPendingProvenance: false,
    retrospectiveOnly: false,
  },
  {
    key: "final_outcome",
    source: "disputes.final_outcome / outcome_amount_*",
    definition: "Adjudicated outcome + recovered/lost amounts.",
    stage: "POST_OUTCOME_ONLY",
    availableAtRule: "closed_at",
    governingTime: "source_event",
    missingMeans: "unknown",
    preventionModelEligible: false,
    responseModelEligible: false, // label only, never a predictive feature
    analyticalOutcomeOnly: true,
    unverifiedPendingProvenance: false,
    retrospectiveOnly: false,
  },
];

export function getFeature(key: string): FeatureDescriptor | undefined {
  return FEATURE_REGISTRY.find((f) => f.key === key);
}

/**
 * Leakage invariants (design §6 rules 1–7), asserted by tests. Returns the
 * list of violations; empty = registry is leakage-safe.
 */
export function registryLeakageViolations(): string[] {
  const v: string[] = [];
  for (const f of FEATURE_REGISTRY) {
    // Rule 5: final outcome never predictive.
    if (f.key === "final_outcome" && (f.preventionModelEligible || f.responseModelEligible)) {
      v.push(`${f.key}: final outcome must never be a predictive feature`);
    }
    // Rule 3: analytical outcomes never model features.
    if (f.analyticalOutcomeOnly && (f.preventionModelEligible || f.responseModelEligible)) {
      v.push(`${f.key}: analyticalOutcomeOnly cannot be model-eligible`);
    }
    // Rule 7 + §14: unverified provenance ⇒ descriptive-only.
    if (f.unverifiedPendingProvenance && (f.preventionModelEligible || f.responseModelEligible)) {
      v.push(`${f.key}: unverifiedPendingProvenance must stay descriptive-only`);
    }
    // Retrospective ⇒ not model-eligible.
    if (f.retrospectiveOnly && (f.preventionModelEligible || f.responseModelEligible)) {
      v.push(`${f.key}: retrospectiveOnly cannot be model-eligible`);
    }
    // Prevention eligibility only for order/ship-decision stages.
    if (
      f.preventionModelEligible &&
      f.stage !== "ORDER_DECISION_TIME" &&
      f.stage !== "SHIP_DECISION_TIME"
    ) {
      v.push(`${f.key}: prevention feature must be ODT/SDT stage, got ${f.stage}`);
    }
    // Response-win eligibility never from POST_OUTCOME_ONLY.
    if (f.responseModelEligible && f.stage === "POST_OUTCOME_ONLY") {
      v.push(`${f.key}: response-win feature cannot be POST_OUTCOME_ONLY`);
    }
  }
  return v;
}
