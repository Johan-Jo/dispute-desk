/**
 * Backfill canonical pack_json.sections + evidence_items + checklist_v2
 * for surasvenne seed packs whose workspace tabs render empty.
 *
 * Context: 22 of 61 surasvenne packs have neither pack_json.sections
 * nor evidence_items rows. The earlier `seed-surasvenne-events-and-items.mjs`
 * filter required `pack.checklist_v2.items` which seed packs never had
 * (they stored a different shape in `checklist.items`), so the items
 * insert silently no-op'd for those packs. Opening one of those disputes
 * in the workspace shows "no evidence" everywhere.
 *
 * This script writes the canonical shape the workspace API reads:
 *   - pack_json.sections[]   (primary source for evidenceItemsByField
 *                              fallback in app/api/disputes/[id]/workspace)
 *   - evidence_items rows    (primary read for EvidenceTab section §2)
 *   - checklist_v2           (drives MissingOrWeakSection + coverage)
 *
 * Field keys use the canonical workspace vocabulary
 * (order_confirmation, billing_address_match, avs_cvv_match,
 *  activity_log, ip_location_check, shipping_tracking, delivery_proof,
 *  customer_communication, refund_policy, shipping_policy,
 *  cancellation_policy) — NOT the broken legacy keys (order_details,
 *  shipping_address, fulfillment_tracking, device_geolocation) that
 *  the original seeder used.
 *
 * Idempotent: skips any pack that already has evidence_items rows OR
 * pack_json.sections. Pass --apply to write; default is dry-run.
 *
 * Per-dispute deterministic: RNG seeded on dispute_id hash so a re-run
 * produces identical data.
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";

config({ path: join(process.cwd(), ".env.local") });

const sb = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const SHOP_DOMAIN = "surasvenne.myshopify.com";
const APPLY = process.argv.includes("--apply");

// ── Per-dispute deterministic RNG ────────────────────────────────────
function makeRng(seedStr) {
  let s = parseInt(createHash("sha256").update(seedStr).digest("hex").slice(0, 8), 16);
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ── Reason → field mix ───────────────────────────────────────────────
// Per-reason canonical field set, in the order they appear in
// `checklist_v2` for real packs. Status defaults to `available` for
// most, `unavailable` for fulfillment fields when the dispute is
// FRAUDULENT (most fraud disputes are unfulfilled/digital), `missing`
// for one or two items so MissingOrWeakSection has content to render.
const REASON_PROFILES = {
  FRAUDULENT: {
    available: [
      "order_confirmation",
      "billing_address_match",
      "avs_cvv_match",
      "activity_log",
      "ip_location_check",
      "customer_account_info",
    ],
    missing: ["customer_communication"],
    unavailable: [
      { field: "shipping_tracking", reason: "Order is unfulfilled" },
      { field: "delivery_proof", reason: "Order is unfulfilled" },
    ],
  },
  PRODUCT_NOT_RECEIVED: {
    available: [
      "order_confirmation",
      "shipping_tracking",
      "delivery_proof",
      "activity_log",
      "shipping_policy",
    ],
    missing: ["customer_communication"],
    unavailable: [],
  },
  SUBSCRIPTION_CANCELED: {
    available: [
      "order_confirmation",
      "cancellation_policy",
      "activity_log",
      "billing_address_match",
    ],
    missing: ["customer_communication", "duplicate_explanation"],
    unavailable: [],
  },
  DUPLICATE: {
    available: ["order_confirmation", "billing_address_match", "activity_log"],
    missing: ["duplicate_explanation"],
    unavailable: [],
  },
  CREDIT_NOT_PROCESSED: {
    available: ["order_confirmation", "refund_policy", "activity_log"],
    missing: ["customer_communication"],
    unavailable: [],
  },
  PRODUCT_UNACCEPTABLE: {
    available: [
      "order_confirmation",
      "refund_policy",
      "shipping_policy",
      "activity_log",
    ],
    missing: ["product_description", "customer_communication"],
    unavailable: [],
  },
};

// Display labels — must match what the workspace UI shows.
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
  duplicate_explanation: "Duplicate Explanation",
};

// Each field → its checklist_v2 metadata (priority, source, collection).
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
  cancellation_policy: { priority: "recommended", source: "auto_policy", collectionType: "auto" },
  product_description: { priority: "recommended", source: "manual_upload", collectionType: "manual" },
  duplicate_explanation: { priority: "critical", source: "manual_upload", collectionType: "manual" },
};

// ── Section builders ─────────────────────────────────────────────────
// Each maps a set of field-keys to a single pack_json section AND a
// matching evidence_items row. Group by section so the canonical shape
// matches what real packs emit (one section per collector pass).

function buildSections(rng, dispute, fields) {
  const sections = [];
  const items = [];
  const orderNumberShort = String(Math.floor(rng() * 9000) + 1000);
  const orderGid = dispute.order_gid ?? `gid://shopify/Order/SEED-${dispute.id}`;
  const orderTotal = dispute.amount ?? 100;
  const currency = dispute.currency_code ?? "USD";

  const has = (f) => fields.includes(f);

  // ── Order section ──
  if (has("order_confirmation") || has("billing_address_match")) {
    const provided = ["order_confirmation", "billing_address_match"].filter(has);
    const data = {
      orderId: orderGid,
      orderName: `#${orderNumberShort}`,
      createdAt: dispute.initiated_at ?? new Date().toISOString(),
      totals: {
        total: String(orderTotal),
        subtotal: String(orderTotal),
        tax: "0.0",
        shipping: "0.0",
        refunded: "0.0",
        discounts: "0.0",
        currency,
      },
      lineItems: [
        {
          sku: `SKU-${pick(rng, ["APP", "ELEC", "TOY", "HOME", "BEAUTY"])}-${pad(Math.floor(rng() * 200))}`,
          title: pick(rng, [
            "Cordless Drill 18V",
            "1080p USB Webcam",
            "Wool Blend Throw Blanket",
            "Smart Indoor Plant Pot",
            "Adjustable Standing Desk",
          ]),
          quantity: 1 + Math.floor(rng() * 2),
          total: String(orderTotal),
          currency,
          variant: null,
        },
      ],
      billingAddress: {
        city: pick(rng, ["Stockholm", "Göteborg", "Malmö", "Berlin", "Oslo"]),
        zipPrefix: String(Math.floor(rng() * 900) + 100),
        countryCode: pick(rng, ["SE", "DE", "NO", "FI", "DK"]),
      },
      cancelledAt: null,
    };
    sections.push({ type: "order", label: `Order #${orderNumberShort}`, source: "shopify_order", fieldsProvided: provided, data });
    items.push({
      type: "order",
      label: `Order #${orderNumberShort}`,
      source: "shopify_order",
      payload: { ...data, fieldsProvided: provided },
      confidence: round2(0.9 + rng() * 0.09),
    });
  }

  // ── Activity log (customer history) ──
  if (has("activity_log")) {
    const data = {
      eventCount: 4 + Math.floor(rng() * 8),
      firstEventAt: new Date(Date.now() - (180 + Math.floor(rng() * 600)) * 86400000).toISOString(),
      lastEventAt: dispute.initiated_at ?? new Date().toISOString(),
    };
    sections.push({ type: "access_log", label: "Customer activity log", source: "shopify_order", fieldsProvided: ["activity_log"], data });
    items.push({
      type: "other",
      label: "Customer activity log",
      source: "shopify_order",
      payload: { ...data, fieldsProvided: ["activity_log"] },
      confidence: round2(0.85 + rng() * 0.12),
    });
  }

  // ── Customer account info ──
  if (has("customer_account_info")) {
    const data = {
      customerCreatedAt: new Date(Date.now() - (30 + Math.floor(rng() * 800)) * 86400000).toISOString(),
      ordersCount: 1 + Math.floor(rng() * 12),
      totalSpent: String(orderTotal * (1 + Math.floor(rng() * 6))),
    };
    sections.push({ type: "other", label: "Customer profile", source: "shopify_order", fieldsProvided: ["customer_account_info"], data });
    items.push({
      type: "other",
      label: "Customer profile",
      source: "shopify_order",
      payload: { ...data, fieldsProvided: ["customer_account_info"] },
      confidence: round2(0.85 + rng() * 0.1),
    });
  }

  // ── AVS / CVV ──
  if (has("avs_cvv_match")) {
    const data = { avs_result_code: "Y", cvv_result_code: "M", processor: "stripe" };
    sections.push({ type: "other", label: "AVS / CVV match", source: "shopify_transactions", fieldsProvided: ["avs_cvv_match"], data });
    items.push({
      type: "other",
      label: "AVS / CVV match",
      source: "shopify_transactions",
      payload: { ...data, fieldsProvided: ["avs_cvv_match"] },
      confidence: round2(0.92 + rng() * 0.07),
    });
  }

  // ── IP / location ──
  if (has("ip_location_check")) {
    const country = pick(rng, ["SE", "DE", "NO", "FI", "DK"]);
    const data = { ipCountry: country, ipMatchesBilling: true, asn: `AS${10000 + Math.floor(rng() * 50000)}` };
    sections.push({ type: "other", label: "IP & location check", source: "ipinfo_io", fieldsProvided: ["ip_location_check"], data });
    items.push({
      type: "other",
      label: "IP & location check",
      source: "ipinfo_io",
      payload: { ...data, fieldsProvided: ["ip_location_check"] },
      confidence: round2(0.85 + rng() * 0.12),
    });
  }

  // ── Shipping tracking + delivery proof ──
  if (has("shipping_tracking") || has("delivery_proof")) {
    const provided = ["shipping_tracking", "delivery_proof"].filter(has);
    const carrier = pick(rng, ["PostNord", "DHL", "Bring", "GLS"]);
    const data = {
      carrier,
      trackingNumber: String(Math.floor(rng() * 900000000) + 100000000),
      shippedAt: new Date(Date.now() - (10 + Math.floor(rng() * 60)) * 86400000).toISOString(),
      deliveredAt: new Date(Date.now() - (5 + Math.floor(rng() * 30)) * 86400000).toISOString(),
      status: "delivered",
    };
    sections.push({ type: "tracking", label: `Tracking — ${carrier}`, source: "shopify_fulfillment", fieldsProvided: provided, data });
    items.push({
      type: "tracking",
      label: `Tracking — ${carrier}`,
      source: "shopify_fulfillment",
      payload: { ...data, fieldsProvided: provided },
      confidence: round2(0.9 + rng() * 0.08),
    });
  }

  // ── Policy snapshots ──
  const policyProvided = ["refund_policy", "shipping_policy", "cancellation_policy"].filter(has);
  if (policyProvided.length) {
    const data = {
      refundUrl: `https://${SHOP_DOMAIN}/policies/refund`,
      shippingUrl: `https://${SHOP_DOMAIN}/policies/shipping`,
      cancellationUrl: `https://${SHOP_DOMAIN}/policies/cancellation`,
    };
    sections.push({ type: "policy", label: "Store policies", source: "policy_snapshots", fieldsProvided: policyProvided, data });
    items.push({
      type: "policy",
      label: "Store policies",
      source: "policy_snapshots",
      payload: { ...data, fieldsProvided: policyProvided },
      confidence: round2(0.95 + rng() * 0.04),
    });
  }

  return { sections, items };
}

// ── Helpers ──────────────────────────────────────────────────────────
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
function pad(n) { return String(n).padStart(4, "0"); }
function round2(x) { return Number(x.toFixed(2)); }

// ── Main ─────────────────────────────────────────────────────────────
const { data: shop } = await sb
  .from("shops").select("id").eq("shop_domain", SHOP_DOMAIN).single();
if (!shop) { console.error("Shop not found"); process.exit(1); }

const { data: packs } = await sb
  .from("evidence_packs")
  .select("id, dispute_id, status, pack_json, checklist_v2, completeness_score")
  .eq("shop_id", shop.id);

console.log(`Found ${packs.length} packs on ${SHOP_DOMAIN}`);

// Target: packs whose live dispute renders empty in the workspace.
// "Empty" = no pack_json.sections AND no evidence_items with a
// non-empty payload.fieldsProvided. Orphan packs (no matching dispute)
// are skipped — those are cleanup-track, not backfill-track.
const targets = [];
let orphanCount = 0;
for (const p of packs) {
  const { data: live } = await sb
    .from("disputes").select("id").eq("id", p.dispute_id).maybeSingle();
  if (!live) { orphanCount++; continue; }

  const hasSections = (p.pack_json?.sections?.length ?? 0) > 0;
  const { data: items } = await sb
    .from("evidence_items").select("id, payload").eq("pack_id", p.id);
  const itemsWithFP = (items ?? []).filter(
    (i) => Array.isArray(i.payload?.fieldsProvided) && i.payload.fieldsProvided.length > 0,
  );
  if (hasSections || itemsWithFP.length > 0) continue;

  targets.push({ pack: p, existingItemIds: (items ?? []).map((i) => i.id) });
}

console.log(`Skipped ${orphanCount} orphan packs (no matching dispute).`);
console.log(`Packs needing backfill: ${targets.length}`);
if (!targets.length) process.exit(0);

if (!APPLY) {
  console.log("\nDry run. Pass --apply to write.\n");
  for (const t of targets.slice(0, 5)) {
    const { pack: p, existingItemIds } = t;
    const { data: d } = await sb
      .from("disputes")
      .select("id, reason")
      .eq("id", p.dispute_id).single();
    const profile = REASON_PROFILES[d.reason] ?? REASON_PROFILES.FRAUDULENT;
    console.log(`  pack ${p.id} (dispute ${d.id.slice(0, 8)}…, ${d.reason}): would clear ${existingItemIds.length} stale items, write ${profile.available.length} sections+items, ${profile.missing.length} missing, ${profile.unavailable.length} unavailable checklist rows`);
  }
  if (targets.length > 5) console.log(`  …and ${targets.length - 5} more`);
  process.exit(0);
}

let updated = 0;
let itemsInserted = 0;
let itemsDeleted = 0;

for (const target of targets) {
  const { pack, existingItemIds } = target;
  const { data: d } = await sb
    .from("disputes")
    .select("id, dispute_gid, reason, amount, currency_code, initiated_at, order_gid")
    .eq("id", pack.dispute_id).maybeSingle();
  if (!d) { console.warn(`  pack ${pack.id}: dispute missing — skipping`); continue; }

  const profile = REASON_PROFILES[d.reason] ?? REASON_PROFILES.FRAUDULENT;
  const rng = makeRng(`${d.id}|${d.reason}`);
  const { sections, items } = buildSections(rng, d, profile.available);

  // checklist_v2 = available (built sections) + missing + unavailable
  const checklistV2 = [];
  for (const f of profile.available) {
    const meta = FIELD_META[f] ?? { priority: "recommended", source: "auto_shopify", collectionType: "auto" };
    checklistV2.push({
      field: f, label: FIELD_LABELS[f] ?? f, status: "available",
      priority: meta.priority, source: meta.source, collectionType: meta.collectionType, blocking: false,
    });
  }
  for (const f of profile.missing) {
    const meta = FIELD_META[f] ?? { priority: "recommended", source: "manual_upload", collectionType: "manual" };
    checklistV2.push({
      field: f, label: FIELD_LABELS[f] ?? f, status: "missing",
      priority: meta.priority, source: meta.source, collectionType: meta.collectionType, blocking: false,
    });
  }
  for (const u of profile.unavailable) {
    const meta = FIELD_META[u.field] ?? { priority: "recommended", source: "unavailable_from_source", collectionType: "auto" };
    checklistV2.push({
      field: u.field, label: FIELD_LABELS[u.field] ?? u.field, status: "unavailable",
      priority: meta.priority, source: "unavailable_from_source", collectionType: meta.collectionType, blocking: false,
      unavailableReason: u.reason,
    });
  }

  // Merge new pack_json shape, preserving fields the seed already wrote
  // (seed, summary, completeness, overall_strength).
  const newPackJson = {
    ...(pack.pack_json ?? {}),
    version: "1.0.0",
    sections,
    disputeGid: d.dispute_gid,
    disputeReason: d.reason,
    generatedAt: new Date().toISOString(),
    completeness: pack.completeness_score ?? 72,
  };

  const { error: uErr } = await sb
    .from("evidence_packs")
    .update({
      pack_json: newPackJson,
      checklist_v2: checklistV2,
      updated_at: new Date().toISOString(),
    })
    .eq("id", pack.id);
  if (uErr) { console.error(`  pack ${pack.id} update failed: ${uErr.message}`); continue; }
  updated++;

  // Drop stale items (wrong labels, empty fieldsProvided) before
  // inserting canonical ones. evidence_items has no inbound FKs.
  if (existingItemIds.length) {
    const { error: delErr } = await sb
      .from("evidence_items").delete().in("id", existingItemIds);
    if (delErr) console.error(`  pack ${pack.id} stale-items delete failed: ${delErr.message}`);
    else itemsDeleted += existingItemIds.length;
  }

  const rows = items.map((it) => ({
    id: randomUUID(),
    pack_id: pack.id,
    type: it.type,
    label: it.label,
    source: it.source,
    payload: it.payload,
    confidence: it.confidence,
  }));
  if (rows.length) {
    const { error: iErr } = await sb.from("evidence_items").insert(rows);
    if (iErr) console.error(`  pack ${pack.id} items insert failed: ${iErr.message}`);
    else itemsInserted += rows.length;
  }
  console.log(`  pack ${pack.id} (${d.reason}): cleared ${existingItemIds.length} stale, wrote ${sections.length} sections, ${rows.length} items, ${checklistV2.length} checklist rows`);
}

console.log(`\nDone. Packs updated: ${updated}. Stale items deleted: ${itemsDeleted}. New items inserted: ${itemsInserted}.`);
