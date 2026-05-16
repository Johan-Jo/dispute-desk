/**
 * Seed the defence_prompt_modules table from the file defaults in
 * lib/defence/reasonCodes/*.ts. Idempotent — running twice does NOT
 * create duplicate rows.
 *
 * Strategy:
 *   For each file default module, check if a row already exists at
 *   (key, version=1) in the DB. If yes, skip. If no, insert.
 *
 * Re-running this script after editing the file defaults will NOT
 * overwrite existing DB rows — admins make new versions via the
 * PUT /api/admin/defence-package/prompt-modules/:key endpoint, which
 * inserts version+1. The DB row is authoritative once it exists.
 *
 * Usage: node scripts/seed-defence-prompt-modules.mjs
 *
 * Requires: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL),
 * SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// Inline module defaults — duplicated from lib/defence/reasonCodes/*.ts so
// this script stays a pure .mjs (no TS compilation step needed at deploy
// time). Keep these in sync with the TS files; tests can detect drift.
const MODULES = [
  {
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
    guidance: {
      prioritize: [
        "payment_authentication",
        "billing_match",
        "delivery_proof",
        "shipping_tracking",
        "customer_communication",
        "prior_customer_history",
      ],
      avoid: ["ip_location", "device_session", "fraud_screening"],
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
    },
  },
  {
    key: "inr_product_not_received",
    displayName: "Visa 13.1 / Mastercard 4855 — Item Not Received",
    reasonCodeKeys: ["13.1", "4855"],
    promptBody: [
      "You are writing a bank-facing representment for an ITEM NOT RECEIVED dispute.",
      "Prioritise delivery / access evidence: tracking number, carrier, delivery date and time, signature where present, pickup proof, digital access logs, shipping address that matches what was authorised.",
      "Do NOT claim delivery unless an approved delivery_proof fact carries proofType='delivered' or proofType='signature'.",
      "Do NOT claim digital access unless an approved digital_access_log or service_access fact is present.",
      "If a tracking number exists but no delivery confirmation, frame the argument around what the tracking does show (handed to carrier, in transit, last scan) without claiming delivery.",
    ].join("\n"),
    guidance: {
      prioritize: [
        "delivery_proof",
        "shipping_tracking",
        "digital_access_log",
        "service_access",
        "customer_communication",
        "order_record",
      ],
      avoid: ["ip_location", "device_session", "fraud_screening"],
      mustNotClaim: [
        "the customer is lying about receipt",
        "definitive proof of receipt",
        "the order was clearly delivered",
      ],
      criticalCategories: ["delivery_proof"],
      allowedFactCategories: [
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
    },
  },
  {
    key: "product_unacceptable",
    displayName: "Visa 13.3 / Mastercard 4853 — Not as Described / Defective",
    reasonCodeKeys: ["13.3", "4853"],
    promptBody: [
      "You are writing a bank-facing representment for a NOT-AS-DESCRIBED / DEFECTIVE dispute.",
      "Prioritise: product listing as advertised at the time of purchase, variant the customer selected, delivery confirmation, customer communications about the complaint, refund/return policy disclosure, and merchant resolution attempts.",
      "Do NOT argue 'the item was acceptable' as a conclusion — argue from the listing-as-purchased and any documented resolution attempts.",
      "Do NOT cite policy as a defence unless an approved policy fact (acceptedAtCheckout=true, or a policy_refund/policy_shipping fact) is present.",
    ].join("\n"),
    guidance: {
      prioritize: [
        "order_record",
        "delivery_proof",
        "customer_communication",
        "policy_refund",
        "policy_shipping",
        "shipping_tracking",
      ],
      avoid: ["ip_location", "device_session", "fraud_screening"],
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
    },
  },
  {
    key: "credit_not_processed",
    displayName: "Visa 13.6 / Mastercard 4860 — Credit Not Processed",
    reasonCodeKeys: ["13.6", "4860"],
    promptBody: [
      "You are writing a bank-facing representment for a CREDIT NOT PROCESSED dispute.",
      "Prioritise: refund status, refund timeline, cancellation terms, partial refund records, store credit records, customer communication about the refund.",
      "Do NOT claim a refund was issued unless an approved refund_record fact carries refundStatus='processed'.",
      "If no refund was owed under policy, cite the approved refund policy fact (acceptedAtCheckout=true) explicitly.",
    ].join("\n"),
    guidance: {
      prioritize: [
        "refund_record",
        "policy_refund",
        "policy_cancellation",
        "customer_communication",
        "order_record",
      ],
      avoid: ["ip_location", "device_session", "fraud_screening"],
      mustNotClaim: [
        "no refund was ever owed",
        "definitive proof of refund",
        "the cardholder is lying about the refund",
      ],
      criticalCategories: ["refund_record"],
      allowedFactCategories: [
        "refund_record",
        "policy_refund",
        "policy_cancellation",
        "policy_acceptance",
        "customer_communication",
        "communication",
        "order_record",
        "manual_evidence",
      ],
    },
  },
  {
    key: "duplicate_processing",
    displayName: "Visa 12.6 / Mastercard 4834 — Duplicate Processing",
    reasonCodeKeys: ["12.6", "4834"],
    promptBody: [
      "You are writing a bank-facing representment for a DUPLICATE PROCESSING dispute.",
      "Prioritise: unique order ids, unique authorisation/capture ids, distinct timestamps, distinct items/quantities, refund records when one of the transactions was reversed.",
      "Frame the argument around the distinctness of the transactions, citing each order/auth id approved fact explicitly.",
      "Do NOT claim the duplicate was refunded unless an approved refund_record fact supports it.",
    ].join("\n"),
    guidance: {
      prioritize: [
        "order_record",
        "duplicate_explanation",
        "refund_record",
        "customer_communication",
      ],
      avoid: ["ip_location", "device_session", "fraud_screening"],
      mustNotClaim: [
        "the cardholder is lying about the duplicate",
        "definitive proof of distinctness",
      ],
      criticalCategories: ["order_record"],
      allowedFactCategories: [
        "order_record",
        "duplicate_explanation",
        "refund_record",
        "customer_communication",
        "communication",
        "billing_match",
        "manual_evidence",
      ],
    },
  },
  {
    key: "canceled_recurring",
    displayName: "Visa 13.2 / Mastercard 4841 — Cancelled Recurring Transaction",
    reasonCodeKeys: ["13.2", "4841"],
    promptBody: [
      "You are writing a bank-facing representment for a CANCELLED RECURRING TRANSACTION dispute.",
      "Prioritise: subscription terms, cancellation policy, renewal notice, customer consent at sign-up, cancellation timing, service usage records after renewal.",
      "Do NOT argue the customer used the service after cancellation unless an approved service_access fact carries timestamps after the disputed charge.",
      "Do NOT cite the cancellation policy unless an approved policy_cancellation fact exists.",
    ].join("\n"),
    guidance: {
      prioritize: [
        "subscription_terms",
        "policy_cancellation",
        "policy_acceptance",
        "service_access",
        "customer_communication",
      ],
      avoid: ["ip_location", "device_session", "fraud_screening"],
      mustNotClaim: [
        "the customer never cancelled",
        "definitive proof of consent",
        "the cardholder is lying about cancellation",
      ],
      criticalCategories: ["subscription_terms", "policy_cancellation"],
      allowedFactCategories: [
        "subscription_terms",
        "policy_cancellation",
        "policy_acceptance",
        "service_access",
        "customer_communication",
        "communication",
        "order_record",
        "manual_evidence",
      ],
    },
  },
  {
    key: "generic_fallback",
    displayName: "Generic representment (unknown / unmapped reason code)",
    reasonCodeKeys: [],
    promptBody: [
      "You are writing a bank-facing representment for a dispute whose specific reason code is unknown.",
      "Argue from the approved facts only. Do not invent scheme-specific rules.",
      "Cite the strongest available approved facts: payment authentication if present, delivery/access if present, order record consistency, customer communication, policy disclosures.",
      "Avoid aggressive conclusions. Use hedged framing: 'The available evidence supports…', 'The available records indicate…'.",
    ].join("\n"),
    guidance: {
      prioritize: [
        "payment_authentication",
        "billing_match",
        "delivery_proof",
        "shipping_tracking",
        "customer_communication",
        "order_record",
        "policy_refund",
        "policy_shipping",
        "policy_cancellation",
      ],
      avoid: ["ip_location", "device_session", "fraud_screening"],
      mustNotClaim: [
        "the dispute is invalid",
        "definitive proof",
        "the cardholder is lying",
      ],
      criticalCategories: ["order_record"],
      allowedFactCategories: [
        "payment_authentication",
        "payment_auth",
        "billing_match",
        "delivery_proof",
        "shipping_tracking",
        "digital_access_log",
        "service_access",
        "customer_communication",
        "communication",
        "policy_refund",
        "policy_shipping",
        "policy_cancellation",
        "policy_acceptance",
        "refund_record",
        "duplicate_explanation",
        "subscription_terms",
        "order_record",
        "prior_customer_history",
        "account_history",
        "manual_evidence",
      ],
    },
  },
];

const sb = createClient(url, key);

let inserted = 0;
let skipped = 0;
for (const m of MODULES) {
  const { data: existing } = await sb
    .from("defence_prompt_modules")
    .select("id")
    .eq("key", m.key)
    .eq("version", 1)
    .maybeSingle();
  if (existing) {
    skipped++;
    continue;
  }
  const { error } = await sb.from("defence_prompt_modules").insert({
    key: m.key,
    display_name: m.displayName,
    reason_code_keys: m.reasonCodeKeys,
    prompt_body: m.promptBody,
    guidance_json: m.guidance,
    model: null,
    is_active: true,
    version: 1,
    updated_by: "seed_script",
  });
  if (error) {
    console.error(`[seed] insert failed for ${m.key}: ${error.message}`);
    process.exit(1);
  }
  inserted++;
}

console.log(`[seed-defence-prompt-modules] inserted=${inserted} skipped=${skipped}`);
