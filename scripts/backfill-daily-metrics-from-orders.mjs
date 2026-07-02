/**
 * Backfill `shop_daily_metrics` from the LOCAL `shopify_orders` table.
 *
 * Why: the live snapshot job (lib/disputes/snapshotShopDailyMetrics.ts)
 * only ever ran for the recent window, so the rollup covers ~90 days
 * even when a shop has years of imported orders. The admin Risk Profile
 * reads exclusively from this rollup, so "Total orders" and the
 * chargeback-rate denominator are capped at the rollup's coverage.
 *
 * This script rebuilds the per-UTC-day rows from data we already hold:
 *   - order_count      : count of shopify_orders bucketed by UTC day of
 *                        processed_at (fallback created_at_shopify).
 *   - dispute_count    : disputes whose initiated_at UTC-day == the row.
 *   - chargeback_count : subset with phase='chargeback'.
 *   - inquiry_count    : subset with phase='inquiry'.
 *
 * This matches the snapshot job's schema and UTC-day anchoring, but
 * sources orders locally (no Shopify API load). It is idempotent:
 * upsert on (shop_id, date), refreshing last_synced_at.
 *
 * SAFETY:
 *   - Reads + writes PROD Supabase (aokhplydttxtebvbeuzc) via
 *     service role. Guarded on the ref below.
 *   - --dry prints the plan without writing.
 *   - Only touches shop_daily_metrics for the target shop.
 *
 * Usage:
 *   node scripts/backfill-daily-metrics-from-orders.mjs <shop_domain> [--dry]
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });
config({ path: join(process.cwd(), ".env.production.local"), override: false });

const SHOP_DOMAIN = process.argv[2];
const DRY = process.argv.includes("--dry");
if (!SHOP_DOMAIN) {
  console.error("Usage: node scripts/backfill-daily-metrics-from-orders.mjs <shop_domain> [--dry]");
  process.exit(1);
}

const SUPA_URL = process.env.NEW_SUPABASE_URL;
const SUPA_KEY = process.env.NEW_SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY || !SUPA_URL.includes("aokhplydttxtebvbeuzc")) {
  console.error("Refusing: NEW_SUPABASE_URL must be prod ref aokhplydttxtebvbeuzc.");
  process.exit(1);
}
const sb = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

function utcDay(iso) {
  if (!iso) return null;
  return String(iso).slice(0, 10);
}

const { data: shop } = await sb
  .from("shops")
  .select("id, shop_domain")
  .eq("shop_domain", SHOP_DOMAIN)
  .maybeSingle();
if (!shop) {
  console.error(`Shop not found: ${SHOP_DOMAIN}`);
  process.exit(1);
}

// ── Page through ALL orders (12k+ > 1000 default limit) ─────────────
const orderCountByDay = new Map();
let from = 0;
const PAGE = 1000;
let totalOrders = 0;
let skippedNoDate = 0;
for (;;) {
  const { data: rows, error } = await sb
    .from("shopify_orders")
    .select("processed_at, created_at_shopify")
    .eq("shop_id", shop.id)
    .order("id", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) throw new Error(`orders page failed: ${error.message}`);
  if (!rows?.length) break;
  for (const r of rows) {
    const day = utcDay(r.processed_at) ?? utcDay(r.created_at_shopify);
    if (!day) {
      skippedNoDate += 1;
      continue;
    }
    orderCountByDay.set(day, (orderCountByDay.get(day) ?? 0) + 1);
    totalOrders += 1;
  }
  if (rows.length < PAGE) break;
  from += PAGE;
}

// ── Disputes bucketed by initiated_at UTC day + phase ───────────────
const disputeByDay = new Map(); // day -> { total, chargeback, inquiry }
{
  const { data: disputes, error } = await sb
    .from("disputes")
    .select("initiated_at, phase")
    .eq("shop_id", shop.id);
  if (error) throw new Error(`disputes failed: ${error.message}`);
  for (const d of disputes ?? []) {
    const day = utcDay(d.initiated_at);
    if (!day) continue;
    const cur = disputeByDay.get(day) ?? { total: 0, chargeback: 0, inquiry: 0 };
    cur.total += 1;
    if (d.phase === "chargeback") cur.chargeback += 1;
    else if (d.phase === "inquiry") cur.inquiry += 1;
    disputeByDay.set(day, cur);
  }
}

// ── Union of all days that have orders or disputes ──────────────────
const allDays = new Set([...orderCountByDay.keys(), ...disputeByDay.keys()]);
const sortedDays = [...allDays].sort();

console.log(`\n=== Backfill plan for ${shop.shop_domain} ===`);
console.log(`orders counted: ${totalOrders} (skipped ${skippedNoDate} with no date)`);
console.log(`distinct order-days: ${orderCountByDay.size}`);
console.log(`distinct dispute-days: ${disputeByDay.size}`);
console.log(`total rows to upsert: ${sortedDays.length}`);
console.log(`date range: ${sortedDays[0]} .. ${sortedDays[sortedDays.length - 1]}`);

const nowIso = new Date().toISOString();
const upserts = sortedDays.map((day) => {
  const o = orderCountByDay.get(day) ?? 0;
  const d = disputeByDay.get(day) ?? { total: 0, chargeback: 0, inquiry: 0 };
  return {
    shop_id: shop.id,
    date: day,
    order_count: o,
    dispute_count: d.total,
    chargeback_count: d.chargeback,
    inquiry_count: d.inquiry,
    last_synced_at: nowIso,
  };
});

const grandOrders = upserts.reduce((s, r) => s + r.order_count, 0);
console.log(`\nsum(order_count) after backfill: ${grandOrders}`);

if (DRY) {
  console.log("\n--dry: no writes. Sample rows:");
  console.log(upserts.slice(0, 3));
  console.log("...");
  console.log(upserts.slice(-3));
  process.exit(0);
}

// ── Upsert in chunks ────────────────────────────────────────────────
const CHUNK = 500;
let written = 0;
for (let i = 0; i < upserts.length; i += CHUNK) {
  const batch = upserts.slice(i, i + CHUNK);
  const { error } = await sb
    .from("shop_daily_metrics")
    .upsert(batch, { onConflict: "shop_id,date" });
  if (error) throw new Error(`upsert chunk failed: ${error.message}`);
  written += batch.length;
  process.stdout.write(`\rupserted ${written}/${upserts.length}`);
}
console.log(`\n✓ Backfill complete: ${written} rows for ${shop.shop_domain}.`);
