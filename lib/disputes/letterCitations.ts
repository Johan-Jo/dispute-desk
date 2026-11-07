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
 *   rule 2 (new packages): the table rows ARE the cited facts (the store's
 *     records only when the letter's printed argument relies on them), plus
 *     the delivery its carrier card / section sets out — page and letter
 *     agree by construction.
 *   rule 1 (every package stored before the marker): the table as it was
 *     printed — every bank-included fact, except the delivery a single-parcel
 *     carrier card showed and the whole table on a multi-parcel letter — PLUS
 *     the delivery, which that letter argues in its own section. The page then
 *     describes the legacy letter truthfully instead of the rule it was not
 *     built under.
 *
 * Read-time and merchant-side only. Nothing here writes, rebuilds or re-scores.
 */

import type { DefenceNarrativeOutput, EvidenceFact } from "@/lib/defence/types";
import { isBankIncludedFact } from "@/lib/defence/bankInclusion";
import {
  argumentFactIdsOfNarrative,
  argumentFactIdsOfProvenance,
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
 * The fields the letter cites, for a stored package row (`facts_json`,
 * `narrative_json`, `document_provenance_json` with the rule stamp,
 * `reason_code_module`, `status`). Null when there is no stored LETTER to read
 * (the caller keeps its existing behaviour): no facts, or a build that failed
 * or was skipped (those rows keep `facts_json` but never printed a letter).
 */
export function letterCitations(row: {
  facts_json?: unknown;
  narrative_json?: unknown;
  document_provenance_json?: unknown;
  reason_code_module?: string | null;
  status?: string | null;
  pdf_path?: string | null;
}): LetterCitations | null {
  // A failed or skipped build, or a row whose letter was never printed (no PDF),
  // has no stored letter to describe.
  if (row.status === "failed" || row.status === "skipped" || !row.pdf_path) return null;
  const facts = row.facts_json;
  // No stored facts (never built, or a bare fixture) is no letter to read.
  if (!Array.isArray(facts) || facts.length === 0) return null;
  const list = facts as EvidenceFact[];
  const rule = evidenceBasisRuleOf(row.document_provenance_json);
  const argued =
    rule === EVIDENCE_BASIS_RULE_CITED
      ? (argumentFactIdsOfProvenance(row.document_provenance_json) ??
        argumentFactIdsOfNarrative(row.narrative_json as DefenceNarrativeOutput | null, row.reason_code_module))
      : undefined;
  const basis = evidenceBasisFor(list, rule, argued);
  const byId = new Map(list.map((f) => [f.id, f]));
  const fields = new Set<string>();

  if (basis.tableAllowed) {
    for (const row of basis.rows) {
      const fact = byId.get(row.factId);
      const field = fact ? evidenceFieldOfFact(fact) : null;
      if (field) fields.add(field);
    }
  }
  // The delivery is cited only where the letter actually PRINTS it: by its
  // carrier card (single or multi-parcel) or by its table row.
  const isDelivery = (c: string) => c === "delivery_proof" || c === "shipping_tracking";
  const deliveryPrinted =
    basis.single || basis.multiParcel || (basis.tableAllowed && basis.rows.some((r) => isDelivery(r.category)));
  if (deliveryPrinted && list.some((f) => isDelivery(f.category) && isBankIncludedFact(f))) {
    fields.add("shipping_tracking");
  }
  return { rule, citedFields: [...fields].sort() };
}
