/**
 * Complete the DEV SEED-STAGE disputes so EVERY workspace tab renders
 * real content — most importantly a full defence package (rebuttal
 * letter) on the "Review and Forward" tab.
 *
 * Why this exists: the SEED-STAGE disputes (seeded via
 * scripts/sql/seed-staged-presentation-disputes.sql) were inserted with
 * only a `disputes` row + a thin `evidence_packs` row (pack_json =
 * case_strength only, checklist_v2 = []). The real pipeline never ran
 * on them, so:
 *   - pack_json.sections is absent      → order context all null,
 *                                          EvidenceTab empty
 *   - checklist_v2 is []                → MissingOrWeak / coverage empty
 *   - evidence_items rows are absent    → EvidenceTab §2 empty
 *   - defence_packages row is absent    → Review and Forward tab shows
 *                                          NO rebuttal letter ("nothing
 *                                          there").
 *
 * This script simulates what buildPack + buildDefencePackage would have
 * produced, writing the canonical shapes the workspace API reads
 * (app/api/disputes/[id]/workspace/route.ts):
 *   1. pack_json.sections[] + evidence_items + checklist_v2  (the same
 *      canonical shape scripts/backfill-seed-pack-evidence.mjs writes —
 *      reused verbatim below).
 *   2. A defence_packages row (source_pack_id = pack.id) with a complete
 *      narrative_json (all argument sections) + facts_json, so
 *      DefencePackageHtmlView renders the full letter. Section keys,
 *      fact shapes, and status/validation values mirror a real
 *      submitted package pulled from the dev DB.
 *
 * Per-stage defence-package state (matches the presentation the seed
 * dispute is meant to demonstrate):
 *   - PREP-* / SAVED-* / COMM / BLOCKING (pre-transmission):
 *       status='draft', validation_status='ok', version=1  → renders as
 *       the merchant's current draft letter (latest).
 *   - UNDER-REVIEW / WON / LOST (transmitted):
 *       status='submitted', submitted_at set, version=1     → becomes
 *       bankFacing so the "saved to Shopify / on file with the bank"
 *       banner + letter render.
 *   - BUILDING: pack.status='building' → no defence package yet (the
 *       letter is written after the pack completes). Left as-is; the
 *       Overview correctly shows "Building your evidence pack".
 *
 * Idempotent: re-running deletes this shop's SEED-STAGE defence packages
 * + evidence_items first, then rewrites. Real packages (any other shop /
 * non-SEED dispute) are never touched. Deterministic RNG seeded per
 * dispute so a re-run is byte-identical.
 *
 * Run (DEV only — surasvenne on vrpkgudqmpyunekrkpnc). Uses tsx so it can
 * import the real strength engine and store the SAME tier the detail page
 * recomputes on read (no stored-vs-recomputed drift):
 *   npx tsx scripts/seed-staged-defence-packages.mjs            # dry run
 *   npx tsx scripts/seed-staged-defence-packages.mjs --apply
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { calculateCaseStrength } from "../lib/argument/caseStrength.ts";

config({ path: join(process.cwd(), ".env.local") });
config({ path: join(process.cwd(), ".env") });

const sb = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const SHOP_DOMAIN = "surasvenne.myshopify.com";
const APPLY = process.argv.includes("--apply");
const SEED_PREFIX = "gid://shopify/ShopifyPaymentsDispute/SEED-STAGE-";

// ── Per-dispute deterministic RNG ────────────────────────────────────
function makeRng(seedStr) {
  let s = parseInt(createHash("sha256").update(seedStr).digest("hex").slice(0, 8), 16);
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
function round2(x) { return Number(x.toFixed(2)); }

// ─────────────────────────────────────────────────────────────────────
// PART 1 — canonical pack_json.sections + evidence_items + checklist_v2
// (field mix, labels, meta, and section builders reused verbatim from
//  scripts/backfill-seed-pack-evidence.mjs so the two seeders agree)
// ─────────────────────────────────────────────────────────────────────

// Profiles are keyed by INTENDED STRENGTH TIER, not by reason, so the
// evidence set deterministically produces that tier under the real
// engine (lib/argument/caseStrength.ts: strong needs >=2 strong signals;
// 1 strong + >=1 moderate = moderate; else weak). The stored
// case_strength.overall is set to the SAME tier the engine recomputes on
// read, so the detail page never disagrees with the saved pack.
//
//   strong   → delivery(delivered_confirmed + verified address = strong)
//              + AVS(Y/M = strong) = 2 strong  → engine "strong"
//   moderate → delivery(delivered_confirmed + verified = strong) only
//              = 1 strong                        → engine "moderate"
//   weak     → policies + activity, no decisive signal → engine "weak"
const STRENGTH_PROFILES = {
  strong: {
    available: ["order_confirmation", "billing_address_match", "avs_cvv_match", "shipping_tracking", "delivery_proof", "activity_log", "customer_account_info"],
    missing: ["customer_communication"],
    unavailable: [],
  },
  moderate: {
    available: ["order_confirmation", "shipping_tracking", "delivery_proof", "activity_log", "shipping_policy"],
    missing: ["customer_communication"],
    unavailable: [],
  },
  weak: {
    available: ["order_confirmation", "refund_policy", "shipping_policy", "activity_log"],
    missing: ["product_description", "customer_communication"],
    unavailable: [
      { field: "delivery_proof", reason: "Order is unfulfilled" },
    ],
  },
};

const FIELD_LABELS = {
  order_confirmation: "Transaction Record",
  billing_address_match: "Billing Address Match",
  avs_cvv_match: "Payment Verification (AVS & CVV)",
  activity_log: "Customer History",
  ip_location_check: "IP & Location Check",
  customer_account_info: "Customer Account Info",
  shipping_tracking: "Shipping Confirmation",
  delivery_proof: "Delivery Confirmation (Signature / Photo)",
  customer_communication: "Customer Communication",
  refund_policy: "Refund Policy",
  shipping_policy: "Shipping Policy",
  cancellation_policy: "Cancellation Policy",
  product_description: "Product Description",
};

const FIELD_META = {
  order_confirmation: { priority: "critical", source: "auto_shopify", collectionType: "auto" },
  billing_address_match: { priority: "critical", source: "auto_shopify", collectionType: "auto" },
  avs_cvv_match: { priority: "critical", source: "auto_shopify", collectionType: "conditional_auto" },
  activity_log: { priority: "critical", source: "auto_shopify", collectionType: "auto" },
  ip_location_check: { priority: "recommended", source: "auto_ipinfo", collectionType: "auto" },
  customer_account_info: { priority: "recommended", source: "auto_shopify", collectionType: "auto" },
  shipping_tracking: { priority: "recommended", source: "auto_shopify", collectionType: "conditional_auto" },
  delivery_proof: { priority: "recommended", source: "auto_shopify", collectionType: "conditional_auto" },
  customer_communication: { priority: "recommended", source: "manual_upload", collectionType: "manual" },
  refund_policy: { priority: "recommended", source: "auto_policy", collectionType: "auto" },
  shipping_policy: { priority: "optional", source: "auto_policy", collectionType: "auto" },
  product_description: { priority: "recommended", source: "manual_upload", collectionType: "manual" },
};

function buildSections(rng, dispute, fields, strength) {
  const sections = [];
  const items = [];
  const orderNumberShort = String(Math.floor(rng() * 9000) + 1000);
  const orderGid = dispute.order_gid ?? `gid://shopify/Order/SEED-${dispute.id}`;
  const orderTotal = dispute.amount ?? 100;
  const currency = dispute.currency_code ?? "USD";
  const has = (f) => fields.includes(f);

  if (has("order_confirmation") || has("billing_address_match")) {
    const provided = ["order_confirmation", "billing_address_match"].filter(has);
    const data = {
      orderId: orderGid,
      orderName: `#${orderNumberShort}`,
      createdAt: dispute.initiated_at ?? new Date().toISOString(),
      totals: { total: String(orderTotal), subtotal: String(orderTotal), tax: "0.0", shipping: "0.0", refunded: "0.0", discounts: "0.0", currency },
      lineItems: [{
        sku: `SKU-${pick(rng, ["APP", "ELEC", "TOY", "HOME", "BEAUTY"])}-${String(Math.floor(rng() * 200)).padStart(4, "0")}`,
        title: pick(rng, ["Cordless Drill 18V", "1080p USB Webcam", "Wool Blend Throw Blanket", "Smart Indoor Plant Pot", "Adjustable Standing Desk"]),
        quantity: 1 + Math.floor(rng() * 2), total: String(orderTotal), currency, variant: null,
      }],
      billingAddress: { city: pick(rng, ["Stockholm", "Göteborg", "Malmö", "Berlin", "Oslo"]), zipPrefix: String(Math.floor(rng() * 900) + 100), countryCode: pick(rng, ["SE", "DE", "NO", "FI", "DK"]) },
      cancelledAt: null,
    };
    sections.push({ type: "order", label: `Order #${orderNumberShort}`, source: "shopify_order", fieldsProvided: provided, data });
    items.push({ type: "order", label: `Order #${orderNumberShort}`, source: "shopify_order", payload: { ...data, fieldsProvided: provided }, confidence: round2(0.9 + rng() * 0.09) });
  }

  if (has("activity_log")) {
    const data = { eventCount: 4 + Math.floor(rng() * 8), firstEventAt: new Date(Date.now() - (180 + Math.floor(rng() * 600)) * 86400000).toISOString(), lastEventAt: dispute.initiated_at ?? new Date().toISOString() };
    sections.push({ type: "access_log", label: "Customer activity log", source: "shopify_order", fieldsProvided: ["activity_log"], data });
    items.push({ type: "other", label: "Customer activity log", source: "shopify_order", payload: { ...data, fieldsProvided: ["activity_log"] }, confidence: round2(0.85 + rng() * 0.12) });
  }

  if (has("customer_account_info")) {
    const data = { customerCreatedAt: new Date(Date.now() - (30 + Math.floor(rng() * 800)) * 86400000).toISOString(), ordersCount: 1 + Math.floor(rng() * 12), totalSpent: String(orderTotal * (1 + Math.floor(rng() * 6))) };
    sections.push({ type: "other", label: "Customer profile", source: "shopify_order", fieldsProvided: ["customer_account_info"], data });
    items.push({ type: "other", label: "Customer profile", source: "shopify_order", payload: { ...data, fieldsProvided: ["customer_account_info"] }, confidence: round2(0.85 + rng() * 0.1) });
  }

  if (has("avs_cvv_match")) {
    // Engine keys (lib/argument/canonicalEvidence.ts categoryFor): both
    // avsResultCode AND cvvResultCode matching → strong; one → moderate.
    // Strong tier: Y + M (both match). Moderate tier: Y + only AVS.
    const strong = strength === "strong";
    const data = {
      avsResultCode: "Y",
      cvvResultCode: strong ? "M" : "N",
      processor: "stripe",
    };
    sections.push({ type: "other", label: "AVS / CVV match", source: "shopify_transactions", fieldsProvided: ["avs_cvv_match"], data });
    items.push({ type: "other", label: "AVS / CVV match", source: "shopify_transactions", payload: { ...data, fieldsProvided: ["avs_cvv_match"] }, confidence: round2(0.92 + rng() * 0.07) });
  }

  if (has("ip_location_check")) {
    const country = pick(rng, ["SE", "DE", "NO", "FI", "DK"]);
    const data = { ipCountry: country, ipMatchesBilling: true, asn: `AS${10000 + Math.floor(rng() * 50000)}` };
    sections.push({ type: "other", label: "IP & location check", source: "ipinfo_io", fieldsProvided: ["ip_location_check"], data });
    items.push({ type: "other", label: "IP & location check", source: "ipinfo_io", payload: { ...data, fieldsProvided: ["ip_location_check"] }, confidence: round2(0.85 + rng() * 0.12) });
  }

  if (has("shipping_tracking") || has("delivery_proof")) {
    const provided = ["shipping_tracking", "delivery_proof"].filter(has);
    const carrier = pick(rng, ["PostNord", "DHL", "Bring", "GLS"]);
    // Engine keys (canonicalEvidence.ts): proofType is the discriminator.
    // Both strong+moderate tiers use delivered_confirmed +
    // deliveredToVerifiedAddress (= a STRONG delivery signal). That one
    // strong signal alone yields engine "moderate"; the strong tier adds
    // a second strong signal (AVS Y/M) to reach "strong" (>=2 strong).
    const strongDelivery = strength === "strong" || strength === "moderate";
    const data = {
      carrier,
      trackingNumber: String(Math.floor(rng() * 900000000) + 100000000),
      shippedAt: new Date(Date.now() - (10 + Math.floor(rng() * 60)) * 86400000).toISOString(),
      deliveredAt: new Date(Date.now() - (5 + Math.floor(rng() * 30)) * 86400000).toISOString(),
      status: "delivered",
      proofType: strongDelivery ? "delivered_confirmed" : "delivered_unverified",
      deliveredToVerifiedAddress: strongDelivery,
    };
    sections.push({ type: "tracking", label: `Tracking — ${carrier}`, source: "shopify_fulfillment", fieldsProvided: provided, data });
    items.push({ type: "tracking", label: `Tracking — ${carrier}`, source: "shopify_fulfillment", payload: { ...data, fieldsProvided: provided }, confidence: round2(0.9 + rng() * 0.08) });
  }

  const policyProvided = ["refund_policy", "shipping_policy", "cancellation_policy"].filter(has);
  if (policyProvided.length) {
    const data = { refundUrl: `https://${SHOP_DOMAIN}/policies/refund`, shippingUrl: `https://${SHOP_DOMAIN}/policies/shipping`, cancellationUrl: `https://${SHOP_DOMAIN}/policies/cancellation` };
    sections.push({ type: "policy", label: "Store policies", source: "policy_snapshots", fieldsProvided: policyProvided, data });
    items.push({ type: "policy", label: "Store policies", source: "policy_snapshots", payload: { ...data, fieldsProvided: policyProvided }, confidence: round2(0.95 + rng() * 0.04) });
  }

  return { sections, items };
}

function buildChecklistV2(profile) {
  const out = [];
  for (const f of profile.available) {
    const meta = FIELD_META[f] ?? { priority: "recommended", source: "auto_shopify", collectionType: "auto" };
    out.push({ field: f, label: FIELD_LABELS[f] ?? f, status: "available", priority: meta.priority, source: meta.source, collectionType: meta.collectionType, blocking: false });
  }
  for (const f of profile.missing) {
    const meta = FIELD_META[f] ?? { priority: "recommended", source: "manual_upload", collectionType: "manual" };
    out.push({ field: f, label: FIELD_LABELS[f] ?? f, status: "missing", priority: meta.priority, source: meta.source, collectionType: meta.collectionType, blocking: false });
  }
  for (const u of profile.unavailable) {
    const meta = FIELD_META[u.field] ?? { priority: "recommended", source: "unavailable_from_source", collectionType: "auto" };
    out.push({ field: u.field, label: FIELD_LABELS[u.field] ?? u.field, status: "unavailable", priority: meta.priority, source: "unavailable_from_source", collectionType: meta.collectionType, blocking: false, unavailableReason: u.reason });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// PART 2 — defence_packages narrative_json + facts_json
// (shapes mirror a real submitted package pulled from the dev DB;
//  section keys per lib/defence/render/sections.ts SECTION_ORDER)
// ─────────────────────────────────────────────────────────────────────

// Build the canonical approvedFacts array from the same field mix. Only
// bankEligible facts carry includeInBankNarrative=true; the narrative's
// usedFactIds reference these ids.
function buildFacts(rng, profile, reason) {
  const facts = [];
  const push = (f) => { f.id = `f${facts.length}`; facts.push(f); return f.id; };
  const ref = () => randomUUID();

  const idOrder = push({
    label: "Order record", value: { channel: "web", fieldKey: "order_confirmation", confirmationSent: true, fulfillmentStatus: profile.available.includes("delivery_proof") ? "FULFILLED" : "UNFULFILLED" },
    source: "shopify_order", category: "order_record", strength: "supporting", sourceRef: ref(), confidence: null,
    bankEligible: false, internalOnly: false, submissionRisk: false, merchantVisible: true, includeInBankNarrative: false,
  });
  const idHist = push({
    label: "Customer account history", value: { fieldKey: "customer_account_info", priorOrderCount: 1 + Math.floor(rng() * 6), disputeFreeHistory: true },
    source: "shopify_order", category: "prior_customer_history", strength: "supporting", sourceRef: ref(), confidence: null,
    bankEligible: false, internalOnly: false, submissionRisk: false, merchantVisible: true, includeInBankNarrative: false,
  });

  let idAvs = null;
  if (profile.available.includes("avs_cvv_match")) {
    idAvs = push({
      label: "Payment authentication", value: { fieldKey: "avs_cvv_match", avsResult: "Y", cvvResult: "M", verificationSummary: "the billing address matched the issuer's records and the card verification code matched the issuer's records" },
      source: "shopify_transactions", category: "payment_authentication", strength: "strong", sourceRef: ref(), confidence: null,
      bankEligible: true, internalOnly: false, submissionRisk: false, merchantVisible: true, includeInBankNarrative: true,
    });
  }

  let idTracking = null;
  if (profile.available.includes("delivery_proof") || profile.available.includes("shipping_tracking")) {
    idTracking = push({
      label: "Delivery confirmation", value: { fieldKey: "delivery_proof", carrier: pick(rng, ["PostNord", "DHL", "Bring"]), deliveredAt: new Date(Date.now() - (5 + Math.floor(rng() * 20)) * 86400000).toISOString(), status: "delivered" },
      source: "shopify_fulfillment", category: "fulfillment_delivery", strength: "strong", sourceRef: ref(), confidence: null,
      bankEligible: true, internalOnly: false, submissionRisk: false, merchantVisible: true, includeInBankNarrative: true,
    });
  }

  const policyIds = [];
  for (const [fk, label, cat] of [["refund_policy", "Refund policy", "policy_refund"], ["shipping_policy", "Shipping policy", "policy_shipping"]]) {
    if (profile.available.includes(fk)) {
      policyIds.push(push({
        label, value: { fieldKey: fk, acceptedAtCheckout: false, acceptanceTimestamp: null },
        source: "policy_snapshots", category: cat, strength: "supporting", sourceRef: ref(), confidence: null,
        bankEligible: false, internalOnly: false, submissionRisk: false, merchantVisible: true, includeInBankNarrative: false,
      }));
    }
  }

  return { facts, idOrder, idHist, idAvs, idTracking, policyIds };
}

// Build a complete narrative. Every section key present; sections with
// no supporting facts are emitted with text:"" and listed in
// omittedSections (exactly how the real writer does it).
function buildNarrative(reason, strength, factSet) {
  const { idOrder, idHist, idAvs, idTracking, policyIds } = factSet;
  const hedge = strength === "weak"
    ? "The available records are limited, but the following evidence is submitted in support of the merchant's position. "
    : strength === "moderate"
      ? "The available evidence, taken together, supports the merchant's position. "
      : "";

  const omitted = [];
  const empty = { text: "", usedFactIds: [] };

  const paymentText = idAvs
    ? "The available payment authentication signals support the conclusion that the transaction was authorized by the cardholder. Specifically, the billing address matched the issuer's records and the card verification code matched the issuer's records. These results indicate that the party who submitted the transaction had access to card verification credentials and billing details associated with the cardholder account."
    : "";
  if (!idAvs) omitted.push({ sectionKey: "paymentAuthenticationArgument", reason: "No payment authentication (AVS/CVV) fact is present in approvedFacts." });

  const fulfillmentText = idTracking
    ? "The order fulfillment records confirm that the merchandise was shipped and delivered to the address associated with the order. The carrier's tracking record reflects a delivered status."
    : "";
  if (!idTracking) omitted.push({ sectionKey: "fulfillmentArgument", reason: "The order is unfulfilled and no delivery_proof or shipping_tracking fact with a delivered status is present in approvedFacts." });

  const policyText = policyIds.length
    ? "The merchant's refund and shipping policies were published and available at checkout at the time of purchase, and the customer had the opportunity to review them prior to placing the order."
    : "";
  if (!policyIds.length) omitted.push({ sectionKey: "policyArgument", reason: "No policy snapshot facts are present in approvedFacts." });

  // communicationArgument + manualEvidenceArgument are always omitted for
  // these seeds (customer_communication is missing; no manual uploads).
  omitted.push({ sectionKey: "communicationArgument", reason: "No customer_communication approved facts are present. Customer communication is listed in missingEvidence." });
  omitted.push({ sectionKey: "manualEvidenceArgument", reason: "No manual evidence was submitted." });

  return {
    warnings: strength === "weak"
      ? ["caseStrength is 'weak': hedged framing has been applied throughout. The absence of delivery proof and customer communication limits the strength of this response."]
      : [],
    executiveSummary: {
      text: hedge + "The available records support the merchant's position that this transaction was consistent with a cardholder-authorized purchase. " + (idAvs ? "The payment authentication signals on record are consistent with a cardholder-initiated transaction. " : "") + (idTracking ? "The order was fulfilled and delivered to the customer. " : "") + "The order was placed via the merchant's web channel.",
      usedFactIds: [idOrder, idAvs, idTracking, ...policyIds].filter(Boolean),
    },
    transactionOverviewArgument: {
      text: "The order record confirms that the transaction was placed via the web channel. " + (idAvs ? "The payment was submitted with billing and card verification data that matched the cardholder account on file with the issuer. " : "") + "The merchant's records indicate no prior dispute history associated with this account.",
      usedFactIds: [idOrder, idAvs, idHist].filter(Boolean),
    },
    chronologyArgument: {
      text: "The order record documents that the transaction was placed via the web channel. " + (idTracking ? "The merchandise was subsequently shipped and delivered as reflected in the carrier's tracking record. " : "") + "The merchant's account history records indicate this account carried a dispute-free history at the time the order was created.",
      usedFactIds: [idOrder, idTracking, idHist].filter(Boolean),
    },
    paymentAuthenticationArgument: idAvs ? { text: paymentText, usedFactIds: [idAvs] } : empty,
    fulfillmentArgument: idTracking ? { text: fulfillmentText, usedFactIds: [idTracking] } : empty,
    communicationArgument: empty,
    policyArgument: policyIds.length ? { text: policyText, usedFactIds: policyIds } : empty,
    manualEvidenceArgument: empty,
    conclusion: {
      text: "The available evidence, taken together, is consistent with a cardholder-authorized transaction. The merchant respectfully requests that the dispute be resolved in its favour on the basis of the submitted records.",
      usedFactIds: [idOrder, idAvs, idTracking, ...policyIds].filter(Boolean),
    },
    omittedSections: omitted,
  };
}

// Reason-code MODULE KEY — must be a valid ReasonCodeModuleKey
// (lib/defence/types.ts). The detail renderer feeds this into
// familyKeyForModule()/isSectionDeniedForModule(); an unknown key made
// familyForModule() return undefined and crashed the Review and Forward
// tab with a client-side exception (dev 2026-07-26). These are NOT the
// bare network codes (visa_10_4) — they are the internal module keys.
const REASON_CODE_MODULE = {
  FRAUDULENT: "visa_10_4_fraud",
  PRODUCT_NOT_RECEIVED: "inr_product_not_received",
  PRODUCT_UNACCEPTABLE: "product_unacceptable",
};

// Reason → family_key / prompt_family. Verified against the real registry
// (familyKeyForModule): FRAUDULENT→unauthorized_fraud,
// PRODUCT_NOT_RECEIVED→item_not_received,
// PRODUCT_UNACCEPTABLE→product_not_as_described. Previously the defence
// row hardcoded 'fraud' for EVERY reason — a PNR/PUA pack labelled fraud.
const REASON_FAMILY = {
  FRAUDULENT: "unauthorized_fraud",
  PRODUCT_NOT_RECEIVED: "item_not_received",
  PRODUCT_UNACCEPTABLE: "product_not_as_described",
};

// ── dispute_events lifecycle (drives the Overview timeline) ───────────
// Description formats + actor/source enums mirror the localizer
// (lib/disputeEvents/localizeDescription.ts) and the real event
// generator (scripts/seed-surasvenne-events-and-items.mjs) so each row
// resolves to plain-language copy instead of a raw label fallback.
function dedupeKey(disputeId, eventType, eventAt, actorType) {
  return createHash("sha256").update(`${disputeId}|${eventType}|${eventAt}|${actorType}`).digest("hex").slice(0, 32);
}

function buildEvents(d, shopId, pack, strength) {
  const openedAt = d.initiated_at ?? new Date(Date.now() - 6 * 86400000).toISOString();
  const packAt = new Date(new Date(openedAt).getTime() + 30 * 60000).toISOString();
  const score = strength === "strong" ? 85 : strength === "moderate" ? 62 : 34;
  const rows = [];
  const add = (eventType, description, eventAt, actorType, sourceType, metadata = {}) => {
    rows.push({
      id: randomUUID(), dispute_id: d.id, shop_id: shopId, event_type: eventType,
      description, event_at: eventAt, actor_type: actorType, actor_ref: null,
      source_type: sourceType, visibility: "merchant_and_internal",
      metadata_json: metadata, dedupe_key: dedupeKey(d.id, eventType, eventAt, actorType),
    });
  };

  add("dispute_opened", `${d.reason} opened — chargeback / ${d.amount} ${d.currency_code ?? "USD"}`,
    openedAt, "shopify", "shopify_sync", { reason: d.reason, amount: d.amount, currency: d.currency_code ?? "USD" });
  add("pack_created", `Score: ${score}%, ${pack.pack_json?.sections?.length ?? 6} evidence items collected`,
    packAt, "disputedesk_system", "pack_engine", { score });

  // Saved-to-Shopify event only for stages past save.
  const saved = ["SAVED", "UNDER-REVIEW", "WON", "LOST"].some((s) => d.dispute_gid.includes(`SEED-STAGE-${s}`));
  if (saved) {
    const savedAt = new Date(new Date(packAt).getTime() + 60 * 60000).toISOString();
    add("evidence_saved_to_shopify", "11 evidence fields sent to Shopify",
      savedAt, "merchant_user", "user_action", { fields_sent: 11 });
  }

  // Sent-to-network + outcome for transmitted stages.
  if (d.submission_state === "submitted_confirmed") {
    const sentAt = new Date(new Date(packAt).getTime() + 2 * 60 * 60000).toISOString();
    add("submission_confirmed", "Evidence sent to card network", sentAt, "shopify", "shopify_sync", {});
  }
  if (d.final_outcome === "won" || d.final_outcome === "lost") {
    // Stable timestamp (dispute.closed_at, else a fixed offset from
    // openedAt) so re-runs produce the same dedupe_key — a Date.now()
    // base would mint a fresh key each run and leak a duplicate event.
    const closedAt = d.closed_at ?? new Date(new Date(openedAt).getTime() + 4 * 86400000).toISOString();
    add("status_changed", `submitted_to_bank → ${d.final_outcome}`, closedAt, "shopify", "shopify_sync",
      { from: "submitted_to_bank", to: d.final_outcome });
  }
  return rows;
}

// Per-stage defence-package lifecycle keyed off the dispute's REAL
// submission_state (not the gid label), so the defence status is
// consistent with what the dispute claims:
//   transmitted (submitted_confirmed) → submitted (on file with the bank)
//   saved to Shopify (saved_to_shopify) → final (the pipeline invariant:
//     saveToShopifyJob requires the latest defence row = status 'final'
//     with a pdf_path — a DRAFT can never have been saved to Shopify)
//   otherwise (ready/not-saved, needs_review) → draft (merchant's current
//     working letter, not yet saved)
function defencePackageStateFor(gidSuffix, strength, submissionState) {
  const mode = strength === "weak" || strength === "moderate" ? "narrow" : "full";
  if (submissionState === "submitted_confirmed") {
    return { status: "submitted", submitted: true, mode };
  }
  if (submissionState === "saved_to_shopify") {
    return { status: "final", submitted: false, mode };
  }
  return { status: "draft", submitted: false, mode };
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────

const { data: shop } = await sb.from("shops").select("id").eq("shop_domain", SHOP_DOMAIN).single();
if (!shop) { console.error("Shop not found"); process.exit(1); }

const { data: disputes } = await sb
  .from("disputes")
  .select("id, dispute_gid, reason, amount, currency_code, initiated_at, order_gid, normalized_status, final_outcome, submission_state, closed_at, customer_display_name")
  .eq("shop_id", shop.id)
  .like("dispute_gid", `${SEED_PREFIX}%`);

console.log(`\nFound ${disputes?.length ?? 0} SEED-STAGE disputes on ${SHOP_DOMAIN}\n`);
if (!disputes?.length) process.exit(0);

// Load their packs.
const { data: packs } = await sb
  .from("evidence_packs")
  .select("id, dispute_id, status, pack_json, completeness_score")
  .in("dispute_id", disputes.map((d) => d.id));
const packByDispute = new Map((packs ?? []).map((p) => [p.dispute_id, p]));

const plan = [];
for (const d of disputes) {
  const gidSuffix = d.dispute_gid.slice(SEED_PREFIX.length);
  const pack = packByDispute.get(d.id);
  if (!pack) { console.log(`  ${gidSuffix}: NO PACK — skipping`); continue; }
  if (pack.status === "building") { console.log(`  ${gidSuffix}: pack still building — no defence package (correct)`); continue; }

  // Intended tier from the SQL seed's stored case_strength; the profile
  // is chosen so the engine RECOMPUTES this same tier on read.
  const rawStrength = pack.pack_json?.case_strength?.overall ?? "moderate";
  const strength =
    rawStrength === "strong" ? "strong"
    : rawStrength === "moderate" ? "moderate"
    : "weak"; // weak + insufficient
  const profile = STRENGTH_PROFILES[strength];
  plan.push({ d, pack, gidSuffix, profile, strength });
}

console.log(`\nWill complete ${plan.length} disputes (pack sections + evidence_items + checklist_v2 + defence package).\n`);
if (!APPLY) {
  for (const p of plan) {
    const st = defencePackageStateFor(p.gidSuffix, p.strength, p.d.submission_state);
    console.log(`  ${p.gidSuffix.padEnd(16)} ${p.d.reason.padEnd(22)} strength=${p.strength.padEnd(8)} → defence: status=${st.status} mode=${st.mode}`);
  }
  console.log("\nDry run. Pass --apply to write.\n");
  process.exit(0);
}

// Idempotency: drop this shop's SEED-STAGE defence packages + evidence_items.
// dispute_events is APPEND-ONLY (a trigger rejects DELETE/UPDATE), so events
// are instead re-inserted with `on conflict (dedupe_key) do nothing` below —
// the deterministic dedupe_key makes a re-run a no-op rather than a dup.
const packIds = plan.map((p) => p.pack.id);
const { data: delDp } = await sb.from("defence_packages").delete().in("source_pack_id", packIds).select("id");
const { data: delItems } = await sb.from("evidence_items").delete().in("pack_id", packIds).select("id");
console.log(`Cleared ${delDp?.length ?? 0} old defence packages, ${delItems?.length ?? 0} old evidence_items.\n`);

let done = 0;
for (const { d, pack, gidSuffix, profile, strength } of plan) {
  const rng = makeRng(`${d.id}|${d.reason}`);
  const { sections, items } = buildSections(rng, d, profile.available, strength);
  const checklistV2 = buildChecklistV2(profile);

  // Recompute strength with the REAL engine over the checklist + payloads
  // we just built, keyed by field exactly as the workspace route does.
  // Store THIS value so the detail page (which recomputes on read) always
  // agrees with the saved pack — no stored-vs-recomputed drift. The seed's
  // intended tier still drives the evidence set, but the engine has the
  // final say on the label.
  const byField = {};
  for (const it of items) {
    for (const f of it.payload?.fieldsProvided ?? []) {
      if (!(f in byField)) byField[f] = { payload: it.payload };
    }
  }
  const engine = calculateCaseStrength(checklistV2, d.reason, { kind: "byField", map: byField });
  const engineOverall = engine.overall; // strong | moderate | weak | insufficient

  const priorCaseStrength = (pack.pack_json ?? {}).case_strength ?? {};

  // 1. pack_json.sections + checklist_v2 + engine-consistent case_strength
  const newPackJson = {
    ...(pack.pack_json ?? {}),
    version: "1.0.0",
    sections,
    disputeGid: d.dispute_gid,
    disputeReason: d.reason,
    generatedAt: new Date().toISOString(),
    completeness: pack.completeness_score ?? 72,
    case_strength: { ...priorCaseStrength, overall: engineOverall },
  };
  const { error: uErr } = await sb.from("evidence_packs")
    .update({ pack_json: newPackJson, checklist_v2: checklistV2, updated_at: new Date().toISOString() })
    .eq("id", pack.id);
  if (uErr) { console.error(`  ${gidSuffix}: pack update failed: ${uErr.message}`); continue; }

  // 2. evidence_items
  const itemRows = items.map((it) => ({
    id: randomUUID(), pack_id: pack.id, type: it.type, label: it.label,
    source: it.source, payload: it.payload, confidence: it.confidence,
  }));
  if (itemRows.length) {
    const { error: iErr } = await sb.from("evidence_items").insert(itemRows);
    if (iErr) console.error(`  ${gidSuffix}: items insert failed: ${iErr.message}`);
  }

  // 3. defence package (the rebuttal letter)
  const factSet = buildFacts(rng, profile, d.reason);
  const narrative = buildNarrative(d.reason, strength, factSet);
  const st = defencePackageStateFor(gidSuffix, strength, d.submission_state);
  const evidenceHash = createHash("sha256").update(`${d.id}|${JSON.stringify(factSet.facts)}`).digest("hex");
  const generatedAt = new Date(Date.now() - 2 * 86400000).toISOString();

  const dpRow = {
    id: randomUUID(),
    dispute_id: d.id,
    shop_id: shop.id,
    source_pack_id: pack.id,
    order_id: null,
    version: 1,
    status: st.status,
    package_mode: st.mode,
    generated_at: generatedAt,
    generated_by: "system",
    // final/submitted packages carry a rendered PDF (pipeline invariant:
    // saveToShopifyJob requires the latest defence row = 'final' WITH a
    // pdf_path). Draft working letters have none yet.
    pdf_path:
      st.status === "final" || st.status === "submitted"
        ? `defence/${d.id}/v1.pdf`
        : null,
    pdf_storage_bucket: "evidence-packs",
    evidence_hash: evidenceHash,
    llm_model: "claude-sonnet-4-5",
    // family/module derived from the dispute's REASON, not hardcoded fraud.
    prompt_family: REASON_FAMILY[d.reason] ?? "unauthorized_fraud",
    prompt_version: 1,
    reason_code_module: REASON_CODE_MODULE[d.reason] ?? "generic_fallback",
    output_schema_version: 1,
    validation_status: "ok",
    validation_errors: [],
    narrative_json: narrative,
    facts_json: factSet.facts,
    submitted_at: st.submitted ? generatedAt : null,
    submitted_by: st.submitted ? "seed_script" : null,
    family_key: REASON_FAMILY[d.reason] ?? "unauthorized_fraud",
  };
  const { error: dErr } = await sb.from("defence_packages").insert(dpRow);
  if (dErr) { console.error(`  ${gidSuffix}: defence package insert failed: ${dErr.message}`); continue; }

  // 4. dispute_events (append-only; idempotent via dedupe_key)
  const eventRows = buildEvents(d, shop.id, { pack_json: newPackJson }, strength);
  let evInserted = 0;
  if (eventRows.length) {
    const { error: eErr, count } = await sb
      .from("dispute_events")
      .upsert(eventRows, { onConflict: "dedupe_key", ignoreDuplicates: true, count: "exact" });
    if (eErr) console.error(`  ${gidSuffix}: events insert failed: ${eErr.message}`);
    else evInserted = count ?? eventRows.length;
  }

  done += 1;
  console.log(`  ${gidSuffix.padEnd(16)} ✓ ${sections.length} sections, ${itemRows.length} items, ${checklistV2.length} checklist, defence(${st.status}/${st.mode}), ${evInserted} events`);
}

// ── COMM-REQUESTED (#9007): real Gorgias backing ───────────────────────
// The "Review communication" state (attention_reason=gorgias_evidence_ready)
// PROMISES reviewable customer messages. Without the actual Gorgias rows
// the Evidence tab shows nothing — the pill lies. Seed the real records so
// the state has substance: integration + enrichment run + 2 matched
// tickets + 2 proposed evidence messages. Idempotent (deletes first).
async function seedGorgiasForCommRequested() {
  const commDispute = disputes.find(
    (d) => d.dispute_gid === `${SEED_PREFIX}COMM-REQUESTED`,
  );
  if (!commDispute) return;
  const dId = commDispute.id;

  // Clear prior gorgias rows (children first).
  await sb.from("gorgias_evidence_messages").delete().eq("dispute_id", dId);
  await sb.from("gorgias_matched_tickets").delete().eq("dispute_id", dId);
  await sb.from("gorgias_enrichment_runs").delete().eq("dispute_id", dId);

  // Integration (one per shop; connected — NOT needs_attention, so it
  // cannot trip technical_error on other disputes).
  let { data: integ } = await sb
    .from("integrations")
    .select("id")
    .eq("shop_id", shop.id)
    .eq("type", "gorgias")
    .maybeSingle();
  if (!integ) {
    const insMeta = { evidence_mode: "review", seed: true };
    const { data: created, error } = await sb
      .from("integrations")
      .insert({ shop_id: shop.id, type: "gorgias", status: "connected", meta: insMeta })
      .select("id")
      .single();
    if (error) { console.error(`  gorgias integration failed: ${error.message}`); return; }
    integ = created;
  }

  const runId = randomUUID();
  await sb.from("gorgias_enrichment_runs").insert({
    id: runId, shop_id: shop.id, dispute_id: dId, integration_id: integ.id,
    run_number: 1, status: "completed", trigger_source: "dispute_opened",
    attempt_count: 1, tickets_scanned: 5, tickets_high: 1, tickets_medium: 1, tickets_low: 3,
    messages_stored: 2, proposal_count: 2, approved_count: 0,
    analyzer_model: "claude-sonnet-4-5", analyzer_version: 1,
    prompt_tokens: 1200, completion_tokens: 350, duration_ms: 4200,
    daily_bucket: new Date().toISOString().slice(0, 10),
    started_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
    completed_at: new Date(Date.now() - 2 * 3600_000 + 4000).toISOString(),
  });

  const t1 = randomUUID();
  const t2 = randomUUID();
  await sb.from("gorgias_matched_tickets").insert([
    {
      id: t1, shop_id: shop.id, dispute_id: dId, integration_id: integ.id,
      gorgias_ticket_id: 880011, gorgias_customer_id: 550011, match_score: 92, confidence: "high",
      match_reasons: [
        { signal: "email_match", points: 50, detail: "Ticket email matches the order email" },
        { signal: "order_number", points: 42, detail: "Order referenced in the ticket" },
      ],
      matching_algorithm_version: 1, match_status: "proposed_match",
      analyzed_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
      ticket_snapshot: { subject: "Where is my order?", channel: "email", createdAt: new Date(Date.now() - 9 * 86400_000).toISOString() },
    },
    {
      id: t2, shop_id: shop.id, dispute_id: dId, integration_id: integ.id,
      gorgias_ticket_id: 880012, gorgias_customer_id: 550011, match_score: 68, confidence: "medium",
      match_reasons: [{ signal: "email_match", points: 50, detail: "Same customer email" }],
      matching_algorithm_version: 1, match_status: "proposed_match",
      analyzed_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
      ticket_snapshot: { subject: "Re: order received, thanks", channel: "email", createdAt: new Date(Date.now() - 5 * 86400_000).toISOString() },
    },
  ]);

  const { createHash: ch } = await import("node:crypto");
  const hash = (s) => ch("sha256").update(s).digest("hex");
  await sb.from("gorgias_evidence_messages").insert([
    {
      id: randomUUID(), shop_id: shop.id, dispute_id: dId, matched_ticket_id: t1,
      gorgias_message_id: 990021, sender_type: "customer", sender_name: commDispute.customer_display_name ?? "Customer",
      channel: "email", sent_at: new Date(Date.now() - 5 * 86400_000).toISOString(),
      message_text: "Hi, I actually did receive the package last week — please disregard my earlier message. Thank you!",
      content_truncated: false, original_character_count: 98, content_hash: hash("msg-990021-seed"),
      evidence_category: "delivery_recognition", confidence_score: 88,
      relevance_explanation: "Customer explicitly confirms receiving the order, which directly refutes the not-received claim.",
      explanation_edited: false, analyzer_model: "claude-sonnet-4-5", analyzer_prompt_version: 1, review_status: "proposed",
    },
    {
      id: randomUUID(), shop_id: shop.id, dispute_id: dId, matched_ticket_id: t2,
      gorgias_message_id: 990022, sender_type: "customer", sender_name: commDispute.customer_display_name ?? "Customer",
      channel: "email", sent_at: new Date(Date.now() - 5 * 86400_000).toISOString(),
      message_text: "Order received, thanks for the quick shipping.",
      content_truncated: false, original_character_count: 46, content_hash: hash("msg-990022-seed"),
      evidence_category: "transaction_recognition", confidence_score: 72,
      relevance_explanation: "Customer acknowledges receipt of the order.",
      explanation_edited: false, analyzer_model: "claude-sonnet-4-5", analyzer_prompt_version: 1, review_status: "proposed",
    },
  ]);
  console.log(`  COMM-REQUESTED   ✓ gorgias: integration + run + 2 tickets + 2 proposed messages`);
}
await seedGorgiasForCommRequested();

console.log(`\nDone. Completed ${done}/${plan.length} disputes.\n`);
process.exit(0);
