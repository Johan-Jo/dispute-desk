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
    "Prioritise payment authentication signals: AVS+CVV match, 3-D Secure authentication (only if an approved fact explicitly supports it), and successful authorization.",
    "Where approved facts support it, mention billing alignment, prior customer history, and customer communication that pre-dated the dispute.",
    "Policy disclosure: when policy_refund, policy_shipping, or policy_cancellation facts are in approvedFacts, write a policyArgument paragraph that names which policies were published at the time of purchase (e.g. 'The merchant's refund, shipping, and cancellation policies were published and available at checkout, and the customer had the opportunity to review them prior to placing the order'). Do NOT claim the customer accepted or agreed to the policies unless an approved policy_acceptance fact with acceptedAtCheckout=true is also present — disclosure and acceptance are different claims. Empty acceptedAtCheckout=false is NOT a reason to omit the section; the disclosure itself is bank-facing evidence.",
    "Do NOT argue that the customer received the goods unless a delivery_proof fact with proofType='delivered'/'signature' or a service_access fact with serviceDelivered=true is in approvedFacts.",
    "Do NOT mention 3-D Secure unless an approved payment_authentication fact carries threeDS=true.",
    "Do NOT claim 'possession of the physical card', 'had the physical card', 'held the card', or that the 'card was physically present'. AVS+CVV confirm access to credentials and billing details, NOT physical possession. Use 'had access to card verification credentials and billing details associated with the cardholder account' instead.",
    "Do NOT use absolute authorization conclusions ('establishes that the transaction was authorized', 'proves the transaction was authorized', 'confirms the transaction was authorized', 'definitively shows authorization'). Use 'strongly supports that the transaction was authorized', 'is consistent with a cardholder-authorized transaction', 'supports the conclusion that the transaction was authorized', or 'contradicts the claim of an unauthorized transaction'.",
    "Do NOT accuse the customer of fraud, lying, or wrongdoing — the bank decides. Frame as: the transaction was authenticated and consistent with the cardholder's behaviour.",
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
    "ip_location",
    "device_session",
    "fraud_screening",
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
  ],
  version: 2,
};
