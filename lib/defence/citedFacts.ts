/**
 * THE "cited to the bank" predicate, and the version marker that gates it.
 *
 * TWO QUESTIONS, ONE OWNER EACH.
 *
 *   "May an issuer see this fact at all?"      -> `isBankIncludedFact` (bankInclusion.ts)
 *   "Is it part of the argument, or context?"  -> `isCitedFact`        (this file)
 *
 * The dispute page marks every item cited | context | internal | unavailable and
 * tells the merchant "Only the items cited to the bank appear in the letter's
 * evidence basis". The letter's Evidence Basis table used to list EVERY
 * bank-included fact, so it listed the store's own paper (the order record, the
 * policies) as if it were proof, and — when a carrier card already showed it —
 * left the delivery out. The page and the letter disagreed about the same case.
 *
 * THE RULE (version 2). A fact is CITED when the issuer may see it AND it is
 * not mere record context:
 *
 *     isCitedFact = isBankIncludedFact ∧ ¬isRecordContextFact
 *
 * `isRecordContextFact` is the classifier's existing notion of "only there as
 * the store's own record": a `supporting` policy or the order as placed. Every
 * other bank-included fact is `strong` or `moderate`, OR is one of the two
 * `supporting` facts the classifier deliberately keeps as an argument — a
 * shipment in the carrier's possession and a collected product listing — which
 * the letter argues from in its own sections and must not be demoted to
 * "context" just because they are never scored.
 *
 * Counsel stance is unchanged because this only NARROWS: it never admits a fact
 * `isBankIncludedFact` refuses. AVS mismatch, a CANCEL screening, a different
 * cardholder name, an address-match-only Mastercard/Visa verification are not
 * bank-included, so they are not cited.
 *
 * THE VERSION MARKER. The Evidence Basis views are rendered at view time from
 * the stored `facts_json`, so a rule change would silently rewrite what an
 * existing, already-filed letter shows. The new rule is therefore gated by
 * `document_provenance_json.evidenceBasisRule`, written only by a build that
 * applies it. It is NOT in `narrative_json`: the package-safety parser fixes
 * that object's top-level keys, and an unknown key makes a package unfileable.
 * Absent (every package built before this) means rule 1 — the exact table the
 * letter was printed with.
 */

import type { EvidenceFact } from "./types";
import { isBankIncludedFact, type BankInclusionFlags } from "./bankInclusion";
import { isRecordContextFact } from "./factClassifier";

/** Every bank-included fact is listed. The rule every package carried until now. */
export const EVIDENCE_BASIS_RULE_LEGACY = 1 as const;
/** Only cited facts are listed; the delivery gets its row; context is not proof. */
export const EVIDENCE_BASIS_RULE_CITED = 2 as const;
export type EvidenceBasisRule = typeof EVIDENCE_BASIS_RULE_LEGACY | typeof EVIDENCE_BASIS_RULE_CITED;

/** The rule a freshly built package is written (and rendered) under. */
export const CURRENT_EVIDENCE_BASIS_RULE: EvidenceBasisRule = EVIDENCE_BASIS_RULE_CITED;

/**
 * The rule a stored package was built under. Anything that is not exactly `2`
 * — absent, null, a string, a future number — reads as the legacy rule, so an
 * unknown marker can never switch an old letter onto new behaviour.
 */
export function evidenceBasisRuleOf(provenance: unknown): EvidenceBasisRule {
  const marker =
    provenance !== null && typeof provenance === "object"
      ? (provenance as { evidenceBasisRule?: unknown }).evidenceBasisRule
      : undefined;
  return marker === EVIDENCE_BASIS_RULE_CITED ? EVIDENCE_BASIS_RULE_CITED : EVIDENCE_BASIS_RULE_LEGACY;
}

type CitableFact = BankInclusionFlags & Pick<EvidenceFact, "strength" | "value">;

/** THE predicate. The Evidence Basis table and the dispute page both ask this. */
export function isCitedFact(fact: CitableFact): boolean {
  return isBankIncludedFact(fact) && !isRecordContextFact(fact);
}

/** The same predicate over a list. */
export function citedFacts(facts: readonly EvidenceFact[]): EvidenceFact[] {
  return facts.filter(isCitedFact);
}
