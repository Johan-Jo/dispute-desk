/**
 * Seed dispute_events (timeline) + evidence_items (pack accordion)
 * for surasvenne, completing the true-merchant data shape.
 *
 * dispute_events:
 *   For each dispute, generate a realistic event ledger matching the
 *   lifecycle stage it's already in (initiated_at → pack_created →
 *   evidence_saved → submission_confirmed → resyncs → closed event
 *   with the final outcome). Each event uses a deterministic
 *   dedupe_key keyed on (dispute_id + event_type + sequence) so the
 *   append-only trigger never sees a duplicate on re-run.
 *
 * evidence_items:
 *   For each seeded evidence_pack, populate the per-item evidence
 *   accordion. Item set keyed off the pack's checklist coverage:
 *   each "covered" checklist row gets a matching evidence_items row
 *   with type/label/source/payload/confidence. Items match Shopify
 *   FRAUDULENT-dispute evidence expectations (AVS, CVV, billing/
 *   shipping match, tracking, customer history, 3DS).
 *
 * Idempotent:
 *   - dispute_events use unique dedupe_key — re-run skips inserts
 *     for events that already exist.
 *   - evidence_items: skipped if the pack already has any rows
 *     (avoids stacking duplicates on re-run).
 *
 * Real disputes:
 *   - dispute_events: real disputes may already have some events
 *     from sync_disputes — that's fine, the dedupe_key prevents
 *     collision and we add the missing pack/submission events.
 *   - evidence_items: real packs that have items are skipped
 *     entirely. Real packs without items get the same treatment as
 *     seed packs.
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";

config({ path: join(process.cwd(), ".env.local") });
config({ path: join(process.cwd(), ".env") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const SHOP_DOMAIN = "surasvenne.myshopify.com";

let _rng = 0x71eed5_eed | 0;
function rand() { _rng = ((_rng * 1664525 + 1013904223) >>> 0); return _rng / 0x100000000; }
function randInt(lo, hi) { return lo + Math.floor(rand() * (hi - lo + 1)); }
function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }
function plusHours(iso, h) { return new Date(new Date(iso).getTime() + h * 3600000).toISOString(); }
function plusDays(iso, d) { return new Date(new Date(iso).getTime() + d * 86400000).toISOString(); }
function dedupeKey(parts) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

const { data: shop } = await sb
  .from("shops").select("id").eq("shop_domain", SHOP_DOMAIN).single();
if (!shop) { console.error("Shop not found"); process.exit(1); }
const shopId = shop.id;

// ── Part 1: dispute_events ──────────────────────────────────────────
console.log("\n=== Part 1: dispute_events ===\n");

const { data: disputes } = await sb
  .from("disputes")
  .select(
    "id, dispute_gid, reason, amount, currency_code, initiated_at, submitted_at, evidence_saved_to_shopify_at, closed_at, final_outcome, normalized_status, submission_state",
  )
  .eq("shop_id", shopId);

let eventsInserted = 0;
let eventsSkipped = 0;

function addEvent(events, base) {
  events.push({
    id: randomUUID(),
    dispute_id: base.dispute_id,
    shop_id: shopId,
    event_type: base.event_type,
    description: base.description ?? null,
    event_at: base.event_at,
    actor_type: base.actor_type,
    actor_ref: base.actor_ref ?? null,
    source_type: base.source_type,
    visibility: base.visibility ?? "merchant_and_internal",
    metadata_json: base.metadata_json ?? {},
    dedupe_key: dedupeKey([base.dispute_id, base.event_type, base.event_at, base.actor_type]),
  });
}

for (const d of disputes) {
  if (!d.initiated_at) continue;

  const events = [];

  // 1. dispute_opened — at initiated_at, from Shopify sync.
  addEvent(events, {
    dispute_id: d.id,
    event_type: "dispute_opened",
    description: `${d.reason ?? "FRAUDULENT"} opened — chargeback / ${d.amount} ${d.currency_code}`,
    event_at: d.initiated_at,
    actor_type: "shopify",
    source_type: "shopify_sync",
    metadata_json: { reason: d.reason, amount: d.amount, currency: d.currency_code },
  });

  // 2. pack_created — pack-engine auto-build, a few hours after the dispute opens.
  const packCreatedAt = plusHours(d.initiated_at, randInt(1, 6));
  addEvent(events, {
    dispute_id: d.id,
    event_type: "pack_created",
    description: `Score: ${randInt(55, 95)}%, ${randInt(6, 11)} evidence items collected`,
    event_at: packCreatedAt,
    actor_type: "disputedesk_system",
    source_type: "pack_engine",
  });

  // 3. evidence_saved_to_shopify — if the dispute has that field set.
  if (d.evidence_saved_to_shopify_at) {
    addEvent(events, {
      dispute_id: d.id,
      event_type: "evidence_saved_to_shopify",
      description: `${randInt(8, 14)} evidence fields sent to Shopify`,
      event_at: d.evidence_saved_to_shopify_at,
      actor_type: pick(["merchant_user", "disputedesk_system"]),
      actor_ref: "auto_save_gate",
      source_type: "user_action",
      metadata_json: { fields_sent: randInt(8, 14) },
    });
  }

  // 4. submission_confirmed — if submitted_at is set.
  if (d.submitted_at) {
    addEvent(events, {
      dispute_id: d.id,
      event_type: "submission_confirmed",
      description: null, // i18n picks up the canonical copy
      event_at: d.submitted_at,
      actor_type: "shopify",
      source_type: "shopify_sync",
    });
  }

  // 5. Periodic resyncs — 1 to 3 events between submission and now.
  if (d.submitted_at) {
    const resyncCount = randInt(1, 3);
    const submittedTime = new Date(d.submitted_at).getTime();
    const endTime = new Date(d.closed_at ?? new Date().toISOString()).getTime();
    if (endTime > submittedTime) {
      for (let i = 0; i < resyncCount; i++) {
        const t = new Date(submittedTime + ((endTime - submittedTime) * (i + 1)) / (resyncCount + 1));
        addEvent(events, {
          dispute_id: d.id,
          event_type: "dispute_resynced",
          description: "Resynced by automation.",
          event_at: t.toISOString(),
          actor_type: "disputedesk_system",
          actor_ref: "sync_disputes_cron",
          source_type: "shopify_sync",
          visibility: "internal_only",
        });
      }
    }
  }

  // 6. status_changed — final close transition.
  if (d.closed_at && d.final_outcome) {
    const closeFrom = d.final_outcome === "accepted" ? "needs_response" : "submitted_to_bank";
    addEvent(events, {
      dispute_id: d.id,
      event_type: "status_changed",
      description: `${closeFrom} → ${d.final_outcome}`,
      event_at: d.closed_at,
      actor_type: "shopify",
      source_type: "shopify_sync",
      metadata_json: { from: closeFrom, to: d.final_outcome },
    });
  }

  // Insert in chunks; each event has its own dedupe_key so a
  // duplicate insert is a unique-violation we swallow per row.
  for (const e of events) {
    const { error } = await sb.from("dispute_events").insert(e);
    if (error) {
      // 23505 = unique violation on dedupe_key — fine, we've
      // already seeded this event in a prior run.
      if (error.code === "23505") { eventsSkipped += 1; continue; }
      console.error(`  event insert failed: ${error.message}`);
      continue;
    }
    eventsInserted += 1;
  }
}

console.log(`Inserted ${eventsInserted} dispute_events (skipped ${eventsSkipped} duplicates)`);

// ── Part 2: evidence_items ─────────────────────────────────────────
console.log("\n=== Part 2: evidence_items ===\n");

const { data: packs } = await sb
  .from("evidence_packs")
  .select("id, dispute_id, completeness_score, checklist_v2")
  .eq("shop_id", shopId);

// Item template per checklist key. Maps to evidence_items.type
// (one of: order, shipping, tracking, policy, comms, other).
const ITEM_TEMPLATES = {
  order_details: {
    type: "order", source: "shopify_order",
    labelFn: (d) => "Order details",
    payloadFn: (d) => ({
      order_number: d.dispute_gid?.slice(-6),
      amount: d.amount, currency: d.currency_code,
      processed_at: d.initiated_at,
    }),
  },
  customer_communication: {
    type: "comms", source: "shopify_order_events",
    labelFn: () => "Customer communication history",
    payloadFn: () => ({
      email_thread_count: randInt(0, 4),
      last_message_at: null,
    }),
  },
  shipping_address: {
    type: "shipping", source: "shopify_order",
    labelFn: () => "Shipping address",
    payloadFn: () => ({ country: pick(["SE", "DE", "NO", "FI", "DK"]), zip_prefix: String(randInt(100, 999)) }),
  },
  billing_address: {
    type: "order", source: "shopify_order",
    labelFn: () => "Billing address (matches shipping)",
    payloadFn: () => ({ matches_shipping: true }),
  },
  fulfillment_tracking: {
    type: "tracking", source: "shopify_fulfillment",
    labelFn: () => `Tracking — ${pick(["DHL", "PostNord", "Bring", "GLS"])} #${randInt(100000000, 999999999)}`,
    payloadFn: () => ({
      carrier: pick(["DHL", "PostNord", "Bring", "GLS"]),
      delivered_at: new Date(Date.now() - randInt(30, 200) * 86400000).toISOString(),
      status: "delivered",
    }),
  },
  avs_cvv_match: {
    type: "order", source: "shopify_transaction",
    labelFn: () => "AVS + CVV match",
    payloadFn: () => ({
      avs_result_code: "Y",
      cvv_result_code: "M",
    }),
  },
  device_geolocation: {
    type: "other", source: "shopify_order",
    labelFn: () => "Device / IP geolocation",
    payloadFn: () => ({
      ip_country: pick(["SE", "DE", "NO"]),
      device_id_match: true,
    }),
  },
  policy_screenshots: {
    type: "policy", source: "shop_policy",
    labelFn: () => "Refund + shipping policy",
    payloadFn: () => ({
      refund_url: "https://surasvenne.myshopify.com/policies/refund",
      shipping_url: "https://surasvenne.myshopify.com/policies/shipping",
    }),
  },
  customer_account_age: {
    type: "other", source: "shopify_customer",
    labelFn: () => "Customer account history",
    payloadFn: () => ({
      created_days_ago: randInt(30, 800),
      number_of_orders: randInt(1, 12),
    }),
  },
  "3ds_authentication": {
    type: "other", source: "shopify_transaction_receipt",
    labelFn: () => "3-D Secure authentication",
    payloadFn: () => ({ authenticated: true, provider: "stripe" }),
  },
  rebuttal_narrative: {
    type: "other", source: "pack_engine",
    labelFn: () => "Bank-rebuttal narrative",
    payloadFn: () => ({
      length_words: randInt(180, 320),
      tone: "confident",
    }),
  },
};

let itemsInserted = 0;
let packsSkipped = 0;
let packsCovered = 0;

for (const pack of packs) {
  // Skip packs that already have items.
  const { count: existing } = await sb
    .from("evidence_items")
    .select("id", { count: "exact", head: true })
    .eq("pack_id", pack.id);
  if ((existing ?? 0) > 0) { packsSkipped += 1; continue; }

  const checklist = pack.checklist_v2;
  if (!checklist?.items) continue;

  // Find the source dispute to power the labelFn/payloadFn.
  const dispute = disputes.find((d) => d.id === pack.dispute_id);
  if (!dispute) continue;

  const rows = [];
  for (const item of checklist.items) {
    if (!item.covered) continue; // only insert items the pack claims to cover
    const tmpl = ITEM_TEMPLATES[item.key];
    if (!tmpl) continue;
    rows.push({
      id: randomUUID(),
      pack_id: pack.id,
      type: tmpl.type,
      label: tmpl.labelFn(dispute),
      source: tmpl.source,
      payload: tmpl.payloadFn(dispute),
      confidence: Number((0.85 + rand() * 0.14).toFixed(2)),
    });
  }
  if (rows.length === 0) continue;
  const { error } = await sb.from("evidence_items").insert(rows);
  if (error) {
    console.error(`  evidence_items insert failed for pack ${pack.id}: ${error.message}`);
    continue;
  }
  itemsInserted += rows.length;
  packsCovered += 1;
}

console.log(`Inserted ${itemsInserted} evidence_items across ${packsCovered} packs`);
console.log(`Skipped ${packsSkipped} packs (already had items)`);
process.exit(0);
