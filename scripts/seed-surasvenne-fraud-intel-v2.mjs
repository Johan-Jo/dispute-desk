/**
 * Seed v2 — average-merchant data shape for surasvenne.
 *
 * v1 stopped at 2026-03-04 (surasvenne's real Shopify install date)
 * so the recent 30-day window had only the 9 real Shopify-fetched
 * orders + 9 real recent disputes = 100% chargeback rate. Plus the
 * historical seed window had no disputes at all, making the 90d and
 * 365d windows look like "no chargeback history".
 *
 * v2 fixes both. Strategy:
 *
 * 1. Extend orders through to today (2026-05-11) so the recent
 *    30-day window has volume to dilute the real disputes.
 *    Real Shopify orders are untouched — seed orders stack alongside.
 *
 * 2. Seed ~25 disputes spread across months 4–18 of the window
 *    (skipping the recent 60 days where real disputes already live)
 *    so 90d/365d look like a healthy mid-volume store with ~0.5%
 *    chargeback rate over time. Disputes tied to seed orders.
 *
 * 3. Outcome / phase / reason / status mix realistic:
 *      phase:   75% chargeback · 25% inquiry
 *      reason:  50% FRAUDULENT · 20% PRODUCT_NOT_RECEIVED ·
 *               12% PRODUCT_UNACCEPTABLE · 10% SUBSCRIPTION_CANCELED ·
 *               8% CREDIT_NOT_PROCESSED
 *      status:  20% NEEDS_RESPONSE · 15% under_review ·
 *               25% won · 30% lost · 10% accepted
 *
 * 4. Refresh shop_daily_metrics and shop_fraud_daily_metrics for the
 *    entire window so the chargeback-rate KPI and the fraud panel
 *    both read coherent rollups.
 *
 * Idempotent: wipes prior seed rows (orders, assessments, disputes)
 * by the `SEED-` prefix, regenerates. Real data never touched. RNG
 * is seeded — reruns produce the same dataset.
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
const ORDER_PREFIX = "gid://shopify/Order/SEED-";
const DISPUTE_PREFIX = "gid://shopify/Dispute/SEED-";

const WINDOW_START = "2024-11-11";
// Through yesterday — today's data is still in flight, no point
// seeding a partial day.
const WINDOW_END_EXCLUSIVE = "2026-05-11";

// Volume tunables — calibrated for "average healthy Shopify merchant
// at moderate scale." ~10 orders/day baseline × 1.0 mean seasonal
// multiplier ≈ 300 orders/mo, ~5400 orders over 18 months.
const BASELINE_ORDERS_PER_DAY = 10;

// Disputes target. ~0.5% chargeback rate over 5400 orders ≈ 27
// chargebacks. Add ~25% inquiry rate on top → ~33 total disputes,
// of which we seed ~25 (the remainder is the real disputes already
// in surasvenne's DB).
const DISPUTE_TARGET = 25;
// Don't seed disputes inside the recent 60 days — the real ones
// already cover that band, stacking would create the very problem
// we're solving.
const DISPUTE_SKIP_RECENT_DAYS = 60;

const RNG_SEED = 0xa53eed02 | 0;

let _rng = RNG_SEED >>> 0;
function rand() {
  _rng = (_rng * 1664525 + 1013904223) >>> 0;
  return _rng / 0x100000000;
}
function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }
function pickWeighted(buckets) {
  const total = buckets.reduce((s, b) => s + b[1], 0);
  let r = rand() * total;
  for (const [v, w] of buckets) { r -= w; if (r <= 0) return v; }
  return buckets[buckets.length - 1][0];
}
function randInt(lo, hi) { return lo + Math.floor(rand() * (hi - lo + 1)); }
function randFloat(lo, hi) { return lo + rand() * (hi - lo); }

// ── Distributions (same shape as v1, modest tuning) ────────────────
const RISK_BUCKETS = [
  ["HIGH", 5], ["MEDIUM", 4], ["LOW", 10], ["NONE", 80], ["PENDING", 1],
];
const FULFILLMENT_BUCKETS = [
  ["FULFILLED", 90], ["PARTIALLY_FULFILLED", 3],
  ["UNFULFILLED", 5], ["CANCELLED", 2],
];
const FINANCIAL_BUCKETS = [
  ["PAID", 93], ["REFUNDED", 4],
  ["PARTIALLY_REFUNDED", 2], ["VOIDED", 1],
];
const GATEWAY_BUCKETS = [
  ["shopify_payments", 70], ["paypal", 18], ["klarna", 6], ["manual", 6],
];
const COUNTRY_BUCKETS = [
  ["SE", 60], ["DE", 10], ["NO", 7], ["FI", 6], ["DK", 5],
  ["US", 4], ["GB", 3], ["NL", 3], ["FR", 2],
];
const DISPUTE_REASON_BUCKETS = [
  ["FRAUDULENT", 50],
  ["PRODUCT_NOT_RECEIVED", 20],
  ["PRODUCT_UNACCEPTABLE", 12],
  ["SUBSCRIPTION_CANCELED", 10],
  ["CREDIT_NOT_PROCESSED", 8],
];
const DISPUTE_STATUS_BUCKETS = [
  // Open states — visible workload on the dashboard
  ["NEEDS_RESPONSE", 20],
  ["under_review", 15],
  // Closed states — historical outcomes
  ["won", 25],
  ["lost", 30],
  ["accepted", 10],
];

function recommendationFor(level) {
  if (level === "HIGH" || level === "MEDIUM") return "INVESTIGATE";
  if (level === "LOW" || level === "NONE") return "ACCEPT";
  return null;
}

function sampleOrderTotal() {
  const r = rand();
  if (r < 0.7) return Math.round(randFloat(200, 1500));
  if (r < 0.95) return Math.round(randFloat(1500, 3500));
  return Math.round(randFloat(3500, 8000));
}

function seasonalMultiplier(year, month0) {
  if (month0 === 10 || month0 === 11) return 2.0;
  if (month0 === 0 || month0 === 1) return 0.6;
  if (month0 === 5 || month0 === 6) return 1.2;
  return 1.0;
}

function biasedCountry(riskLevel) {
  if (riskLevel === "HIGH" && rand() < 0.7) return pick(["US", "GB", "DE", "FR", "NL"]);
  return pickWeighted(COUNTRY_BUCKETS);
}
function biasedGateway(riskLevel) {
  if (riskLevel === "HIGH" && rand() < 0.5) return pick(["paypal", "klarna", "manual"]);
  return pickWeighted(GATEWAY_BUCKETS);
}
function biasedFulfillment(riskLevel, financialStatus) {
  if (financialStatus === "VOIDED") return "CANCELLED";
  if (financialStatus === "REFUNDED") {
    return pickWeighted([
      ["FULFILLED", 60], ["CANCELLED", 30], ["UNFULFILLED", 10],
    ]);
  }
  if (riskLevel === "HIGH") {
    return pickWeighted([
      ["FULFILLED", 70], ["CANCELLED", 15],
      ["UNFULFILLED", 10], ["PARTIALLY_FULFILLED", 5],
    ]);
  }
  return pickWeighted(FULFILLMENT_BUCKETS);
}
function protectStatus(gateway) {
  if (gateway !== "shopify_payments") return null;
  return pickWeighted([
    ["PROTECTED", 10], ["ACTIVE", 65], ["PENDING", 6],
    ["NOT_PROTECTED", 14], [null, 5],
  ]);
}

function* eachDay(fromIso, toExclusiveIso) {
  const start = new Date(`${fromIso}T00:00:00Z`);
  const end = new Date(`${toExclusiveIso}T00:00:00Z`);
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    yield new Date(d);
  }
}

function buildOrderRow(shopId, date) {
  const orderId = `${ORDER_PREFIX}${randomUUID()}`;
  const orderNumber = `#SEED-${Math.floor(rand() * 90000 + 10000)}`;
  const riskLevel = pickWeighted(RISK_BUCKETS);
  const recommendation = recommendationFor(riskLevel);
  const financialStatus = pickWeighted(FINANCIAL_BUCKETS);
  const fulfillmentStatus = biasedFulfillment(riskLevel, financialStatus);
  const gateway = biasedGateway(riskLevel);
  const country = biasedCountry(riskLevel);
  const fraudProtection = protectStatus(gateway);

  const hour = pickWeighted([
    [9, 1], [10, 2], [11, 3], [12, 4], [13, 4], [14, 5],
    [15, 5], [16, 4], [17, 3], [18, 3], [19, 4], [20, 5],
    [21, 4], [22, 2], [23, 1], [0, 0.5], [8, 0.5],
  ]);
  const processedAt = new Date(date);
  processedAt.setUTCHours(hour, randInt(0, 59), randInt(0, 59), 0);
  const createdAt = new Date(processedAt.getTime() - randInt(30, 600) * 1000);

  let fulfilledAt = null;
  if (fulfillmentStatus === "FULFILLED" || fulfillmentStatus === "PARTIALLY_FULFILLED") {
    let delayMs;
    if (riskLevel === "HIGH" && rand() < 0.2) delayMs = randInt(60, 600) * 1000;
    else delayMs = randInt(2, 72) * 3600 * 1000;
    fulfilledAt = new Date(processedAt.getTime() + delayMs);
  }
  let cancelledAt = null, cancelReason = null;
  if (fulfillmentStatus === "CANCELLED") {
    cancelledAt = new Date(processedAt.getTime() + randInt(0, 48) * 3600 * 1000);
    cancelReason = pickWeighted([
      ["fraud", 15], ["customer", 40], ["inventory", 15],
      ["declined", 10], ["other", 20],
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
    // 3-D Secure: ~50% of Shopify Payments orders authenticate via
    // 3DS (realistic for an EU-leaning Swedish store post-PSD2).
    // Non-Shopify-Payments gateways carry no 3DS signal (we never
    // trust the receipt shape there) → null.
    three_ds_authenticated:
      gateway === "shopify_payments" ? rand() < 0.5 : null,
    has_chargeback: false,
    chargeback_type: null,
    chargeback_status: null,
  };
}

function buildAssessmentRow(shopId, order) {
  return {
    shop_id: shopId,
    shopify_order_id: order.shopify_order_id,
    provider: "shopify",
    risk_level: order.risk_level_initial,
    recommendation: order.risk_recommendation_initial,
    facts_json: null,
    assessed_at: order.processed_at,
  };
}

// ── Main ───────────────────────────────────────────────────────────
console.log(`\nResolving shop ${SHOP_DOMAIN}...`);
const { data: shop } = await sb.from("shops").select("id")
  .eq("shop_domain", SHOP_DOMAIN).single();
if (!shop) { console.error("Shop not found"); process.exit(1); }
const shopId = shop.id;
console.log(`  shop_id = ${shopId}`);

// 1. Wipe prior seed rows.
console.log("\nWiping prior seed rows (orders, assessments, disputes)...");
await sb.from("shopify_order_risk_assessments").delete()
  .eq("shop_id", shopId).like("shopify_order_id", `${ORDER_PREFIX}%`);
await sb.from("shopify_orders").delete()
  .eq("shop_id", shopId).like("shopify_order_id", `${ORDER_PREFIX}%`);
await sb.from("disputes").delete()
  .eq("shop_id", shopId).like("dispute_gid", `${DISPUTE_PREFIX}%`);
console.log("  done.");

// 2. Generate orders day-by-day across the FULL window (incl. recent).
console.log("\nGenerating seed orders for the full window...");
const orders = [];
for (const date of eachDay(WINDOW_START, WINDOW_END_EXCLUSIVE)) {
  const m = seasonalMultiplier(date.getUTCFullYear(), date.getUTCMonth());
  const n = Math.max(0, Math.round(BASELINE_ORDERS_PER_DAY * m + (rand() - 0.5) * 3));
  for (let i = 0; i < n; i++) orders.push(buildOrderRow(shopId, date));
}
console.log(`  generated ${orders.length} orders`);

const BATCH = 500;
for (let i = 0; i < orders.length; i += BATCH) {
  const slice = orders.slice(i, i + BATCH);
  const { error } = await sb.from("shopify_orders").insert(slice);
  if (error) { console.error(error.message); process.exit(1); }
}
console.log(`  inserted ${orders.length} orders`);

// 3. Assessments.
console.log("\nInserting risk assessments...");
const assessments = orders.map((o) => buildAssessmentRow(shopId, o));
for (let i = 0; i < assessments.length; i += BATCH) {
  const slice = assessments.slice(i, i + BATCH);
  const { error } = await sb.from("shopify_order_risk_assessments").insert(slice);
  if (error) { console.error(error.message); process.exit(1); }
}
console.log(`  inserted ${assessments.length} assessments`);

// 4. Seed disputes across the historical window.
// Pool of candidate orders: those processed BEFORE the
// "recent 60 days" cutoff. Real disputes already cover the recent
// window — adding seeded ones there would stack the very problem
// this script fixes.
console.log("\nSeeding historical disputes...");
const now = new Date();
const skipCutoff = new Date(now.getTime() - DISPUTE_SKIP_RECENT_DAYS * 86400000);
const candidatePool = orders.filter((o) => new Date(o.processed_at) < skipCutoff);
const disputeRows = [];
for (let i = 0; i < DISPUTE_TARGET; i++) {
  const order = pick(candidatePool);
  const phase = pickWeighted([["chargeback", 75], ["inquiry", 25]]);
  const reason = pickWeighted(DISPUTE_REASON_BUCKETS);
  const status = pickWeighted(DISPUTE_STATUS_BUCKETS);
  // Disputes typically open 2–14 days after the order processed.
  const initiatedAt = new Date(
    new Date(order.processed_at).getTime() +
    randInt(2, 14) * 86400000 +
    randInt(0, 86400) * 1000,
  );
  // Cap initiatedAt at the skip cutoff — keeps seeded disputes
  // strictly in the older band.
  const initiatedClamped = initiatedAt > skipCutoff ? skipCutoff : initiatedAt;
  // Due date ~30 days after initiated (Shopify's typical window)
  const dueAt = new Date(initiatedClamped.getTime() + randInt(20, 40) * 86400000);

  disputeRows.push({
    shop_id: shopId,
    dispute_gid: `${DISPUTE_PREFIX}${randomUUID()}`,
    order_gid: order.shopify_order_id,
    status,
    reason,
    amount: order.order_total,
    currency_code: order.currency,
    initiated_at: initiatedClamped.toISOString(),
    due_at: dueAt.toISOString(),
    needs_review: status === "NEEDS_RESPONSE" || status === "under_review",
    raw_snapshot: { seed_v2: true, phase, reason },
  });
}

// disputes.phase is in a separate column on newer schemas. Set it
// in raw_snapshot if the column doesn't exist; otherwise inline.
// We use insert with phase as an optional column — PostgREST will
// reject if the column is missing. Detect by attempting a probe.
const { error: phaseProbeErr } = await sb
  .from("disputes").select("phase").limit(1);
const PHASE_COL_EXISTS = !phaseProbeErr;
if (PHASE_COL_EXISTS) {
  for (const d of disputeRows) {
    d.phase = (d.raw_snapshot).phase;
  }
}

for (let i = 0; i < disputeRows.length; i += BATCH) {
  const slice = disputeRows.slice(i, i + BATCH);
  const { error } = await sb.from("disputes").insert(slice);
  if (error) { console.error(`dispute insert failed: ${error.message}`); process.exit(1); }
}
console.log(`  inserted ${disputeRows.length} seeded disputes (older window only)`);

// 5. Rebuild shop_daily_metrics for the full window.
// Counts orders + disputes by date from local tables. Wipe first.
console.log("\nRebuilding shop_daily_metrics...");
await sb.from("shop_daily_metrics").delete()
  .eq("shop_id", shopId)
  .gte("date", WINDOW_START)
  .lt("date", WINDOW_END_EXCLUSIVE);

// Pull ALL orders (real + seed) and ALL disputes (real + seed) for
// per-day counts. Paginated — PostgREST default cap is 1000 rows and
// we have >5000 seed orders.
async function fetchAllOrders() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("shopify_orders")
      .select("processed_at, created_at_shopify")
      .eq("shop_id", shopId)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}
async function fetchAllDisputes() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("disputes")
      .select("phase, initiated_at, reason")
      .eq("shop_id", shopId)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}
const allOrders = await fetchAllOrders();
const allDisputes = await fetchAllDisputes();

function dateOf(o) {
  return ((o.processed_at ?? o.created_at_shopify) || "").slice(0, 10);
}

const orderCountByDate = new Map();
for (const o of allOrders ?? []) {
  const d = dateOf(o);
  if (!d) continue;
  orderCountByDate.set(d, (orderCountByDate.get(d) || 0) + 1);
}
const disputeByDate = new Map();
for (const d of allDisputes ?? []) {
  if (!d.initiated_at) continue;
  const day = d.initiated_at.slice(0, 10);
  const b = disputeByDate.get(day) ?? { dispute: 0, chargeback: 0, inquiry: 0 };
  b.dispute += 1;
  if (d.phase === "chargeback") b.chargeback += 1;
  else if (d.phase === "inquiry") b.inquiry += 1;
  disputeByDate.set(day, b);
}

const dailyRows = [];
for (const date of eachDay(WINDOW_START, WINDOW_END_EXCLUSIVE)) {
  const iso = date.toISOString().slice(0, 10);
  const oc = orderCountByDate.get(iso) ?? 0;
  const d = disputeByDate.get(iso) ?? { dispute: 0, chargeback: 0, inquiry: 0 };
  if (oc === 0 && d.dispute === 0) continue; // skip totally empty days
  dailyRows.push({
    shop_id: shopId, date: iso,
    order_count: oc,
    dispute_count: d.dispute,
    chargeback_count: d.chargeback,
    inquiry_count: d.inquiry,
    last_synced_at: new Date().toISOString(),
  });
}
for (let i = 0; i < dailyRows.length; i += BATCH) {
  const slice = dailyRows.slice(i, i + BATCH);
  const { error } = await sb.from("shop_daily_metrics").insert(slice);
  if (error) { console.error(error.message); process.exit(1); }
}
console.log(`  wrote ${dailyRows.length} shop_daily_metrics rows`);

// 6. Rebuild shop_fraud_daily_metrics for the full window.
console.log("\nRebuilding shop_fraud_daily_metrics...");
await sb.from("shop_fraud_daily_metrics").delete()
  .eq("shop_id", shopId)
  .gte("date", WINDOW_START)
  .lt("date", WINDOW_END_EXCLUSIVE);

function rollupForDate(rows) {
  const out = {
    orders_total: rows.length,
    orders_low: 0, orders_medium: 0, orders_high: 0,
    orders_none: 0, orders_pending: 0, orders_fulfilled_high_risk: 0,
    fully_protected_value: 0, eligible_protected_value: 0,
  };
  for (const r of rows) {
    const risk = (r.risk_level_initial ?? "").toUpperCase();
    if (risk === "LOW") out.orders_low += 1;
    else if (risk === "MEDIUM") out.orders_medium += 1;
    else if (risk === "HIGH") {
      out.orders_high += 1;
      if (r.fulfillment_status && ["FULFILLED","PARTIAL","PARTIALLY_FULFILLED"].includes(r.fulfillment_status.toUpperCase())) {
        out.orders_fulfilled_high_risk += 1;
      }
    } else if (risk === "PENDING") out.orders_pending += 1;
    else out.orders_none += 1;
    const total = Number(r.order_total ?? 0);
    if (total > 0 && r.fraud_protection_level) {
      const s = r.fraud_protection_level.toUpperCase();
      if (s === "PROTECTED") out.fully_protected_value += total;
      if (["PROTECTED","ACTIVE","PENDING"].includes(s)) out.eligible_protected_value += total;
    }
  }
  return out;
}

// Pull full order rows per date (with the columns the aggregator needs).
// PostgREST default limit is 1000 — paginate.
const allRows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from("shopify_orders")
    .select("risk_level_initial, fulfillment_status, fraud_protection_level, order_total, processed_at, created_at_shopify")
    .eq("shop_id", shopId)
    .range(from, from + 999);
  if (error) { console.error(error.message); process.exit(1); }
  allRows.push(...data);
  if (data.length < 1000) break;
}

const ordersByDate = new Map();
for (const r of allRows) {
  const d = dateOf(r);
  if (!d) continue;
  if (!ordersByDate.has(d)) ordersByDate.set(d, []);
  ordersByDate.get(d).push(r);
}
const rollupRows = [];
for (const [date, dayRows] of ordersByDate.entries()) {
  const agg = rollupForDate(dayRows);
  const dailyRow = dailyRows.find((r) => r.date === date);
  const fraudDisputesToday = (allDisputes ?? []).filter((d) =>
    d.initiated_at && d.initiated_at.slice(0, 10) === date &&
    (d.reason || "").toUpperCase() === "FRAUDULENT").length;
  rollupRows.push({
    shop_id: shopId, date,
    ...agg,
    fraud_disputes: fraudDisputesToday,
    total_disputes: dailyRow?.dispute_count ?? 0,
    chargebacks: dailyRow?.chargeback_count ?? 0,
    last_synced_at: new Date().toISOString(),
  });
}
for (let i = 0; i < rollupRows.length; i += BATCH) {
  const slice = rollupRows.slice(i, i + BATCH);
  const { error } = await sb.from("shop_fraud_daily_metrics").insert(slice);
  if (error) { console.error(error.message); process.exit(1); }
}
console.log(`  wrote ${rollupRows.length} shop_fraud_daily_metrics rows`);

// 7. Refresh the shops row import state.
const { count: realOrderCount } = await sb.from("shopify_orders")
  .select("id", { count: "exact", head: true })
  .eq("shop_id", shopId);
await sb.from("shops").update({
  historical_import_status: "complete",
  historical_import_progress_pct: 100,
  historical_import_orders_processed: realOrderCount ?? orders.length,
  historical_import_orders_total: realOrderCount ?? orders.length,
  historical_import_since_date: WINDOW_START,
  historical_import_scope_granted: "read_all_orders",
  historical_import_completed_at: new Date().toISOString(),
}).eq("id", shopId);

console.log("\n=== Summary ===");
console.log(`  orders seeded:           ${orders.length}`);
console.log(`  disputes seeded:         ${disputeRows.length} (historical band only)`);
console.log(`  total orders in DB:      ${realOrderCount}`);
console.log(`  shop_daily_metrics rows: ${dailyRows.length}`);
console.log(`  shop_fraud_daily_metrics:${rollupRows.length}`);
console.log("");
process.exit(0);
