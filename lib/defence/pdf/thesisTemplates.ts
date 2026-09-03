/**
 * Thesis templates — fact-templated blockquotes that open each
 * narrative section in the rendered PDF.
 *
 * Grammar:
 *   - `{{tokenName}}`     substituted from the token's extractor
 *   - `[[ … ]]`           optional clause; stripped if ANY token
 *                         inside it resolves to null
 *   - text outside `[[…]]` is required (template returns "" if any
 *     requiredToken resolves null)
 *
 * Fallback chain in `renderThesis`:
 *   (section, family, mode) → (section, family, "any") →
 *   (section, "any", "any") → null
 *
 * Author drift is caught by two nets:
 *   1. `thesisCannotClaimWithoutFact.matrix.test.ts` — static analysis
 *      asserting every guarded phrase ("3-D Secure", "delivered",
 *      "prior customer", etc.) appears only when the corresponding
 *      token is declared in `requiredTokens`.
 *   2. `validateComposedDocument` — runtime safety net; rejects any
 *      thesis string that trips a forbidden-phrase or claim-guard
 *      regex, regardless of how the template was authored.
 */

import type { ThesisTemplate } from "../types";

/**
 * The COMPOSITION rules version — the fourth retry input.
 *
 * WHY THIS EXISTS (2026-09-03). `evaluateGenerationGuard` decides whether a
 * failed package may be rebuilt by asking whether anything changed since the
 * failure. It knew three inputs: `prompt_version`, `VALIDATOR_VERSION`, and
 * the evidence hash. The composed document has a FOURTH input those three do
 * not cover — the deterministic prose this file contributes — and a composed
 * failure can be caused entirely by it.
 *
 * That is not hypothetical. `ecbb03aa` fixed the `representment` defect by
 * editing one template string. It touched no prompt, no validator and no
 * evidence, so all three retry inputs still matched the failure and the guard
 * correctly concluded "same attempt" for all 27 cases the defect had killed.
 * The fix shipped to prod and every case it fixed stayed dead — 9 of them
 * past their deadline by the time it was noticed.
 *
 * This is the same lesson `VALIDATOR_VERSION`'s history records twice (v2 and
 * v3): a fix that changes the RULES without changing anything the guard reads
 * leaves the cases it was written to save permanently blocked. The answer is
 * the same one — make the rule layer versioned, and bump it in the same commit
 * as the rule change.
 *
 * BUMP THIS whenever a change to composed prose could alter a composed
 * verdict: template text here, `renderThesis`'s chain, `thesisTokens`
 * extractors, or the fallback/section text in `composePdfBlocks`.
 * `compositionVersionBump.test.ts` pins the value so the bump is a deliberate
 * edit rather than something to remember.
 *
 * HISTORY
 *   1  (2026-09-03) initial versioning. Covers the state AFTER `ecbb03aa` —
 *      the rail-neutral fallback thesis. Set to 1 (not 0) so every package
 *      built before this constant existed carries NULL and is therefore
 *      treated as changed, giving the 27 cases killed by `representment`
 *      exactly one rebuild under the corrected template.
 */
export const COMPOSITION_VERSION = 1;

export const THESIS_TEMPLATES: ThesisTemplate[] = [
  // ── executiveSummary ─────────────────────────────────────────────
  {
    key: "executiveSummary:unauthorized_fraud:full",
    sectionKey: "executiveSummary",
    familyKey: "unauthorized_fraud",
    packageMode: "full",
    template:
      "The submitted records show that {{paymentAuthMethod}} aligned with the cardholder credentials on file[[, and {{priorOrderHistoryClause}}]][[. {{customerCommunicationClause}}]]. The available evidence is consistent with a cardholder-authorized transaction.",
    requiredTokens: ["paymentAuthMethod"],
    optionalTokens: ["priorOrderHistoryClause", "customerCommunicationClause"],
  },
  {
    key: "executiveSummary:unauthorized_fraud:narrow",
    sectionKey: "executiveSummary",
    familyKey: "unauthorized_fraud",
    packageMode: "narrow",
    template:
      "The available records on this chargeback are summarised below[[, including {{paymentAuthMethod}}]][[ and {{priorOrderHistoryClause}}]].",
    requiredTokens: [],
    optionalTokens: ["paymentAuthMethod", "priorOrderHistoryClause"],
  },
  {
    key: "executiveSummary:item_not_received:any",
    sectionKey: "executiveSummary",
    familyKey: "item_not_received",
    packageMode: "any",
    template:
      /* "respond to", NOT "address".
       *
       * `ADDRESS_TERMS` matches the word `address` with no part-of-speech
       * distinction — it cannot tell the VERB ("the records address the
       * claim") from the NOUN. Coupled with "delivery" in the same sentence,
       * this template read as a delivery-to-address claim and failed
       * `unauthorized_claim` at the `thesis` layer.
       *
       * Production #12936 (cay-collective) v6, 2026-08-13: the LLM prose was
       * finally CLEAN under prompt v14, which is what exposed this — the
       * thesis line had been carrying the trip all along, masked by the
       * model's own claims failing first.
       *
       * Reworded rather than teaching the detector the verb sense: two
       * strings we control versus widening `ADDRESS_TERMS`, which is the
       * higher-risk edit and would earn its own false-negative guards. */
      "The submitted records respond to the item-not-received claim[[: {{deliveryClause}}]][[. {{digitalAccessClause}}]].",
    requiredTokens: [],
    optionalTokens: ["deliveryClause", "digitalAccessClause"],
  },
  {
    key: "executiveSummary:credit_not_processed:any",
    sectionKey: "executiveSummary",
    familyKey: "credit_not_processed",
    packageMode: "any",
    template:
      // Same reason as the item-not-received template above: the verb
      // "address" is indistinguishable from the noun to `ADDRESS_TERMS`.
      "The submitted records respond to the credit-not-processed claim[[. {{refundProcessedClause}}]].",
    requiredTokens: [],
    optionalTokens: ["refundProcessedClause"],
  },
  {
    key: "executiveSummary:any:any",
    sectionKey: "executiveSummary",
    familyKey: "any",
    packageMode: "any",
    template:
      // "representment" was here until 2026-09-02. It is a card-network term
      // of art, and `BNPL_PROHIBITED_CARD_PHRASES` hard-rejects it on every
      // non-card rail — so this template, the LAST fallback in the chain,
      // failed the composed document for any family without a thesis of its
      // own the moment that family landed on PayPal/Klarna/Affirm. It cost
      // 26 unfileable not-as-described packages before it was found. A
      // template that serves every family AND every rail must be neutral in
      // both; `thesisTemplatesAreRailNeutral.test.ts` now enforces that.
      "This response addresses {{reasonCodeContext}}. The approved evidence supporting the merchant's position is summarised below.",
    requiredTokens: ["reasonCodeContext"],
    optionalTokens: [],
  },

  // ── transactionOverviewArgument ──────────────────────────────────
  {
    key: "transactionOverviewArgument:any:any",
    sectionKey: "transactionOverviewArgument",
    familyKey: "any",
    packageMode: "any",
    template:
      "The transaction record is internally consistent with cardholder-initiated activity[[, including {{paymentAuthMethod}}]].",
    requiredTokens: [],
    optionalTokens: ["paymentAuthMethod"],
  },

  // ── chronologyArgument ───────────────────────────────────────────
  {
    key: "chronologyArgument:any:any",
    sectionKey: "chronologyArgument",
    familyKey: "any",
    packageMode: "any",
    template:
      "The timeline of events records the relevant moments of the customer's interaction with the merchant.",
    requiredTokens: [],
    optionalTokens: [],
  },

  // ── paymentAuthenticationArgument ────────────────────────────────
  {
    key: "paymentAuthenticationArgument:unauthorized_fraud:any",
    sectionKey: "paymentAuthenticationArgument",
    familyKey: "unauthorized_fraud",
    packageMode: "any",
    template:
      "{{paymentAuthMethod}} is on record for this transaction and is consistent with a cardholder-initiated transaction.",
    requiredTokens: ["paymentAuthMethod"],
    optionalTokens: [],
  },
  {
    key: "paymentAuthenticationArgument:any:any",
    sectionKey: "paymentAuthenticationArgument",
    familyKey: "any",
    packageMode: "any",
    template:
      "Authentication and payment-record signals are presented below.",
    requiredTokens: [],
    optionalTokens: [],
  },

  // ── fulfillmentArgument ──────────────────────────────────────────
  {
    key: "fulfillmentArgument:item_not_received:any",
    sectionKey: "fulfillmentArgument",
    familyKey: "item_not_received",
    packageMode: "any",
    template:
      "{{deliveryClause}}.",
    requiredTokens: ["deliveryClause"],
    optionalTokens: [],
  },
  {
    key: "fulfillmentArgument:any:any",
    sectionKey: "fulfillmentArgument",
    familyKey: "any",
    packageMode: "any",
    template:
      "Fulfilment, delivery, or access evidence is presented below.",
    requiredTokens: [],
    optionalTokens: [],
  },

  // ── communicationArgument ────────────────────────────────────────
  {
    key: "communicationArgument:any:any",
    sectionKey: "communicationArgument",
    familyKey: "any",
    packageMode: "any",
    template:
      "Customer communication on record is presented below[[: {{customerCommunicationClause}}]].",
    requiredTokens: [],
    optionalTokens: ["customerCommunicationClause"],
  },

  // ── policyArgument ───────────────────────────────────────────────
  {
    key: "policyArgument:any:any",
    sectionKey: "policyArgument",
    familyKey: "any",
    packageMode: "any",
    template:
      "Relevant policy disclosures are presented below[[: {{policyDisclosureClause}}]].",
    requiredTokens: [],
    optionalTokens: ["policyDisclosureClause"],
  },

  // ── manualEvidenceArgument ───────────────────────────────────────
  {
    key: "manualEvidenceArgument:any:any",
    sectionKey: "manualEvidenceArgument",
    familyKey: "any",
    packageMode: "any",
    template:
      "Supplementary documentation provided by the merchant supports the foregoing argument.",
    requiredTokens: [],
    optionalTokens: [],
  },

  // ── conclusion ───────────────────────────────────────────────────
  {
    key: "conclusion:any:full",
    sectionKey: "conclusion",
    familyKey: "any",
    packageMode: "full",
    template:
      "Based on the evidence above, the merchant respectfully requests reversal of the chargeback.",
    requiredTokens: [],
    optionalTokens: [],
  },
  {
    key: "conclusion:any:narrow",
    sectionKey: "conclusion",
    familyKey: "any",
    packageMode: "narrow",
    template:
      "Based on the available evidence, the merchant respectfully requests review of this chargeback.",
    requiredTokens: [],
    optionalTokens: [],
  },
];
