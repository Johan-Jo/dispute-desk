/**
 * Facts no reason-code label may suppress.
 *
 * WHY THIS EXISTS. Every defence decision keys off `disputes.reason`, which
 * comes from the issuer's filing — and the issuer's filing is not reliable.
 * blume-box #352552 was labelled `PRODUCT_UNACCEPTABLE` while the issuer's own
 * claim document is a fraud questionnaire ("cardholder did not participate",
 * card never lost, never stolen, never used). `product_unacceptable`'s
 * `allowedFactCategories` omits `payment_authentication`, so the label alone
 * suppressed a Mastercard ECI 02 liability shift — the strongest fact in the
 * file. We cannot verify a label: the issuer claim is Shopify-Admin-only
 * (docs/technical.md § "What Shopify exposes about a dispute's reason…").
 *
 * ADMISSION TEST — a fact belongs here only if the answer is "no":
 *
 *     Can citing this read AGAINST us under any claim type?
 *
 * A fact that is decisive under one claim and merely *irrelevant* under the
 * others qualifies. A fact that is merely *weak* elsewhere does not — weak
 * evidence invites the issuer to answer it.
 *
 * DELIBERATELY EXCLUDED, with reasons:
 *   - 3DS that is "attempted" (ECI 01/06) or exempted — authentication did not
 *     complete, or was deliberately skipped with the merchant keeping
 *     liability. Both read against us.
 *   - `ip_location`, `device_session` — `avoid`-listed by several modules for
 *     good reason; a location or device claim invites scrutiny of a signal we
 *     cannot fully stand behind.
 *   - `fraud_screening` on a non-fraud claim — Shopify's own risk facts are
 *     descriptive, and citing "our screening said this was low risk" against a
 *     product complaint answers a question nobody asked.
 *
 * Measured effect (prod, 2026-08-03, scripts/report-label-suppressed-facts.mjs):
 * 6 open disputes had `payment_authentication` excluded by their label and 81
 * had `no_return_initiated` excluded — the latter because it is listed in
 * exactly ONE module (`credit_not_processed`) and dropped by every other,
 * whatever the label said.
 */

import { hasReturnedToSenderShipment } from "./factPredicates";
import type { EvidenceFact, EvidenceFactCategory } from "./types";

interface AdmissionRule {
  /** Fact this rule recognises, by `value.fieldKey`. */
  fieldKey: string;
  /** Category to admit when the rule matches. */
  category: EvidenceFactCategory;
  /** Why it cannot read against us under any claim type. */
  rationale: string;
  /** `fact` is the candidate; `facts` is the WHOLE set, because
   *  admissibility can turn on something the candidate does not know
   *  about itself. `no_return_initiated` is the case that forced this
   *  second argument — see its rule below. */
  matches: (fact: EvidenceFact, facts: readonly EvidenceFact[]) => boolean;
}

export const ALWAYS_ADMISSIBLE_RULES: readonly AdmissionRule[] = [
  {
    fieldKey: "tds_authentication",
    category: "payment_authentication",
    rationale:
      "The issuer's own ACS authenticated the cardholder and accepted fraud " +
      "liability at authorization (ECI 02/05, no exemption). Decisive against " +
      "an unauthorised-use claim; irrelevant but harmless against any other.",
    matches: (f) =>
      (f.value as { liabilityShift?: unknown } | null)?.liabilityShift === true,
  },
  {
    fieldKey: "avs_cvv_match",
    category: "payment_authentication",
    rationale:
      "Both the billing address and the card verification code matched the " +
      "issuer's records. `strength === 'strong'` is exactly the both-matched " +
      "case per canonicalEvidence's avs_cvv_match branch — a partial match " +
      "stays subject to the module's own rules, because half a match invites " +
      "the issuer to point at the other half.",
    matches: (f) => f.strength === "strong",
  },
  {
    fieldKey: "no_return_initiated",
    category: "no_return_initiated",
    rationale:
      "Emitted by orderSource ONLY when returnStatus is NO_RETURN and no " +
      "refund was issued (orderSource.ts:219) — a factual statement about the " +
      "order record that has no adverse reading, PROVIDED the goods really " +
      "did not come back. It was admissible in exactly one module and " +
      "silently dropped by every other. " +
      "CONDITIONAL since 2026-08-20 (cay-collective #13195): when a carrier " +
      "returned the parcel to the merchant, this fact has a plainly adverse " +
      "reading — it invites the argument 'no refund was owed because the " +
      "customer never sent it back' about goods sitting in the merchant's " +
      "own warehouse. That is the admission test in this module's header " +
      "answering 'yes', so the rule must stop matching.",
    matches: (_fact, facts) => !hasReturnedToSenderShipment([...facts]),
  },
] as const;

/**
 * Categories that must be admitted for this fact set regardless of what the
 * reason-code module allows. Returns only categories actually triggered, so a
 * dispute with no qualifying facts is unaffected.
 */
export function alwaysAdmissibleCategories(
  facts: readonly EvidenceFact[],
): EvidenceFactCategory[] {
  const out = new Set<EvidenceFactCategory>();
  for (const fact of facts) {
    const fieldKey = (fact.value as { fieldKey?: unknown } | null)?.fieldKey;
    for (const rule of ALWAYS_ADMISSIBLE_RULES) {
      if (fieldKey !== rule.fieldKey) continue;
      if (!rule.matches(fact, facts)) continue;
      out.add(rule.category);
    }
  }
  return [...out];
}
