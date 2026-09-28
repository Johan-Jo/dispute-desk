/**
 * Reason-code module: Visa 13.3 / Mastercard 4853 — Not as Described / Defective.
 *
 * Cardholder claims the item did not match the description, was defective,
 * or was otherwise unacceptable. The response states what was ordered, what
 * the records show and any documented resolution (v4, 2026-09-28).
 */

import type { ReasonCodeGuidance } from "../types";

export const product_unacceptable: ReasonCodeGuidance = {
  key: "product_unacceptable",
  displayName: "Visa 13.3 / Mastercard 4853",
  claimType: "Not as described or defective claim",
  reasonCodeKeys: ["13.3", "4853"],
  promptBody: [
    "You are writing a bank-facing response to a NOT-AS-DESCRIBED / DEFECTIVE CLAIM (cardholder alleges the goods/service differed from the listing or were defective). The reason code is the issuer/cardholder's CLAIM CATEGORY, not a merchant admission.",
    "Prioritise: the items and variant the customer ordered, the product listing as retrieved for this response (never presented as the page shown at checkout), customer communications about the complaint, refund/return policy disclosure, and merchant resolution attempts.",
    "Do NOT argue 'the item was acceptable' as a conclusion — argue from the listing-as-purchased and any documented resolution attempts.",
    "Do NOT cite policy as a defence unless an approved policy fact (acceptedAtCheckout=true, or a policy_refund/policy_shipping fact) is present.",
    "DELIVERY IS NOT CONFORMITY. A delivery scan proves the parcel reached the buyer; it says nothing about whether its contents agreed with the listing. Delivery may appear as chronology, but it must never be the principal rebuttal and must never be offered as evidence of conformity with the listing.",
  ].join("\n"),
  // Conformity evidence leads. `delivery_proof` sat second in this list
  // until 2026-09-01, which put possession above conformity in the one
  // family where possession is not in dispute — the buyer agrees the parcel
  // arrived and says its contents were wrong.
  prioritize: [
    "product_listing",
    "customer_communication",
    "policy_refund",
    "policy_shipping",
    "order_record",
    "delivery_proof",
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
    "the delivered item agreed with its listing or description",
    "the listing shown is the one the customer saw at purchase",
  ],
  // The listing, not the order confirmation. `order_record` is satisfied by
  // the order confirmation on essentially every case, so naming it here
  // meant this family's critical category could never fail, and
  // `derivePackageMode` never dropped a not-as-described package to hedged
  // framing for want of the evidence the family is actually about.
  criticalCategories: ["product_listing"],
  allowedFactCategories: [
    "product_listing",
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
  version: 4,
};
