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
 *     isCitedFact = isBankIncludedFact ∧ (¬isRecordContextFact ∨ the letter relies on it)
 *
 * "The letter relies on it" = a printed ARGUMENT section (not the summary or
 * the conclusion) names the fact in `usedFactIds`. An item is cited iff the
 * letter relies on it: a policy or order record the counsel narrative argues
 * from ("the refund policy is published") is listed under the Evidence Basis
 * and shows as cited on the page; one the letter does not argue from stays
 * context and is not listed. Because every bank-included fact a printed
 * argument cites is therefore listed, the suppressor and the validator, which
 * ask whether a section's support is bank-included, stay consistent with the
 * table (`isListableFact`).
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

import type { ComposedDocumentBlock, DefenceNarrativeOutput, EvidenceFact, NarrativeSectionKey } from "./types";
import { isSectionShown } from "./sectionVisibility";
import { isBankIncludedFact, type BankInclusionFlags } from "./bankInclusion";
import { isRecordContextFact } from "./factClassifier";

/** Every bank-included fact is listed. The rule every package carried until now. */
export const EVIDENCE_BASIS_RULE_LEGACY = 1 as const;
/** Only cited facts are listed (the store's records only when the letter argues from them). */
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

type CitableFact = BankInclusionFlags & Pick<EvidenceFact, "id" | "strength" | "value">;

/** The sections that ARGUE from facts. The summary and the conclusion restate
 *  the case and cite broadly, so they never make a fact "relied on". */
export const ARGUMENT_SECTION_KEYS: readonly NarrativeSectionKey[] = [
  "transactionOverviewArgument",
  "chronologyArgument",
  "paymentAuthenticationArgument",
  "fulfillmentArgument",
  "communicationArgument",
  "policyArgument",
  "manualEvidenceArgument",
];

/**
 * The facts a stored narrative's PRINTED argument sections rely on: shown for
 * the reason code, not omitted, with text. The preview and the dispute page
 * read this; the PDF reads the same thing off its composed blocks
 * (`argumentFactIdsOfBlocks`), which `composePdfBlocks` builds with the same
 * three conditions.
 */
export function argumentFactIdsOfNarrative(
  narrative: DefenceNarrativeOutput | null | undefined,
  moduleKey: string | null | undefined,
): Set<string> {
  const out = new Set<string>();
  if (!narrative) return out;
  const omitted = new Set((narrative.omittedSections ?? []).map((o) => o.sectionKey));
  for (const key of ARGUMENT_SECTION_KEYS) {
    const section = narrative[key];
    if (!section || !section.text?.trim() || omitted.has(key)) continue;
    if (!isSectionShown(narrative, key, moduleKey)) continue;
    for (const id of section.usedFactIds ?? []) out.add(id);
  }
  return out;
}

/** The same, from the composed blocks the PDF prints. */
export function argumentFactIdsOfBlocks(blocks: readonly ComposedDocumentBlock[]): Set<string> {
  const out = new Set<string>();
  for (const b of blocks) {
    if (!ARGUMENT_SECTION_KEYS.includes(b.sectionKey)) continue;
    if (!(b.llmText.trim() || b.fallbackText.trim())) continue;
    for (const id of b.usedFactIds) out.add(id);
  }
  return out;
}

/**
 * THE predicate. The Evidence Basis table and the dispute page both ask this.
 * `argued` = ids the letter's printed argument relies on (rule 2 callers pass
 * it; without it only non-context facts are cited).
 */
export function isCitedFact(fact: CitableFact, argued?: ReadonlySet<string>): boolean {
  return isBankIncludedFact(fact) && (!isRecordContextFact(fact) || argued?.has(fact.id) === true);
}

/** The same predicate over a list. */
export function citedFacts(facts: readonly EvidenceFact[], argued?: ReadonlySet<string>): EvidenceFact[] {
  return facts.filter((f) => isCitedFact(f, argued));
}

/**
 * May the Evidence Basis list this fact at all? The suppressor and the
 * validator ask whether a section's support is listable; under either rule
 * every bank-included fact a printed argument cites IS listed, so this is
 * `isBankIncludedFact` under the name that says what they mean.
 */
export function isListableFact(fact: BankInclusionFlags): boolean {
  return isBankIncludedFact(fact);
}
