#!/usr/bin/env node
// One-shot backfill of ratio_snapshots for a given shop, past N months.
// Calls /api/cron/calculate-ratios but with a shop_id + period_month
// override — except the cron route doesn't support that. So instead
// we hit a dedicated diagnostic endpoint we add here, OR we replicate
// the calculation logic by posting directly.
//
// Approach taken: replicate the SQL the calculator runs and upsert
// ratio_snapshots rows directly. Keeps this script standalone so it
// runs from a local machine against prod.
//
// Usage:
//   node --env-file=.env.diag-temp scripts/backfill-ratio-snapshots.mjs <shop-domain> [months=12]
import { createClient } from "@supabase/supabase-js";

const shopDomain = process.argv[2];
const months = parseInt(process.argv[3] ?? "12", 10);
if (!shopDomain) {
  console.error("usage: <shop-domain> [months]");
  process.exit(1);
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const { data: shop } = await sb
  .from("shops")
  .select("id")
  .eq("shop_domain", shopDomain)
  .single();
if (!shop) {
  console.error("shop not found:", shopDomain);
  process.exit(1);
}

function monthStart(d) {
  const x = new Date(d);
  x.setUTCDate(1);
  x.setUTCHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

// VAMP fee constant from lib/liabilityShift/ratios/thresholds.ts
const VAMP_FEE_USD = 8.0;

const now = new Date();
const periods = [];
for (let i = 0; i < months; i++) {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - i);
  periods.push(monthStart(d));
}

for (const periodMonth of periods) {
  const start = new Date(`${periodMonth}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(start.getUTCMonth() + 1);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  // Settled count
  const { count: settledCount = 0 } = await sb
    .from("shopify_orders")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shop.id)
    .gte("created_at_shopify", startIso)
    .lt("created_at_shopify", endIso)
    .in("financial_status", ["PAID", "PARTIALLY_REFUNDED"]);

  // Disputes in the period
  const { data: disputes = [] } = await sb
    .from("disputes")
    .select("id, reason, phase, amount, network_reason_code, final_outcome, initiated_at")
    .eq("shop_id", shop.id)
    .gte("initiated_at", startIso)
    .lt("initiated_at", endIso);

  let tc40 = 0;
  let tc15 = 0;
  let mcSettled = 0;
  let mcEcm = 0;
  let mcEfm = 0;
  let ce30Excluded = 0;
  let fptExcluded = 0;
  let revenueRecovered = 0;

  // Attribution
  const wonIds = disputes.filter((d) => d.final_outcome === "won").map((d) => d.id);
  const attribution = new Map();
  if (wonIds.length > 0) {
    const { data: packs = [] } = await sb
      .from("evidence_packs")
      .select("dispute_id, package_type")
      .in("dispute_id", wonIds);
    for (const p of packs) {
      if (p.package_type === "ce_30") attribution.set(p.dispute_id, "ce_30");
      else if (p.package_type === "fpt") attribution.set(p.dispute_id, "fpt");
    }
  }

  for (const d of disputes) {
    const isFraud = (d.reason ?? "").toLowerCase().includes("fraud");
    const isChargeback = d.phase === "chargeback";
    if (isFraud && isChargeback) tc40 += 1;
    else tc15 += 1;
    const isMc = (d.network_reason_code ?? "").startsWith("48");
    if (isMc) {
      mcSettled += 1;
      if (isChargeback) mcEcm += 1;
      if (isFraud) mcEfm += 1;
    }
    if (d.final_outcome === "won") {
      const via = attribution.get(d.id);
      if (via === "ce_30") {
        ce30Excluded += 1;
        if (isFraud && isChargeback) tc40 -= 1; else tc15 -= 1;
        revenueRecovered += Number(d.amount ?? 0);
      } else if (via === "fpt") {
        fptExcluded += 1;
        if (isFraud && isChargeback) tc40 -= 1; else tc15 -= 1;
        revenueRecovered += Number(d.amount ?? 0);
      }
    }
  }

  const safe = (n, d) => (d > 0 ? n / d : 0);
  const vamp = safe(tc40 + tc15, settledCount);
  const vampWithoutDd = safe(tc40 + tc15 + ce30Excluded + fptExcluded, settledCount);
  const ecmRatio = safe(mcEcm, settledCount);
  const efmRatio = safe(mcEfm, settledCount);
  const feesAvoided = (ce30Excluded + fptExcluded) * VAMP_FEE_USD;

  await sb.from("ratio_snapshots").upsert(
    {
      shop_id: shop.id,
      period_month: periodMonth,
      settled_count: settledCount ?? 0,
      tc40_count: Math.max(0, tc40),
      tc15_count: Math.max(0, tc15),
      vamp_ratio_calculated: vamp,
      vamp_ratio_without_dd: vampWithoutDd,
      ce30_excluded_count: ce30Excluded,
      fpt_excluded_count: fptExcluded,
      rdr_excluded_count: 0,
      mc_settled_count: mcSettled,
      mc_ecm_chargeback_count: mcEcm,
      mc_ecm_ratio: ecmRatio,
      mc_efm_fraud_count: mcEfm,
      mc_efm_ratio: efmRatio,
      estimated_fees_avoided_usd: feesAvoided,
      estimated_revenue_recovered_usd: revenueRecovered,
      calculated_at: new Date().toISOString(),
    },
    { onConflict: "shop_id,period_month" },
  );

  console.log(
    `${periodMonth}  settled=${settledCount}  disputes=${disputes.length}  ` +
      `tc40=${tc40}  tc15=${tc15}  VAMP=${(vamp * 100).toFixed(3)}%  ` +
      `ECM=${(ecmRatio * 100).toFixed(3)}%  EFM=${(efmRatio * 100).toFixed(3)}%  ` +
      `ce30won=${ce30Excluded}  fptwon=${fptExcluded}  rev=$${revenueRecovered.toFixed(2)}`,
  );
}

console.log(`\nBackfilled ${periods.length} months for ${shopDomain}.`);
