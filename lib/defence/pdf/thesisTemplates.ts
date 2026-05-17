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
      "The submitted records address the item-not-received claim[[: {{deliveryClause}}]][[. {{digitalAccessClause}}]].",
    requiredTokens: [],
    optionalTokens: ["deliveryClause", "digitalAccessClause"],
  },
  {
    key: "executiveSummary:credit_not_processed:any",
    sectionKey: "executiveSummary",
    familyKey: "credit_not_processed",
    packageMode: "any",
    template:
      "The submitted records address the credit-not-processed claim[[. {{refundProcessedClause}}]].",
    requiredTokens: [],
    optionalTokens: ["refundProcessedClause"],
  },
  {
    key: "executiveSummary:any:any",
    sectionKey: "executiveSummary",
    familyKey: "any",
    packageMode: "any",
    template:
      "This representment addresses {{reasonCodeContext}}. The approved evidence supporting the merchant's position is summarised below.",
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
