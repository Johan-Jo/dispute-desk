/**
 * Seed realistic historical data for the surasvenne.myshopify.com dev
 * shop so we can evaluate the Phase 1 fraud-intelligence dashboards
 * against a true-store-shaped dataset.
 *
 * What this seeds:
 *   - ~2500 `shopify_orders` rows spanning 2024-11-11 → 2026-03-04
 *     (stops the day before surasvenne's real Shopify install date so
 *     we never collide with orders the backfill orchestrator pulled
 *     from Shopify).
 *   - One `shopify_order_risk_assessments` row per order.
 *   - `shop_daily_metrics` rows covering the same date range, with a
 *     realistic chargeback rate (~0.4% on a healthy month) so the
 *     existing dashboard chargeback KPI also reflects a plausible
 *     store profile.
 *   - Regenerates `shop_fraud_daily_metrics` for the full window via
 *     the existing aggregator, so the embedded fraud panel reads
 *     real rollups.
 *
 * Distributions (target):
 *   risk_level_initial:    HIGH 5% · MEDIUM 4% · LOW 10% · NONE 80% · PENDING 1%
 *   fulfillment_status:    FULFILLED 90% · PARTIALLY 3% · UNFULFILLED 5% · CANCELLED 2%
 *   financial_status:      PAID 93% · REFUNDED 4% · PARTIALLY_REFUNDED 2% · VOIDED 1%
 *   payment_gateway:       shopify_payments 70% · paypal 18% · klarna 6% · manual 6%
 *   country (shipping):    SE 60% · DE 10% · NO 7% · FI 6% · DK 5% · US 4% · GB 3% · NL 3% · FR 2%
 *   fraud_protection_level:PROTECTED 10% · ACTIVE 65% · PENDING 6% · NOT_PROTECTED 14% · (null) 5%
 *   seasonality:           Nov–Dec spike (2× baseline), Jan–Feb dip (0.6×), other months 1×
 *
 * Cross-correlations modelled:
 *   - HIGH-risk orders are over-represented in cross-border + paypal/klarna gateways.
 *   - HIGH-risk + FULFILLED is allowed but rare (visible "high-risk fulfilled" signal).
 *   - REFUNDED orders skew LOW/NONE risk (customer-issue refunds, not fraud).
 *   - Shopify Protect status is null for non-shopify_payments orders.
 *
 * Idempotent: a re-run wipes prior seed rows (identified by
 * shopify_order_id starting with `gid://shopify/Order/SEED-`) and
 * regenerates everything from scratch. Real Shopify-sourced orders
 * are never touched.
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

config({ path: join(process.cwd(), ".env.local") });
config({ path: join(process.cwd(), ".env") });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

const SHOP_DOMAIN = "surasvenne.myshopify.com";
const SEED_PREFIX = "gid://shopify/Order/SEED-";
const WINDOW_START = "2024-11-11";
const WINDOW_END_EXCLUSIVE = "2026-03-04"; // surasvenne's real install date

// Tunables — keep modest so dashboards aren't overwhelmed but feel real.
const BASELINE_ORDERS_PER_DAY = 5;     // ~150/mo baseline
const TARGET_TOTAL_DISPUTES_SEEDED = 0; // we DON'T seed disputes — surasvenne already has 26 real ones

const RNG_SEED = 0x5e57; // deterministic so reruns are stable

// ── Tiny seeded RNG ─────────────────────────────────────────────────
let _rng = RNG_SEED;
function rand() {
  _rng = (_rng * 1664525 + 1013904223) >>> 0;
  return _rng / 0x100000000;
}
function pick(arr) {
  return arr[Math.floor(rand() * arr.length)];
}
function pickWeighted(buckets) {
  // buckets = [[value, weight], ...]
  const total = buckets.reduce((s, b) => s + b[1], 0);
  let r = rand() * total;
  for (const [v, w] of buckets) {
    r -= w;
    if (r <= 0) return v;
  }
  return buckets[buckets.length - 1][0];
}
function randInt(lo, hi) {
  return lo + Math.floor(rand() * (hi - lo + 1));
}
function randFloat(lo, hi) {
  return lo + rand() * (hi - lo);
}

// ── Distributions ───────────────────────────────────────────────────
const RISK_BUCKETS = [
  ["HIGH", 5],
  ["MEDIUM", 4],
  ["LOW", 10],
  ["NONE", 80],
  ["PENDING", 1],
];
const FULFILLMENT_BUCKETS = [
  ["FULFILLED", 90],
  ["PARTIALLY_FULFILLED", 3],
  ["UNFULFILLED", 5],
  ["CANCELLED", 2],
];
const FINANCIAL_BUCKETS = [
  ["PAID", 93],
  ["REFUNDED", 4],
  ["PARTIALLY_REFUNDED", 2],
  ["VOIDED", 1],
];
const GATEWAY_BUCKETS = [
  ["shopify_payments", 70],
  ["paypal", 18],
  ["klarna", 6],
  ["manual", 6],
];
const COUNTRY_BUCKETS = [
  ["SE", 60],
  ["DE", 10],
  ["NO", 7],
  ["FI", 6],
  ["DK", 5],
  ["US", 4],
  ["GB", 3],
  ["NL", 3],
  ["FR", 2],
];

// Risk recommendation derives from level. Matches Shopify's
// OrderRiskAssessmentResult enum.
function recommendationFor(level) {
  switch (level) {
    case "HIGH":
      return "INVESTIGATE";
    case "MEDIUM":
      return "INVESTIGATE";
    case "LOW":
      return "ACCEPT";
    case "NONE":
      return "ACCEPT";
    case "PENDING":
      return null;
    default:
      return null;
  }
}

// Synthetic risk-fact pool — keeps assessment payloads non-empty
// so future analytics that look at facts have something to chew on.
const FACT_POOL_BY_LEVEL = {
  HIGH: [
    { description: "Multiple orders attempted with different cards from the same device", sentiment: "NEGATIVE" },
    { description: "Shipping address is a known parcel-forwarder", sentiment: "NEGATIVE" },
    { description: "Billing and shipping country differ", sentiment: "NEGATIVE" },
    { description: "Order placed via VPN", sentiment: "NEGATIVE" },
    { description: "Card BIN issuer in high-fraud region", sentiment: "NEGATIVE" },
  ],
  MEDIUM: [
    { description: "First-time customer", sentiment: "NEUTRAL" },
    { description: "Shipping address is recently created", sentiment: "NEUTRAL" },
    { description: "Order placed outside typical hours", sentiment: "NEUTRAL" },
  ],
  LOW: [
    { description: "Returning customer with prior successful orders", sentiment: "POSITIVE" },
    { description: "Billing and shipping match", sentiment: "POSITIVE" },
    { description: "Customer email domain has good history", sentiment: "POSITIVE" },
  ],
  NONE: [], // Shopify's "cleared" verdict carries no facts most of the time.
  PENDING: [],
};

function factsFor(level) {
  const pool = FACT_POOL_BY_LEVEL[level] || [];
  if (pool.length === 0) return null;
  const n = level === "HIGH" ? randInt(2, 3) : randInt(1, 2);
  const facts = [];
  const used = new Set();
  while (facts.length < n) {
    const f = pick(pool);
    const key = f.description;
    if (used.has(key)) continue;
    used.add(key);
    facts.push(f);
  }
  return facts;
}

// Order total distribution: lognormal-ish, most around 500-1500 SEK
function sampleOrderTotal() {
  // Skewed: 70% in 200-1500, 25% in 1500-3500, 5% in 3500-8000
  const r = rand();
  if (r < 0.7) return Math.round(randFloat(200, 1500));
  if (r < 0.95) return Math.round(randFloat(1500, 3500));
  return Math.round(randFloat(3500, 8000));
}

// Seasonality multiplier for a given (year, month).
function seasonalMultiplier(year, month0) {
  // month0 is 0-indexed (Jan=0)
  if (month0 === 10 || month0 === 11) return 2.0; // Nov, Dec — BFCM / holidays
  if (month0 === 0 || month0 === 1) return 0.6;   // Jan, Feb — slow
  if (month0 === 5 || month0 === 6) return 1.2;   // Jun, Jul — summer bump
  return 1.0;
}

// ── Cross-correlation hooks ─────────────────────────────────────────
// HIGH-risk orders should over-represent in non-SE shipping + non-shopify_payments
function biasedCountry(riskLevel) {
  if (riskLevel === "HIGH") {
    // 70% non-SE for high-risk
    if (rand() < 0.7) return pick(["US", "GB", "DE", "FR", "NL"]);
  }
  return pickWeighted(COUNTRY_BUCKETS);
}

function biasedGateway(riskLevel) {
  if (riskLevel === "HIGH") {
    // 50% non-shopify_payments
    if (rand() < 0.5) return pick(["paypal", "klarna", "manual"]);
  }
  return pickWeighted(GATEWAY_BUCKETS);
}

// Fulfillment status biased by risk and financial status
function biasedFulfillment(riskLevel, financialStatus) {
  if (financialStatus === "VOIDED") return "CANCELLED";
  if (financialStatus === "REFUNDED") {
    return pickWeighted([
      ["FULFILLED", 60],
      ["CANCELLED", 30],
      ["UNFULFILLED", 10],
    ]);
  }
  // HIGH-risk orders are a bit more often cancelled or unfulfilled
  if (riskLevel === "HIGH") {
    return pickWeighted([
      ["FULFILLED", 70],
      ["CANCELLED", 15],
      ["UNFULFILLED", 10],
      ["PARTIALLY_FULFILLED", 5],
    ]);
  }
  return pickWeighted(FULFILLMENT_BUCKETS);
}

// Shopify Protect status. Null for non-shopify_payments.
function protectStatus(gateway) {
  if (gateway !== "shopify_payments") return null;
  return pickWeighted([
    ["PROTECTED", 10],
    ["ACTIVE", 65],
    ["PENDING", 6],
    ["NOT_PROTECTED", 14],
    [null, 5],
  ]);
}

// ── Build the orders ────────────────────────────────────────────────
function* eachDay(fromIso, toExclusiveIso) {
  const start = new Date(`${fromIso}T00:00:00Z`);
  const end = new Date(`${toExclusiveIso}T00:00:00Z`);
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    yield new Date(d);
  }
}

function buildOrderRow(shopId, date) {
  const orderId = `${SEED_PREFIX}${randomUUID()}`;
  const orderNumber = `#SEED-${Math.floor(rand() * 90000 + 10000)}`;
  const riskLevel = pickWeighted(RISK_BUCKETS);
  const recommendation = recommendationFor(riskLevel);
  const financialStatus = pickWeighted(FINANCIAL_BUCKETS);
  const fulfillmentStatus = biasedFulfillment(riskLevel, financialStatus);
  const gateway = biasedGateway(riskLevel);
  const country = biasedCountry(riskLevel);
  const fraudProtection = protectStatus(gateway);

  // Pick processedAt within the day, business-hours weighted
  const hour = pickWeighted([
    [9, 1], [10, 2], [11, 3], [12, 4], [13, 4], [14, 5],
    [15, 5], [16, 4], [17, 3], [18, 3], [19, 4], [20, 5],
    [21, 4], [22, 2], [23, 1], [0, 0.5], [8, 0.5],
  ]);
  const minute = randInt(0, 59);
  const second = randInt(0, 59);
  const processedAt = new Date(date);
  processedAt.setUTCHours(hour, minute, second, 0);
  const createdAt = new Date(processedAt.getTime() - randInt(30, 600) * 1000);

  // Fulfilled_at relative to processed
  let fulfilledAt = null;
  if (
    fulfillmentStatus === "FULFILLED" ||
    fulfillmentStatus === "PARTIALLY_FULFILLED"
  ) {
    // Most within 24h; high-risk sometimes within minutes (operational red flag)
    let delayMs;
    if (riskLevel === "HIGH" && rand() < 0.2) {
      delayMs = randInt(60, 600) * 1000; // 1-10 min (the future "fulfilled within 4 min" signal)
    } else {
      delayMs = randInt(2, 72) * 3600 * 1000; // 2-72 hours
    }
    fulfilledAt = new Date(processedAt.getTime() + delayMs);
  }
  let cancelledAt = null;
  let cancelReason = null;
  if (fulfillmentStatus === "CANCELLED") {
    const cancelDelayHrs = randInt(0, 48);
    cancelledAt = new Date(processedAt.getTime() + cancelDelayHrs * 3600 * 1000);
    cancelReason = pickWeighted([
      ["fraud", 15],
      ["customer", 40],
      ["inventory", 15],
      ["declined", 10],
      ["other", 20],
    ]);
  }

  const orderTotal = sampleOrderTotal();
  const currency = country === "SE" ? "SEK" : country === "GB" ? "GBP" : country === "US" ? "USD" : "EUR";

  return {
    shop_id: shopId,
    shopify_order_id: orderId,
    shopify_order_number: orderNumber,
    processed_at: processedAt.toISOString(),
    created_at_shopify: createdAt.toISOString(),
    cancelled_at: cancelledAt ? cancelledAt.toISOString() : null,
    fulfilled_at: fulfilledAt ? fulfilledAt.toISOString() : null,
    currency,
    order_total: orderTotal,
    country,
    is_cross_border: country !== "SE",
    distance_bucket: null,
    payment_gateway: gateway,
    financial_status: financialStatus,
    fulfillment_status: fulfillmentStatus,
    cancel_reason: cancelReason,
    risk_level_initial: riskLevel,
    risk_recommendation_initial: recommendation,
    risk_provider_initial: "shopify",
    fraud_protection_level: fraudProtection,
    has_chargeback: false,
    chargeback_type: null,
    chargeback_status: null,
  };
}

function buildAssessmentRow(shopId, order) {
  const level = order.risk_level_initial;
  return {
    shop_id: shopId,
    shopify_order_id: order.shopify_order_id,
    provider: "shopify",
    risk_level: level,
    recommendation: order.risk_recommendation_initial,
    facts_json: factsFor(level),
    assessed_at: order.processed_at,
  };
}

// ── Main ────────────────────────────────────────────────────────────
console.log(`\nResolving shop ${SHOP_DOMAIN}...`);
const { data: shop } = await sb
  .from("shops")
  .select("id")
  .eq("shop_domain", SHOP_DOMAIN)
  .single();
if (!shop) {
  console.error(`Shop ${SHOP_DOMAIN} not found`);
  process.exit(1);
}
const shopId = shop.id;
console.log(`  shop_id = ${shopId}`);

// 1. Wipe prior seed rows. The seed prefix guarantees we only touch
// fake data — real Shopify orders are untouched.
console.log("\nWiping prior seed rows...");
const { error: wipeAssessErr } = await sb
  .from("shopify_order_risk_assessments")
  .delete()
  .eq("shop_id", shopId)
  .like("shopify_order_id", `${SEED_PREFIX}%`);
if (wipeAssessErr) {
  console.error(`  assessments wipe failed: ${wipeAssessErr.message}`);
  process.exit(1);
}
const { error: wipeOrdersErr } = await sb
  .from("shopify_orders")
  .delete()
  .eq("shop_id", shopId)
  .like("shopify_order_id", `${SEED_PREFIX}%`);
if (wipeOrdersErr) {
  console.error(`  orders wipe failed: ${wipeOrdersErr.message}`);
  process.exit(1);
}
console.log("  done.");

// 2. Generate orders day by day with seasonality.
console.log("\nGenerating seed orders...");
const orders = [];
for (const date of eachDay(WINDOW_START, WINDOW_END_EXCLUSIVE)) {
  const month0 = date.getUTCMonth();
  const year = date.getUTCFullYear();
  const mult = seasonalMultiplier(year, month0);
  const ordersToday = Math.max(0, Math.round(BASELINE_ORDERS_PER_DAY * mult + (rand() - 0.5) * 2));
  for (let i = 0; i < ordersToday; i++) {
    orders.push(buildOrderRow(shopId, date));
  }
}
console.log(`  generated ${orders.length} orders`);

// 3. Bulk insert orders in batches (PostgREST has a row limit per request).
const BATCH = 500;
let insertedOrders = 0;
for (let i = 0; i < orders.length; i += BATCH) {
  const slice = orders.slice(i, i + BATCH);
  const { error } = await sb.from("shopify_orders").insert(slice);
  if (error) {
    console.error(`  insert batch ${i}-${i + slice.length} failed: ${error.message}`);
    process.exit(1);
  }
  insertedOrders += slice.length;
}
console.log(`  inserted ${insertedOrders} orders`);

// 4. Insert assessments. One per order.
console.log("\nInserting risk assessments...");
const assessments = orders.map((o) => buildAssessmentRow(shopId, o));
let insertedAssess = 0;
for (let i = 0; i < assessments.length; i += BATCH) {
  const slice = assessments.slice(i, i + BATCH);
  const { error } = await sb
    .from("shopify_order_risk_assessments")
    .insert(slice);
  if (error) {
    console.error(`  insert batch ${i}-${i + slice.length} failed: ${error.message}`);
    process.exit(1);
  }
  insertedAssess += slice.length;
}
console.log(`  inserted ${insertedAssess} assessments`);

// 5. Seed shop_daily_metrics for the same window with realistic
// chargeback rates. Existing real-data rows for surasvenne live in
// March–May 2026 (post-install); we touch only the seed window.
console.log("\nSeeding shop_daily_metrics...");
const dailyRows = [];
const orderCountByDate = new Map();
for (const o of orders) {
  const d = o.processed_at.slice(0, 10);
  orderCountByDate.set(d, (orderCountByDate.get(d) || 0) + 1);
}

for (const [date, orderCount] of orderCountByDate.entries()) {
  // ~0.4% chargeback rate, ~0.7% total dispute rate (~3% of disputes
  // are inquiries). Round down to integers — sparse on most days.
  const chargebackCount = rand() < (orderCount * 0.004) ? 1 : 0;
  const extraCb = rand() < (orderCount * 0.001) ? 1 : 0;
  const totalCb = chargebackCount + extraCb;
  const inquiryCount = rand() < (orderCount * 0.003) ? 1 : 0;
  const disputeCount = totalCb + inquiryCount;
  dailyRows.push({
    shop_id: shopId,
    date,
    order_count: orderCount,
    dispute_count: disputeCount,
    chargeback_count: totalCb,
    inquiry_count: inquiryCount,
    last_synced_at: new Date().toISOString(),
  });
}

// Wipe any prior seed-window daily metrics first to keep idempotency.
const { error: wipeDailyErr } = await sb
  .from("shop_daily_metrics")
  .delete()
  .eq("shop_id", shopId)
  .gte("date", WINDOW_START)
  .lt("date", WINDOW_END_EXCLUSIVE);
if (wipeDailyErr) {
  console.error(`  daily metrics wipe failed: ${wipeDailyErr.message}`);
  process.exit(1);
}
for (let i = 0; i < dailyRows.length; i += BATCH) {
  const slice = dailyRows.slice(i, i + BATCH);
  const { error } = await sb.from("shop_daily_metrics").insert(slice);
  if (error) {
    console.error(`  daily metrics insert failed: ${error.message}`);
    process.exit(1);
  }
}
console.log(`  inserted ${dailyRows.length} daily-metrics rows`);

// 6. Regenerate shop_fraud_daily_metrics for the full window.
// The aggregator is local-only (no Shopify call), so this is fast.
// Wipe seed-window rollups first, then iterate dates.
console.log("\nRegenerating shop_fraud_daily_metrics (this may take a moment)...");
const { error: wipeRollupErr } = await sb
  .from("shop_fraud_daily_metrics")
  .delete()
  .eq("shop_id", shopId)
  .gte("date", WINDOW_START)
  .lt("date", WINDOW_END_EXCLUSIVE);
if (wipeRollupErr) {
  console.error(`  rollup wipe failed: ${wipeRollupErr.message}`);
  process.exit(1);
}

// Lightweight inline aggregator — mirrors aggregateOrderCounts in
// lib/disputes/snapshotFraudDailyMetrics.ts but runs in-script to
// avoid having to spin up the Next runtime.
function rollupForDate(rows) {
  const out = {
    orders_total: rows.length,
    orders_low: 0, orders_medium: 0, orders_high: 0,
    orders_none: 0, orders_pending: 0,
    orders_fulfilled_high_risk: 0,
    fully_protected_value: 0, eligible_protected_value: 0,
  };
  for (const r of rows) {
    const risk = (r.risk_level_initial ?? "").toUpperCase();
    if (risk === "LOW") out.orders_low += 1;
    else if (risk === "MEDIUM") out.orders_medium += 1;
    else if (risk === "HIGH") {
      out.orders_high += 1;
      if (
        r.fulfillment_status &&
        ["FULFILLED", "PARTIAL", "PARTIALLY_FULFILLED"].includes(
          r.fulfillment_status.toUpperCase(),
        )
      ) {
        out.orders_fulfilled_high_risk += 1;
      }
    } else if (risk === "PENDING") out.orders_pending += 1;
    else out.orders_none += 1;

    const total = Number(r.order_total ?? 0);
    if (total > 0 && r.fraud_protection_level) {
      const s = r.fraud_protection_level.toUpperCase();
      if (s === "PROTECTED") out.fully_protected_value += total;
      if (["PROTECTED", "ACTIVE", "PENDING"].includes(s)) {
        out.eligible_protected_value += total;
      }
    }
  }
  return out;
}

// Bucket all seed orders by date, then write one row per date.
const ordersByDate = new Map();
for (const o of orders) {
  const d = o.processed_at.slice(0, 10);
  if (!ordersByDate.has(d)) ordersByDate.set(d, []);
  ordersByDate.get(d).push(o);
}

const rollupRows = [];
for (const [date, dayRows] of ordersByDate.entries()) {
  const agg = rollupForDate(dayRows);
  // Find dispute counts for this date in the daily-metrics row we just inserted.
  const dailyRow = dailyRows.find((r) => r.date === date);
  rollupRows.push({
    shop_id: shopId,
    date,
    ...agg,
    fraud_disputes: dailyRow?.chargeback_count ?? 0,
    total_disputes: dailyRow?.dispute_count ?? 0,
    chargebacks: dailyRow?.chargeback_count ?? 0,
    last_synced_at: new Date().toISOString(),
  });
}
for (let i = 0; i < rollupRows.length; i += BATCH) {
  const slice = rollupRows.slice(i, i + BATCH);
  const { error } = await sb
    .from("shop_fraud_daily_metrics")
    .insert(slice);
  if (error) {
    console.error(`  rollup insert failed: ${error.message}`);
    process.exit(1);
  }
}
console.log(`  wrote ${rollupRows.length} rollup rows`);

// 7. Update the shops row so the banner thinks the import covered
// the seed window. Cumulative total = seed + the 76 real orders.
const { count: realOrderCount } = await sb
  .from("shopify_orders")
  .select("id", { count: "exact", head: true })
  .eq("shop_id", shopId);
const orderTotalNow = realOrderCount ?? insertedOrders;

await sb
  .from("shops")
  .update({
    historical_import_status: "complete",
    historical_import_progress_pct: 100,
    historical_import_orders_processed: orderTotalNow,
    historical_import_orders_total: orderTotalNow,
    historical_import_since_date: WINDOW_START,
    historical_import_scope_granted: "read_all_orders",
    historical_import_completed_at: new Date().toISOString(),
  })
  .eq("id", shopId);

console.log(`\nDone. surasvenne now has:`);
console.log(`  ${orderTotalNow} total shopify_orders (${insertedOrders} seed + real)`);
console.log(`  ${insertedAssess} risk assessments`);
console.log(`  ${dailyRows.length} shop_daily_metrics rows`);
console.log(`  ${rollupRows.length} shop_fraud_daily_metrics rows`);
console.log(`  historical_import_status = complete, since_date = ${WINDOW_START}\n`);

process.exit(0);
