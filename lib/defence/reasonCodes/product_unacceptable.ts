/**
 * Reason-code module: Visa 13.3 / Mastercard 4853 — Not as Described / Defective.
 *
 * Cardholder claims the item did not match the description, was defective,
 * or was otherwise unacceptable. Merchant must show what was offered
 * matches what was delivered, and that any complaints were addressed.
 */

import type { ReasonCodeGuidance } from "../types";

export const product_unacceptable: ReasonCodeGuidance = {
  key: "product_unacceptable",
  displayName: "Visa 13.3 / Mastercard 4853",
  claimType: "Not as described or defective claim",
  reasonCodeKeys: ["13.3", "4853"],
  promptBody: [
    "You are writing a bank-facing response to a NOT-AS-DESCRIBED / DEFECTIVE CLAIM (cardholder alleges the goods/service did not match the listing or were defective). The reason code is the issuer/cardholder's CLAIM CATEGORY, not a merchant admission.",
    "Prioritise: product listing as advertised at the time of purchase, variant the customer selected, delivery confirmation, customer communications about the complaint, refund/return policy disclosure, and merchant resolution attempts.",
    "Do NOT argue 'the item was acceptable' as a conclusion — argue from the listing-as-purchased and any documented resolution attempts.",
    "Do NOT cite policy as a defence unless an approved policy fact (acceptedAtCheckout=true, or a policy_refund/policy_shipping fact) is present.",
  ].join("\n"),
  prioritize: [
    "order_record",
    "delivery_proof",
    "customer_communication",
    "policy_refund",
    "policy_shipping",
    "shipping_tracking",
  ],
  avoid: [
    "ip_location",
    "device_session",
    "fraud_screening",
  ],
  mustNotClaim: [
    "the product was definitively acceptable",
    "the customer is lying about defects",
    "this dispute is invalid",
  ],
  criticalCategories: ["order_record"],
  allowedFactCategories: [
    "order_record",
    "delivery_proof",
    "shipping_tracking",
    "customer_communication",
    "communication",
    "policy_refund",
    "policy_shipping",
    "policy_acceptance",
    "manual_evidence",
  ],
  version: 2,
};
