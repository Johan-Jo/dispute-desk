/**
 * Reason-code module: Visa 10.4 / Mastercard 4837 — Other Fraud, Card Absent.
 *
 * Cardholder is claiming they did not authorize the transaction.
 * The merchant's burden is to show the transaction was authorized
 * (AVS/CVV, 3DS where present), and where possible that the customer
 * received and consented to the order (billing match, communication,
 * delivery confirmation, prior history).
 */

import type { ReasonCodeGuidance } from "../types";

export const visa_10_4_fraud: ReasonCodeGuidance = {
  key: "visa_10_4_fraud",
  // v2.2: split bank-facing reference (displayName) from merchant-facing
  // claim category (claimType). The network's classification words
  // ("Other Fraud", "Card Absent Environment") never appear in
  // merchant prose — the displayName carries only the reason-code
  // identifier; the claimType describes what the cardholder is
  // alleging in the merchant's own words. The family overlay enforces
  // the "reason code = claim category, not merchant admission" rule
  // across the prompt + validator.
  displayName: "Visa 10.4 / Mastercard 4837",
  claimType: "Unauthorized transaction claim",
  reasonCodeKeys: ["10.4", "4837"],
  promptBody: [
    "You are writing a bank-facing response to an UNAUTHORIZED TRANSACTION CLAIM (cardholder alleges the transaction was not authorized). The reason code is the issuer/cardholder's CLAIM CATEGORY, not a merchant admission.",
    "Prioritise payment authentication signals, but ONLY what an approved fact actually carries. ADDRESS AND SECURITY-CODE VERIFICATION MAY BE STATED IN EXACTLY ONE WAY: by quoting the approved payment_authentication fact's `verificationSummary` verbatim. If no approved fact carries a `verificationSummary`, write NOTHING on that subject in any wording — no address check, no card-code check, no verification characterisation of any kind — and argue from the facts you do have. There is no generic replacement sentence and no softer paraphrase; a hedged version of an unsupported claim is the same unsupported claim. A summary that names ONLY the billing address must never be extended to imply a security-code result: copy what is there, add nothing. (There is no security-code-only summary — that shape is not produced.) 3-D Secure only if an approved fact carries threeDS=true, and successful authorization.",
    "Where approved facts support it, mention prior customer history and customer communication that pre-dated the dispute. Do NOT assert billing alignment, billing/shipping agreement, or any relationship between two addresses: the billing-agreement claim is retired, and address verification may be stated ONLY by copying `verificationSummary`.",
    "When a fraud_screening fact is in approvedFacts, cite Shopify's pre-authorization screening as SUPPORTING CONTEXT ONLY, and only through signals that are not verification results. THE SCREENING IS NOT VERIFICATION AUTHORITY: the deterministic claim guards accept only an approved payment_authentication / payment_auth fact as the basis for an address or security-code statement, so any `positiveFacts` phrase describing an address check or a card-code check — however that phrase is worded — MUST NOT be quoted, paraphrased, summarised or alluded to — quoting one produces a claim the validator refuses and the package fails to build. Those subjects may reach the letter ONLY by copying the approved payment_authentication fact's `verificationSummary`, per the base prompt. Safe signals are the non-verification ones — for example device, connection or IP-reputation observations, and order-history or behavioural observations. Cite the safe phrases verbatim or in close paraphrase so the reviewer can audit what the screening actually flagged, and name them rather than counting them: never write 'N positive signals' or 'multiple positive signals'. If only ONE safe signal remains, cite that one alone — there is no minimum. If NO safe signal remains after removing the verification phrases, OMIT the fraud-screening corroborator entirely and do not mention the screening. Never quote the numeric risk score or the taxonomy words 'risk_level' / 'recommendation' as a heading — paraphrase only the recommendation as 'ACCEPT' / 'low-risk'. Treat this as supporting corroboration, never as the primary basis.",
    "When an ip_location fact is in approvedFacts (it appears only when the collector pre-gated for a clean match: same country/city as the SHIPPING address, no VPN/proxy/datacenter signal, IP history consistent), cite it as supporting context grounded in WHAT MATCHED. Acceptable phrasing: 'The order IP geolocated to the same country as the shipping destination, with no VPN, proxy, or datacenter signals — consistent with a cardholder placing the order from their usual location.' The comparison is against the SHIPPING address and nothing else: `computeLocationMatch` compares the IP with `order.shippingAddress`, so never describe this signal as agreeing with billing, and never state or imply that the two order addresses correspond to one another in any way — that is the retired agreement claim. DO NOT quote the raw IP address, the city name, the ISP/ASN, coordinates, or the IPinfo provider name. The bank cannot audit a raw IP; they CAN audit a country/region-match outcome. Treat this as supporting corroboration of the authentication argument, never as primary or decisive evidence — IP geolocation is descriptive, not contractual.",
    "The policyArgument section is OMITTED for this reason code. Refund, shipping, and cancellation policy disclosure does not refute an unauthorized-transaction claim — the dispute is about cardholder authentication, not the merchant's terms. Always return an empty string for policyArgument and add it to omittedSections with reason 'Policy disclosure is not relevant to an unauthorized-transaction claim. The argument hinges on cardholder authentication signals, not the merchant's published terms.' Do NOT cite policy_refund, policy_shipping, policy_cancellation, or policy_acceptance facts in any section.",
    "Do NOT cite Shopify's fulfillmentStatus value (UNFULFILLED / FULFILLED / PARTIAL) anywhere in the narrative. fulfillmentStatus is an order-system state, not bank-facing evidence — naming it (especially UNFULFILLED) in a fraud rebuttal invites the bank to ask whether goods shipped, which is irrelevant to the authentication argument. If the order_record fact is cited, ground the argument in channel/timestamp/order details only, never the fulfillment status string.",
    "Do NOT argue that the customer received the goods unless a delivery_proof fact with proofType='delivered_confirmed'/'signature_confirmed' or a service_access fact with serviceDelivered=true is in approvedFacts.",
    "Do NOT mention 3-D Secure unless an approved payment_authentication fact carries threeDS=true.",
    "Do NOT claim 'possession of the physical card', 'had the physical card', 'held the card', or that the 'card was physically present'. Nothing in the approved evidence establishes physical possession of the card, and the absence of that claim is not a licence to describe what the evidence does show instead. NO REPLACEMENT SENTENCE IS OFFERED, and none is quoted here — printing a banned sentence teaches it. The suggestion that used to sit here asserted card-verification evidence, so on an address-only case it implied a security-code result that did not exist, and because it named no code or value the deterministic guard could not catch it. Say only what `verificationSummary` says, or say nothing.",
    "Do NOT use absolute authorization conclusions ('establishes that the transaction was authorized', 'proves the transaction was authorized', 'confirms the transaction was authorized', 'definitively shows authorization'). Use 'strongly supports that the transaction was authorized', 'is consistent with a cardholder-authorized transaction', 'supports the conclusion that the transaction was authorized', or 'contradicts the claim of an unauthorized transaction'.",
    "Do NOT accuse the customer of fraud, lying, or wrongdoing — the bank decides. Frame the case around what the approved facts actually show, and ONLY that. Do not call the transaction authenticated, verified or consistent with the cardholder unless an approved fact supports that specific claim; on a case with no citable authentication evidence, argue from the order, fulfilment, communication and history facts and make no authentication characterisation at all.",
  ].join("\n"),
  prioritize: [
    "payment_authentication",
    "billing_match",
    "delivery_proof",
    "shipping_tracking",
    "customer_communication",
    "prior_customer_history",
  ],
  avoid: [
    "device_session",
    // NOTE: `fraud_screening` was previously avoided. Removed
    // 2026-05-19 because the source-collector
    // (`lib/packs/sources/fraudRiskSource.ts`) only emits a fact
    // when Shopify's own pre-auth analysis returned ACCEPT and
    // every cited fact carries POSITIVE sentiment. In that case
    // the screening is a strong corroborator: "the platform's own
    // pre-authorization fraud screening recommended ACCEPT for
    // this order" is exactly the kind of independent signal an
    // issuer weighs in a fraud rebuttal. Still capped at MODERATE
    // by the canonical-evidence registry — never elevated to
    // STRONG (Shopify's facts are descriptive, not contractual).
    //
    // NOTE: `ip_location` was previously avoided. Removed 2026-05-20
    // for the same reason — the source-collector
    // (`lib/packs/sources/deviceLocationSource.ts`) gates emission
    // on a clean payload (location match, no VPN/proxy/hosting, IP
    // history consistent). When the row reaches the LLM it's already
    // bank-safe by construction. Avoiding it across the board meant
    // discarding a legitimate positive corroborator on every fraud
    // dispute that had a clean IP match.
    //
    // Policy facts are not bank-facing evidence for unauthorized-fraud
    // claims; the policyArgument section is omitted entirely for this
    // reason code (see promptBody rule).
    "policy_refund",
    "policy_shipping",
    "policy_cancellation",
    "policy_acceptance",
  ],
  mustNotClaim: [
    "the customer is committing fraud",
    "the cardholder is lying",
    "this dispute is invalid",
    "definitive proof of authorization",
    "establishes that the transaction was authorized",
    "proves the transaction was authorized",
    "confirms the transaction was authorized",
    "definitively shows authorization",
    "possession of the physical card",
    "had the physical card",
    "held the card",
    "card was physically present",
  ],
  criticalCategories: ["payment_authentication", "billing_match"],
  allowedFactCategories: [
    "payment_authentication",
    "payment_auth",
    "billing_match",
    "delivery_proof",
    "shipping_tracking",
    "customer_communication",
    "prior_customer_history",
    "order_record",
    "communication",
    "account_history",
    "manual_evidence",
    // Pre-authorization fraud screening — only ever cited when
    // Shopify's own analysis returned ACCEPT (gated by
    // fraudRiskSource). See `avoid` list comment above.
    "fraud_screening",
    // IP location — only ever cited when the collector's
    // bankEligible gate passed (clean match, no VPN/proxy/hosting,
    // consistent IP history). See `avoid` list comment above.
    "ip_location",
  ],
  /* v8 (2026-08-11, AVS hotfix): this module's promptBody is appended AFTER
   * the base system prompt, so its unconditional "Prioritise … AVS+CVV match"
   * and its credentials replacement could reintroduce the unsupported
   * assertion the base prompt had just been fixed to prevent.
   *
   * v9 (2026-08-11, same day): four further contradictions, found by reading
   * the RUNTIME strings rather than the diff.
   *   * `fraud_screening` was told to quote `positiveFacts` and given examples
   *     naming a correct CVV and a matching billing street address. The guards
   *     accept ONLY payment_authentication / payment_auth as verification
   *     authority, so a screening-only case could be instructed to write a
   *     claim no predicate can ever license. Verification phrases are now
   *     excluded from that corroborator, the "cite at least 2" floor is gone,
   *     and an empty safe set omits the corroborator.
   *   * "billing alignment" invited the retired billing/shipping agreement
   *     claim, or an AVS claim outside `verificationSummary`.
   *   * "and vice versa" implied a security-code-only summary can exist.
   *   * the credentials/billing-details sentence was itself a replacement
   *     verification claim, and named no code or value so neither guard could
   *     catch it.
   *   * the closing instruction REQUIRED framing the transaction as
   *     "authenticated", on cases with no authentication evidence. */
  version: 9,
};
