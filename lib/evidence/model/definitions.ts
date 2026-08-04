/**
 * The EvidenceDefinition registry — what each kind of evidence MEANS.
 *
 * Seeded from today's implementations per the declared authority rules
 * (plan §6b), so P1 reproduces current behaviour and any change shows up as a
 * manifest diff rather than as an accident:
 *
 *   R2 — validity and quality come from `categorizeEvidenceField`
 *        (`lib/argument/canonicalEvidence.ts`). It is the most reviewed
 *        classifier and the only one with tests pinning live payload shapes.
 *   R3 — relevance comes from `REASON_TEMPLATES_V2`, and ONLY relevance.
 *        A field absent from a template resolves to `not_applicable`, which
 *        is an explicit state on a record that still exists — NOT the silent
 *        absence that caused blume-box #352552.
 *   R4 — citation policy is seeded from `factClassifier`'s bank-eligibility
 *        rules, the most conservative implementation and the only one
 *        reviewed against the two-layer non-disclosure rule.
 *
 * `cardinality` is the field with no precedent in the old code, because the
 * old code had no concept of an evidence instance. It is declared from the
 * domain: a dispute can have several parcels, several uploads, several
 * Gorgias messages, several refunds.
 */

import { CANONICAL_EVIDENCE, type SignalId } from "@/lib/argument/canonicalEvidence";
import { categoryForField } from "@/lib/defence/factClassifier";
import { REASON_TEMPLATES_V2 } from "@/lib/automation/completeness";
import type { EvidenceFactCategory } from "@/lib/defence/types";
import { EVIDENCE_FIELD_KEYS, type EvidenceFieldKey } from "./domains";
import type { AggregationRule, EvidenceDefinition } from "./types";
import type { RelevanceLevel } from "./vocabulary";

export const DEFINITION_REGISTRY_VERSION = 1;

/**
 * Fields where one dispute can hold more than one real record.
 *
 * Everything else is `single`. Getting this wrong in the permissive direction
 * is safe (a `multiple` field that happens to have one record is just a
 * one-element array); getting it wrong in the restrictive direction loses
 * evidence, which is the failure this model exists to prevent — so when in
 * doubt, declare `multiple`.
 */
const MULTIPLE: ReadonlySet<string> = new Set([
  "delivery_proof", // one per fulfillment
  "shipping_tracking", // one per parcel
  "customer_communication", // one per message / pasted acknowledgement
  "supporting_documents", // one per uploaded file
  "refund_record", // one per refund
  "product_description", // one per listing screenshot / upload
]);

/**
 * Citation policy per field. See the two-layer non-disclosure rule.
 *
 * `never` is the sole member of `factClassifier.INTERNAL_ONLY_FIELDS`.
 * `conditional` covers the three fields whose bank exposure is decided per
 * record rather than per field:
 *   - `ip_location_check` — `deviceLocationSource` pre-computes `bankEligible`,
 *     true only for same city/country, no VPN/proxy/hosting, consistent IP
 *     history (the blanket internal-only gate was removed 2026-05-20 because
 *     it was discarding every clean match).
 *   - `fraud_risk_screening` — the collector emits only Shopify-provider,
 *     LOW/NONE risk, ACCEPT/NONE recommendation, ≥1 positive fact
 *     (internal-only gate removed 2026-05-19 for the same reason).
 *   - `tds_authentication` — `factClassifier.isUnciteableThreeDs` withholds an
 *     authentication that neither shifted liability nor was merchant-confirmed;
 *     an "attempted" 3DS reads against us.
 */
const CITATION_POLICY: Record<string, EvidenceDefinition["citationPolicy"]> = {
  device_session_consistency: "never",
  ip_location_check: "conditional",
  fraud_risk_screening: "conditional",
  tds_authentication: "conditional",
};

const AGGREGATION: Record<string, AggregationRule> = {
  // The declared sibling relation that replaces four hand-written collapses.
  delivery_proof: {
    representative: "best_quality",
    qualityRollup: "best",
    collapsesWith: "shipping_tracking",
  },
  shipping_tracking: { representative: "most_recent", qualityRollup: "best" },
  customer_communication: { representative: "best_quality", qualityRollup: "best" },
  supporting_documents: { representative: "most_recent", qualityRollup: "best" },
  refund_record: { representative: "most_recent", qualityRollup: "best" },
  product_description: { representative: "most_recent", qualityRollup: "best" },
};

const DEFAULT_AGGREGATION: AggregationRule = {
  representative: "first_valid",
  qualityRollup: "best",
};

/**
 * Fields a merchant can actually supply. Everything else must never produce
 * an "add X" prompt — asking for evidence the merchant cannot obtain is the
 * defect recorded in `feedback_ask_only_for_what_the_merchant_can_actually_do`.
 */
const MERCHANT_SUPPLIABLE: ReadonlySet<string> = new Set([
  "supporting_documents",
  "product_description",
  "customer_communication",
  "duplicate_explanation",
]);

/** Template priority → relevance. Absent from the template ⇒ not_applicable. */
function relevanceFor(field: string, reason: string | null | undefined): RelevanceLevel {
  const template =
    REASON_TEMPLATES_V2[String(reason ?? "")] ?? REASON_TEMPLATES_V2.GENERAL ?? [];
  const entry = template.find((t) => t.field === field);
  if (!entry) return "not_applicable";
  switch (entry.priority) {
    case "critical":
      return "critical";
    case "recommended":
      return "recommended";
    default:
      return "optional";
  }
}

function buildDefinition(fieldKey: EvidenceFieldKey): EvidenceDefinition {
  const spec = CANONICAL_EVIDENCE[fieldKey];
  return {
    fieldKey,
    cardinality: MULTIPLE.has(fieldKey) ? "multiple" : "single",
    signalId: spec.signalId as SignalId,
    // `categoryForField` is the only producer of EvidenceFactCategory today;
    // reading it here rather than restating the switch keeps one owner.
    factCategory: categoryForField(fieldKey, null) as EvidenceFactCategory,
    labelToken: { key: spec.labelKey },
    merchantSuppliable: MERCHANT_SUPPLIABLE.has(fieldKey),
    citationPolicy: CITATION_POLICY[fieldKey] ?? "when_valid",
    aggregation: AGGREGATION[fieldKey] ?? DEFAULT_AGGREGATION,
    relevance: (reason) => relevanceFor(fieldKey, reason),
  };
}

export const EVIDENCE_DEFINITIONS: Record<EvidenceFieldKey, EvidenceDefinition> =
  Object.fromEntries(
    EVIDENCE_FIELD_KEYS.map((k) => [k, buildDefinition(k)]),
  ) as Record<EvidenceFieldKey, EvidenceDefinition>;

export function definitionFor(fieldKey: EvidenceFieldKey): EvidenceDefinition {
  return EVIDENCE_DEFINITIONS[fieldKey];
}
