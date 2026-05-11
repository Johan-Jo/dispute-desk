/**
 * Seed evidence packs for surasvenne disputes that don't have one.
 *
 * Why this is needed: in normal DD operation, packs are auto-built
 * by the build_pack job when a dispute is synced in. Seeded
 * disputes were inserted directly — the pipeline never ran on
 * them, so the workspace pack tab is empty for ~40 of the 41
 * surasvenne disputes. This script simulates what the pipeline
 * would have produced so the workspace mirrors a true-merchant
 * workflow.
 *
 * Per-dispute pack mapping:
 *
 *   final_outcome=won OR lost:
 *     pack.status = 'saved_to_shopify_verified'
 *     completeness_score = 75-95
 *     submission_readiness = 'submitted'
 *     last_saved_to_shopify_at = dispute.evidence_saved_to_shopify_at
 *
 *   final_outcome=accepted:
 *     no pack — the merchant didn't contest. Skipped.
 *
 *   normalized_status = submitted_to_bank (mid-flight, real Shopify):
 *     pack.status = 'saved_to_shopify_verified'
 *     completeness_score = 70-90
 *     submission_readiness = 'submitted'
 *
 *   normalized_status = submitted_to_shopify (pack saved, awaiting auto-submit):
 *     pack.status = 'saved_to_shopify_unverified'
 *     completeness_score = 65-85
 *     submission_readiness = 'submitted'
 *
 *   normalized_status = new (truly net-new, needs action):
 *     pack.status = 'ready' or 'draft' — pipeline built a pack but
 *       merchant hasn't reviewed or saved it yet.
 *     completeness_score = 55-80
 *     submission_readiness = 'ready' or 'ready_with_warnings'
 *
 *   anything else:
 *     skipped.
 *
 * Idempotent: skips any dispute that already has at least one pack
 * row. Real packs (those built by the real pipeline) are never
 * touched.
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

config({ path: join(process.cwd(), ".env.local") });
config({ path: join(process.cwd(), ".env") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const SHOP_DOMAIN = "surasvenne.myshopify.com";

let _rng = 0xa1cef00d | 0;
function rand() { _rng = ((_rng * 1664525 + 1013904223) >>> 0); return _rng / 0x100000000; }
function randInt(lo, hi) { return lo + Math.floor(rand() * (hi - lo + 1)); }
function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }

// Realistic checklist shape mirroring what the completeness engine
// would produce for a FRAUDULENT dispute. Minimal but structurally
// valid so the workspace's pack tab can render it.
function buildChecklist(completeness) {
  // Roughly: high completeness = more "covered" items; low = more
  // "missing".
  const items = [
    { key: "order_details", label: "Order details", covered: true, weight: 10 },
    { key: "customer_communication", label: "Customer communication", covered: completeness > 60, weight: 12 },
    { key: "shipping_address", label: "Shipping address", covered: true, weight: 8 },
    { key: "billing_address", label: "Billing address", covered: completeness > 50, weight: 6 },
    { key: "fulfillment_tracking", label: "Fulfillment tracking", covered: completeness > 65, weight: 14 },
    { key: "avs_cvv_match", label: "AVS / CVV match", covered: completeness > 70, weight: 10 },
    { key: "device_geolocation", label: "Device / geolocation", covered: completeness > 75, weight: 8 },
    { key: "policy_screenshots", label: "Refund / shipping policy", covered: completeness > 55, weight: 6 },
    { key: "customer_account_age", label: "Customer account age & history", covered: completeness > 60, weight: 8 },
    { key: "3ds_authentication", label: "3-D Secure authentication", covered: completeness > 80, weight: 8 },
    { key: "rebuttal_narrative", label: "Bank-rebuttal narrative", covered: completeness > 70, weight: 10 },
  ];
  return { items };
}

// Pack-json snapshot. Minimal — the workspace renders out of
// canonicalEvidence for some flows but checklist_v2 + completeness
// are what the merchant sees on the pack-status row.
function buildPackJson(d, completeness) {
  return {
    seed: true,
    dispute_id: d.id,
    dispute_type: d.reason ?? "FRAUDULENT",
    completeness,
    overall_strength: completeness >= 80 ? "strong" :
                      completeness >= 65 ? "moderate" : "weak",
    summary: `Auto-built evidence pack for ${d.reason} dispute. ` +
             `${completeness}% complete based on available signals.`,
  };
}

function isCovered(d) {
  // A pack already exists for this dispute — skip.
  return false; // We probe per dispute below.
}

async function disputeHasPack(disputeId) {
  const { count } = await sb
    .from("evidence_packs")
    .select("id", { count: "exact", head: true })
    .eq("dispute_id", disputeId);
  return (count ?? 0) > 0;
}

const { data: shop } = await sb
  .from("shops").select("id").eq("shop_domain", SHOP_DOMAIN).single();
if (!shop) { console.error("Shop not found"); process.exit(1); }

const { data: disputes } = await sb
  .from("disputes")
  .select(
    "id, dispute_gid, status, normalized_status, final_outcome, reason, amount, currency_code, initiated_at, submitted_at, evidence_saved_to_shopify_at, closed_at",
  )
  .eq("shop_id", shop.id);

console.log(`\nProbing ${disputes.length} disputes for pack coverage...\n`);

let created = 0;
let skippedExisting = 0;
let skippedNoPack = 0;
const byStatus = {};

for (const d of disputes) {
  if (await disputeHasPack(d.id)) {
    skippedExisting += 1;
    continue;
  }

  let packStatus = null;
  let submissionReadiness = null;
  let completeness = null;
  let lastSavedAt = null;

  if (d.final_outcome === "accepted") {
    // Accepted disputes don't get a pack — merchant chose not to
    // contest. Workspace renders the "no pack" state appropriately.
    skippedNoPack += 1;
    continue;
  }

  if (d.final_outcome === "won" || d.final_outcome === "lost") {
    packStatus = "saved_to_shopify_verified";
    submissionReadiness = "submitted";
    completeness = randInt(75, 95);
    lastSavedAt = d.evidence_saved_to_shopify_at ?? d.submitted_at;
  } else if (d.normalized_status === "submitted_to_bank") {
    packStatus = "saved_to_shopify_verified";
    submissionReadiness = "submitted";
    completeness = randInt(70, 90);
    lastSavedAt = d.evidence_saved_to_shopify_at ?? d.submitted_at;
  } else if (d.normalized_status === "submitted_to_shopify") {
    packStatus = "saved_to_shopify_unverified";
    submissionReadiness = "submitted";
    completeness = randInt(65, 85);
    lastSavedAt = d.evidence_saved_to_shopify_at;
  } else if (d.normalized_status === "new" || d.status === "NEEDS_RESPONSE") {
    // Auto-built but merchant hasn't reviewed/saved yet.
    const built = pick(["ready", "ready", "draft"]); // mostly ready
    packStatus = built;
    submissionReadiness = completeness < 70 ? "ready_with_warnings" : "ready";
    completeness = randInt(55, 80);
    submissionReadiness = completeness < 70 ? "ready_with_warnings" : "ready";
  } else {
    skippedNoPack += 1;
    continue;
  }

  const checklist = buildChecklist(completeness);
  const packJson = buildPackJson(d, completeness);

  const row = {
    id: randomUUID(),
    shop_id: shop.id,
    dispute_id: d.id,
    status: packStatus,
    completeness_score: completeness,
    checklist,
    checklist_v2: checklist,
    pack_json: packJson,
    submission_readiness: submissionReadiness,
    waived_items: [],
    last_saved_to_shopify_at: lastSavedAt,
    created_by: "seed_script",
    created_at: d.initiated_at, // pack auto-builds shortly after dispute opens
    updated_at: lastSavedAt ?? d.initiated_at,
  };

  const { error } = await sb.from("evidence_packs").insert(row);
  if (error) {
    console.error(`  failed for ${d.dispute_gid}: ${error.message}`);
    continue;
  }
  created += 1;
  byStatus[packStatus] = (byStatus[packStatus] || 0) + 1;
}

console.log(`\nCreated:           ${created} packs`);
console.log(`Skipped (had pack):${skippedExisting}`);
console.log(`Skipped (no pack): ${skippedNoPack}`);
console.log(`\nPack status mix:`);
for (const [k, v] of Object.entries(byStatus)) console.log(`  ${k.padEnd(35)} ${v}`);
process.exit(0);
