/**
 * What the stored letter actually cites — read from the letter, never inferred.
 *
 * The dispute page promises "Only the items cited to the bank appear in the
 * letter's evidence basis". That is only true if the page's `cited` set IS the
 * set of evidence fields the letter's Evidence Basis lists. This module is that
 * set: it asks the SAME derivation the PDF and the preview draw their table
 * from (`evidenceBasisFor`), under the rule the package was built with
 * (`evidenceBasisRuleOf`), so the page cannot claim what the letter does not
 * say.
 *
 *   rule 2 (new packages): the table rows ARE the cited facts, delivery
 *     included — page and letter agree by construction.
 *   rule 1 (every package stored before the marker): the table as it was
 *     printed — every bank-included fact, except the delivery a single-parcel
 *     carrier card showed and the whole table on a multi-parcel letter — PLUS
 *     the delivery, which that letter argues in its own section. The page then
 *     describes the legacy letter truthfully instead of the rule it was not
 *     built under.
 *
 * Read-time and merchant-side only. Nothing here writes, rebuilds or re-scores.
 */

import type { EvidenceFact } from "@/lib/defence/types";
import { isBankIncludedFact } from "@/lib/defence/bankInclusion";
import {
  EVIDENCE_BASIS_RULE_CITED,
  evidenceBasisRuleOf,
  type EvidenceBasisRule,
} from "@/lib/defence/citedFacts";
import { evidenceBasisFor } from "@/lib/defence/render/documentModel";
import { RETURN_EVIDENCE_FIELD } from "@/lib/packs/returnEvidenceField";

/** Evidence field a fact's category stands for, when the fact carries no `fieldKey`. */
const FIELD_FOR_CATEGORY: Record<string, string> = {
  ip_location: "ip_location_check",
  fraud_screening: "fraud_risk_screening",
  shipping_tracking: "shipping_tracking",
  delivery_proof: "shipping_tracking",
  no_return_initiated: RETURN_EVIDENCE_FIELD,
  payment_authentication: "avs_cvv_match",
  order_record: "order_confirmation",
  customer_communication: "customer_communication",
  policy_refund: "refund_policy",
  policy_shipping: "shipping_policy",
  policy_cancellation: "cancellation_policy",
};

/** The page shows one row where the letter has two facts for the same record. */
const FIELD_ALIAS: Record<string, string> = {
  delivery_proof: "shipping_tracking",
  customer_account_info: "activity_log",
};

/** The evidence field (the page's unit) a stored fact belongs to, or null. */
export function evidenceFieldOfFact(fact: EvidenceFact): string | null {
  const key = typeof fact.value?.fieldKey === "string" ? fact.value.fieldKey : null;
  const field = key ?? FIELD_FOR_CATEGORY[fact.category] ?? null;
  return field ? (FIELD_ALIAS[field] ?? field) : null;
}

export interface LetterCitations {
  /** The rule the package was built under. */
  rule: EvidenceBasisRule;
  /** Evidence fields the letter cites, sorted. */
  citedFields: string[];
}

/**
 * The fields the letter cites, for a stored package. `provenance` is the
 * package's `document_provenance_json`, which carries the rule stamp; `facts`
 * is the stored `facts_json`. Null when there is no stored letter to read (the
 * caller keeps its existing behaviour).
 */
export function letterCitations(facts: unknown, provenance: unknown): LetterCitations | null {
  // No stored facts (never built, skipped, or a bare fixture) is no letter to
  // read: the caller keeps the live evidence line's reading.
  if (!Array.isArray(facts) || facts.length === 0) return null;
  const list = facts as EvidenceFact[];
  const rule = evidenceBasisRuleOf(provenance);
  const basis = evidenceBasisFor(list, rule);
  const byId = new Map(list.map((f) => [f.id, f]));
  const fields = new Set<string>();

  if (basis.tableAllowed) {
    for (const row of basis.rows) {
      const fact = byId.get(row.factId);
      const field = fact ? evidenceFieldOfFact(fact) : null;
      if (field) fields.add(field);
    }
  }
  // A legacy letter argues the delivery in its own section even when its table
  // leaves the row out (a carrier card, or a multi-parcel letter). Under rule 2
  // the table already lists it.
  if (rule !== EVIDENCE_BASIS_RULE_CITED) {
    for (const f of list) {
      if ((f.category === "delivery_proof" || f.category === "shipping_tracking") && isBankIncludedFact(f)) {
        fields.add("shipping_tracking");
      }
    }
  }
  return { rule, citedFields: [...fields].sort() };
}
