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
  displayName: "Visa 10.4 / Mastercard 4837 — Other Fraud (Card Absent)",
  reasonCodeKeys: ["10.4", "4837"],
  promptBody: [
    "You are writing a bank-facing representment for an UNAUTHORIZED TRANSACTION dispute.",
    "Prioritise payment authentication signals: AVS+CVV match, 3-D Secure authentication (only if an approved fact explicitly supports it), and successful authorization.",
    "Where approved facts support it, mention billing-shipping consistency, prior customer history, and customer communication that pre-dated the dispute.",
    "Do NOT argue that the customer received the goods unless a delivery_proof fact with proofType='delivered' or a service_access fact is in approvedFacts.",
    "Do NOT mention 3-D Secure unless an approved payment_authentication fact carries threeDS=true.",
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
  version: 1,
};
