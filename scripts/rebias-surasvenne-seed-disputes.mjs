/**
 * Re-link surasvenne's SEED disputes to over-represent HIGH-risk
 * orders so the risk-to-dispute correlation feature surfaces a
 * realistic merchant-shape signal.
 *
 * The v2 seed tied each dispute to a uniformly-random seed order,
 * which produced flat conversion rates across risk buckets — fine
 * arithmetically, wrong as a model of how real merchants experience
 * fraud disputes. Real shops see HIGH-risk orders convert to disputes
 * at meaningfully higher rates than CLEARED/LOW orders.
 *
 * Target distribution for the 24 SEED disputes:
 *   HIGH:    ~42% (~10 disputes)
 *   MEDIUM:  ~21% (~5 disputes)
 *   LOW:     ~12% (~3 disputes)
 *   CLEARED: ~25% (~6 disputes)
 *
 * The script:
 *   1. Loads all SEED-prefix disputes + all SEED orders bucketed by
 *      risk_level_initial.
 *   2. For each dispute, picks a target risk bucket from the
 *      distribution above, then samples a random order from that
 *      bucket (one that hasn't already been claimed by another seed
 *      dispute).
 *   3. Updates the dispute's order_gid + amount + currency_code to
 *      match the newly linked order.
 *
 * Real disputes (those tied to real Shopify orders) are NEVER
 * touched — they have their own (real) order linkage from Shopify
 * sync. Only `gid://shopify/Dispute/SEED-*` rows get rebiased.
 *
 * Idempotent: each run picks a fresh distribution via the seeded
 * RNG so re-running gives a consistent result.
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "node:path";

config({ path: join(process.cwd(), ".env.local") });
config({ path: join(process.cwd(), ".env") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const SHOP_DOMAIN = "surasvenne.myshopify.com";
const DISPUTE_PREFIX = "gid://shopify/Dispute/SEED-";
const ORDER_PREFIX = "gid://shopify/Order/SEED-";

// Target distribution. Weights are relative — the script picks a
// bucket per dispute weighted by these numbers.
const TARGET_DISTRIBUTION = [
  ["HIGH", 42],
  ["MEDIUM", 21],
  ["LOW", 12],
  ["NONE", 25],
];

let _rng = 0xb1a5_eed_e | 0;
function rand() { _rng = ((_rng * 1664525 + 1013904223) >>> 0); return _rng / 0x100000000; }
function pickWeighted(buckets) {
  const total = buckets.reduce((s, b) => s + b[1], 0);
  let r = rand() * total;
  for (const [v, w] of buckets) { r -= w; if (r <= 0) return v; }
  return buckets[buckets.length - 1][0];
}

const { data: shop } = await sb
  .from("shops").select("id").eq("shop_domain", SHOP_DOMAIN).single();
if (!shop) { console.error("Shop not found"); process.exit(1); }

console.log("\nLoading SEED disputes + SEED orders bucketed by risk...");

const { data: disputes } = await sb
  .from("disputes")
  .select("id, dispute_gid, order_gid, amount, currency_code, initiated_at")
  .eq("shop_id", shop.id)
  .like("dispute_gid", `${DISPUTE_PREFIX}%`);
console.log(`  SEED disputes: ${disputes.length}`);

async function fetchOrders() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("shopify_orders")
      .select("shopify_order_id, risk_level_initial, order_total, currency, processed_at")
      .eq("shop_id", shop.id)
      .like("shopify_order_id", `${ORDER_PREFIX}%`)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}
const orders = await fetchOrders();
const byBucket = { HIGH: [], MEDIUM: [], LOW: [], NONE: [], PENDING: [] };
for (const o of orders) {
  const r = (o.risk_level_initial ?? "NONE").toUpperCase();
  if (byBucket[r]) byBucket[r].push(o);
  else byBucket.NONE.push(o);
}
console.log("  SEED orders by bucket:");
for (const [k, v] of Object.entries(byBucket)) console.log(`    ${k.padEnd(8)} ${v.length}`);

// Sort disputes by initiated_at so the rebiasing is deterministic
// w.r.t. the dataset's natural order.
disputes.sort((a, b) => (a.initiated_at ?? "").localeCompare(b.initiated_at ?? ""));

const claimedGids = new Set();
let touched = 0;
const summaryBucket = { HIGH: 0, MEDIUM: 0, LOW: 0, NONE: 0 };

for (const d of disputes) {
  let targetBucket;
  let order = null;
  // Try up to 5 attempts to find an unclaimed order in the target
  // bucket. If the bucket is exhausted, fall through to whichever
  // bucket still has supply.
  for (let attempt = 0; attempt < 5 && !order; attempt++) {
    targetBucket = pickWeighted(TARGET_DISTRIBUTION);
    const pool = byBucket[targetBucket].filter(
      (o) => !claimedGids.has(o.shopify_order_id),
    );
    if (pool.length === 0) continue;
    order = pool[Math.floor(rand() * pool.length)];
  }
  // Last-resort: any unclaimed order across all buckets.
  if (!order) {
    for (const k of ["HIGH", "MEDIUM", "LOW", "NONE"]) {
      const pool = byBucket[k].filter((o) => !claimedGids.has(o.shopify_order_id));
      if (pool.length) {
        order = pool[Math.floor(rand() * pool.length)];
        targetBucket = k;
        break;
      }
    }
  }
  if (!order) {
    console.warn(`  no available order for dispute ${d.dispute_gid} — skipped`);
    continue;
  }
  claimedGids.add(order.shopify_order_id);

  const update = {
    order_gid: order.shopify_order_id,
    amount: order.order_total,
    currency_code: order.currency,
  };

  const { error } = await sb
    .from("disputes")
    .update(update)
    .eq("id", d.id);
  if (error) {
    console.error(`  dispute ${d.dispute_gid} re-link failed: ${error.message}`);
    continue;
  }
  summaryBucket[targetBucket] = (summaryBucket[targetBucket] ?? 0) + 1;
  touched += 1;
}

console.log(`\nRebiased ${touched} disputes`);
console.log(`Resulting distribution:`);
for (const [k, v] of Object.entries(summaryBucket)) console.log(`  ${k.padEnd(8)} ${v}`);

// Verify what conversion rates look like now.
const buckets = { HIGH: { o: 0, d: 0 }, MEDIUM: { o: 0, d: 0 }, LOW: { o: 0, d: 0 }, NONE: { o: 0, d: 0 } };
const disputedGids = new Set();
const { data: allDispGids } = await sb.from("disputes")
  .select("order_gid")
  .eq("shop_id", shop.id)
  .not("order_gid", "is", null);
for (const r of allDispGids) disputedGids.add(r.order_gid);
for (const o of orders) {
  const r = (o.risk_level_initial ?? "NONE").toUpperCase();
  const b = buckets[r] ?? buckets.NONE;
  b.o += 1;
  if (disputedGids.has(o.shopify_order_id)) b.d += 1;
}
console.log(`\nProjected conversion rates (SEED orders only):`);
for (const [k, v] of Object.entries(buckets)) {
  const pct = v.o > 0 ? ((v.d / v.o) * 100).toFixed(2) : "—";
  console.log(`  ${k.padEnd(8)} ${v.d} / ${v.o} = ${pct}%`);
}
process.exit(0);
