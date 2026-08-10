/**
 * THE bank-inclusion predicate. One owner, one spelling (CP-B §9).
 *
 * WHAT WAS WRONG. "May this fact reach the issuer?" was answered by an inline
 * boolean at four independent sites, and two of them did not agree:
 *
 *   lib/defence/factClassifier.ts       bankEligible ∧ includeInBankNarrative ∧ ¬submissionRisk
 *   lib/defence/pdf/evidenceBasisRows.ts             (same)
 *   app/api/disputes/[id]/workspace/route.ts         (same)
 *   lib/defence/narrativeWriter.ts      ¬submissionRisk ∨ includeInBankNarrative      ← weaker
 *
 * The last one is C-1 in `docs/evidence-model/p0/containment-proposals.md`: the
 * LLM payload admits facts the PDF's Evidence Basis table already suppresses, so
 * the generator can argue from a fact the appendix refuses to list. The
 * divergence was invisible because nothing named it — it lived as two
 * expressions in two files with a comment claiming they agreed.
 *
 * WHAT THIS FILE DOES, AND DELIBERATELY DOES NOT DO. It gives the rule one
 * owner and one name, so `tests/unit/bankInclusionSingleOwner.test.ts` can prove
 * no fifth spelling appears. It does NOT converge the two rules: the generator
 * filter is live in production, and changing which facts reach the model is a
 * bank-visible behaviour change that belongs in a reviewed PR with a measured
 * delta, not in a dark epic. `reachesLlmPayloadLegacy` is therefore exported
 * BY NAME, with its divergence stated and pinned by test, so convergence becomes
 * a deliberate one-line change instead of an archaeology exercise.
 */

import type { EvidenceFact } from "./types";

/**
 * THE predicate. Every issuer-facing surface — Evidence Basis rows, the
 * workspace bank projection, the classifier's own eligibility check — asks this
 * and nothing else.
 *
 * All three conjuncts are load-bearing:
 *   bankEligible            — the classifier judged the fact citable at all.
 *   includeInBankNarrative  — it may be argued FROM, not merely listed.
 *   ¬submissionRisk         — unless the merchant explicitly overrode it, which
 *                             is what `includeInBankNarrative` then records.
 */
export function isBankIncludedFact(fact: EvidenceFact): boolean {
  return fact.bankEligible && fact.includeInBankNarrative && !fact.submissionRisk;
}

/** The same predicate over a list. Every caller filters; none re-spells it. */
export function bankIncludedFacts(facts: readonly EvidenceFact[]): EvidenceFact[] {
  return facts.filter(isBankIncludedFact);
}

/**
 * The LLM payload's filter as production runs it today. NOT a second
 * bank-inclusion rule — the measured pre-convergence behaviour of ONE call site,
 * named so it can be seen.
 *
 * It admits a fact that `isBankIncludedFact` refuses whenever
 * `bankEligible === false` and `submissionRisk === false` — an unciteable 3-D
 * Secure fact, for instance, which reaches the model as citable support while
 * the PDF table suppresses it (C-1, measured reachability: 1 open dispute at the
 * PR-C1 census).
 *
 * CONVERGENCE IS A SEPARATE, REVIEWED CHANGE. Replacing this call with
 * `isBankIncludedFact` changes what the model is shown on live disputes; it
 * needs its own measured delta and its own approval.
 */
export function reachesLlmPayloadLegacy(fact: EvidenceFact): boolean {
  return !fact.submissionRisk || fact.includeInBankNarrative;
}

/**
 * Facts the two rules disagree about. Exported so the divergence is measurable
 * on a real population instead of argued about.
 */
export function bankInclusionDivergence(facts: readonly EvidenceFact[]): EvidenceFact[] {
  return facts.filter((f) => reachesLlmPayloadLegacy(f) !== isBankIncludedFact(f));
}
