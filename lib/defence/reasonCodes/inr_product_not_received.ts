/**
 * Reason-code module: Visa 13.1 / Mastercard 4855 — Item Not Received.
 *
 * Cardholder claims they did not receive the merchandise/service.
 * The merchant must show delivery (physical) or access (digital).
 */

import type { ReasonCodeGuidance } from "../types";

export const inr_product_not_received: ReasonCodeGuidance = {
  key: "inr_product_not_received",
  displayName: "Visa 13.1 / Mastercard 4855",
  claimType: "Item not received claim",
  reasonCodeKeys: ["13.1", "4855"],
  promptBody: [
    "You are writing a bank-facing response to an ITEM NOT RECEIVED CLAIM (cardholder alleges the merchandise/service was not received). The reason code is the issuer/cardholder's CLAIM CATEGORY, not a merchant admission.",
    "Prioritise delivery / access evidence: tracking number, carrier, delivery date and time, signature where present, pickup proof, digital access logs, shipping address that matches what was authorised.",
    "Do NOT claim delivery unless an approved delivery_proof fact carries proofType='delivered_confirmed' or proofType='signature_confirmed'.",
    "Do NOT claim digital access unless an approved digital_access_log or service_access fact is present.",
    "If a tracking number exists but no delivery confirmation, frame the argument around what the tracking does show (handed to carrier, in transit, last scan) without claiming delivery.",
  ].join("\n"),
  prioritize: [
    "delivery_proof",
    "shipping_tracking",
    "digital_access_log",
    "service_access",
    "customer_communication",
    "order_record",
  ],
  avoid: [
    "ip_location",
    "device_session",
    "fraud_screening",
  ],
  mustNotClaim: [
    "the customer is lying about receipt",
    "definitive proof of receipt",
    "the order was clearly delivered",
  ],
  criticalCategories: ["delivery_proof"],
  allowedFactCategories: [
    // Admitted since `product_description` split out of `order_record`
    // (2026-09-01). Ranking is unchanged here — only `product_unacceptable`
    // promotes it — but the fact stays as citable as it was before.
    "product_listing",
    "delivery_proof",
    "shipping_tracking",
    "digital_access_log",
    "service_access",
    "customer_communication",
    "communication",
    "order_record",
    "billing_match",
    "policy_shipping",
    "manual_evidence",
  ],
  version: 3,
};
