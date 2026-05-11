// One-shot: compose and deliver a sample Monthly Chargeback Exposure
// digest for the surasvenne dev shop. Pulls real metrics directly from
// Supabase (matching the same window logic as
// `/api/dashboard/insights/initial-analysis`) and sends via Resend.
//
// Run:  npx tsx scripts/send-monthly-digest-example.ts

// IMPORTANT: ES module imports hoist regardless of source order, so
// dotenv `config()` must run BEFORE we dynamically import the email
// lib — the lib reads `process.env.RESEND_API_KEY` at module-init
// time and would early-return `{delivered: false}` otherwise. We
// dynamic-import the lib inside main() after env is loaded.
import { config } from "dotenv";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { DigestPeriodMetrics } from "../lib/email/sendMonthlyChargebackDigest";

config({ path: join(process.cwd(), ".env.local") });
config({ path: join(process.cwd(), ".env") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const SHOP_DOMAIN = "surasvenne.myshopify.com";

async function main() {
const { sendMonthlyChargebackDigest } = await import(
  "../lib/email/sendMonthlyChargebackDigest"
);
const { data: shop } = await sb
  .from("shops")
  .select("id, shop_domain")
  .eq("shop_domain", SHOP_DOMAIN)
  .single();
if (!shop) {
  console.error("shop not found:", SHOP_DOMAIN);
  process.exit(1);
}

const { data: setup } = await sb
  .from("shop_setup")
  .select("steps")
  .eq("shop_id", shop.id)
  .single();
const teamEmail = (setup?.steps as any)?.team?.payload?.teamEmail as
  | string
  | undefined;
if (!teamEmail) {
  console.error("no team email configured for this shop");
  process.exit(1);
}

// Anchor on the most recent order's created_at_shopify so a seeded
// dev shop produces a non-empty window. Production cron would anchor
// on `now()`.
const { data: maxRow } = await sb
  .from("shopify_orders")
  .select("created_at_shopify")
  .eq("shop_id", shop.id)
  .order("created_at_shopify", { ascending: false })
  .limit(1);
const anchor = new Date((maxRow as any)[0].created_at_shopify);
const w30 = new Date(anchor);
w30.setUTCDate(anchor.getUTCDate() - 30);
const w60 = new Date(anchor);
w60.setUTCDate(anchor.getUTCDate() - 60);
const w90 = new Date(anchor);
w90.setUTCDate(anchor.getUTCDate() - 90);

async function windowMetrics(
  start: Date,
  end: Date,
  shopId: string,
): Promise<DigestPeriodMetrics> {
  const { data: orders } = await sb
    .from("shopify_orders")
    .select(
      "id, risk_level_initial, three_ds_authenticated, processed_at, fulfilled_at, signed_by_name, delivered_at_tracking, fraud_protection_level",
    )
    .eq("shop_id", shopId)
    .gte("created_at_shopify", start.toISOString())
    .lt("created_at_shopify", end.toISOString());

  const rows = (orders ?? []) as Array<{
    risk_level_initial: string | null;
    three_ds_authenticated: boolean | null;
    processed_at: string | null;
    fulfilled_at: string | null;
    signed_by_name: string | null;
    delivered_at_tracking: string | null;
    fraud_protection_level: string | null;
  }>;
  const tot = rows.length;
  if (tot === 0) {
    return {
      ordersTotal: 0,
      acceptanceRatePct: null,
      highRiskPct: null,
      fulfilledHighRiskPct: null,
      fraudDisputeRatePct: null,
      shopifyProtectCoveragePct: null,
      threeDsAuthRatePct: null,
      threeDsAuthOrders: 0,
      threeDsAuthEligibleOrders: 0,
      signedForRatePct: null,
      signedForOrders: 0,
      confirmedDeliveryRatePct: null,
      confirmedDeliveryOrders: 0,
      medianFulfillmentHours: null,
    };
  }

  const high = rows.filter((o) => o.risk_level_initial === "HIGH").length;
  const medium = rows.filter((o) => o.risk_level_initial === "MEDIUM").length;
  const low = rows.filter((o) => o.risk_level_initial === "LOW").length;
  const none = rows.filter((o) => o.risk_level_initial === "NONE").length;
  const pending = rows.filter((o) => o.risk_level_initial === "PENDING").length;
  const fulfilledHigh = rows.filter(
    (o) => o.risk_level_initial === "HIGH" && o.fulfilled_at,
  ).length;
  const fulfilled = rows.filter((o) => o.fulfilled_at).length;
  const threeDsEligible = rows.filter(
    (o) => o.three_ds_authenticated !== null,
  ).length;
  const threeDsOk = rows.filter((o) => o.three_ds_authenticated === true).length;
  const protected_ = rows.filter((o) =>
    ["PROTECTED", "ACTIVE"].includes(o.fraud_protection_level ?? ""),
  ).length;
  const delivered = rows.filter((o) => o.delivered_at_tracking).length;
  const signed = rows.filter((o) => o.signed_by_name).length;

  const fulfillHours = rows
    .filter((o) => o.fulfilled_at && o.processed_at)
    .map(
      (o) =>
        (new Date(o.fulfilled_at!).getTime() -
          new Date(o.processed_at!).getTime()) /
        3600000,
    )
    .sort((a, b) => a - b);
  const median =
    fulfillHours.length > 0
      ? fulfillHours[Math.floor(fulfillHours.length / 2)]!
      : null;

  const { count: fraudDisputes } = await sb
    .from("disputes")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .eq("reason", "FRAUDULENT")
    .gte("initiated_at", start.toISOString())
    .lt("initiated_at", end.toISOString());

  const accDenom = tot - pending;
  return {
    ordersTotal: tot,
    acceptanceRatePct:
      accDenom > 0 ? ((low + medium + none) / accDenom) * 100 : null,
    highRiskPct: tot > 0 ? (high / tot) * 100 : null,
    fulfilledHighRiskPct: high > 0 ? (fulfilledHigh / high) * 100 : null,
    fraudDisputeRatePct: tot > 0 ? ((fraudDisputes ?? 0) / tot) * 100 : null,
    shopifyProtectCoveragePct: tot > 0 ? (protected_ / tot) * 100 : null,
    threeDsAuthRatePct:
      threeDsEligible > 0 ? (threeDsOk / threeDsEligible) * 100 : null,
    threeDsAuthOrders: threeDsOk,
    threeDsAuthEligibleOrders: threeDsEligible,
    signedForRatePct: delivered > 0 ? (signed / delivered) * 100 : null,
    signedForOrders: signed,
    confirmedDeliveryRatePct:
      fulfilled > 0 ? (delivered / fulfilled) * 100 : null,
    confirmedDeliveryOrders: delivered,
    medianFulfillmentHours: median,
  };
}

const current30d = await windowMetrics(w30, anchor, shop.id);
const prior30d = await windowMetrics(w60, w30, shop.id);

const { count: chargebacks90d } = await sb
  .from("disputes")
  .select("id", { count: "exact", head: true })
  .eq("shop_id", shop.id)
  .gte("initiated_at", w90.toISOString())
  .lt("initiated_at", anchor.toISOString());

const { count: orders90d } = await sb
  .from("shopify_orders")
  .select("id", { count: "exact", head: true })
  .eq("shop_id", shop.id)
  .gte("created_at_shopify", w90.toISOString())
  .lt("created_at_shopify", anchor.toISOString());

const chargebackRate90dPct =
  orders90d && orders90d > 0
    ? ((chargebacks90d ?? 0) / orders90d) * 100
    : null;

const periodLabel = anchor.toLocaleDateString("en-US", {
  month: "long",
  year: "numeric",
});

console.log("\n— digest input ——————————————");
console.log("period:", periodLabel);
console.log("recipient:", teamEmail);
console.log("90d:", {
  chargebacks90d,
  orders90d,
  chargebackRate90dPct: chargebackRate90dPct?.toFixed(2),
});
console.log("current 30d:", {
  orders: current30d.ordersTotal,
  highRiskPct: current30d.highRiskPct?.toFixed(1),
  fulfilledHighRiskPct: current30d.fulfilledHighRiskPct?.toFixed(1),
  threeDsAuthRatePct: current30d.threeDsAuthRatePct?.toFixed(1),
  signedForRatePct: current30d.signedForRatePct?.toFixed(1),
});
console.log("———————————————————————————\n");

const result = await sendMonthlyChargebackDigest({
  shopDomain: SHOP_DOMAIN,
  merchantName: "Søra Svende",
  to: teamEmail,
  periodLabel,
  chargebackRate90dPct,
  chargebackOrders90d: chargebacks90d ?? 0,
  current30d,
  prior30d,
});

console.log("subject:", result.subject);
console.log("delivered:", result.delivered);
if (!result.delivered) {
  console.error(
    "Send failed. If you're testing locally, ensure RESEND_API_KEY is in .env.local.",
  );
  process.exit(1);
}
console.log("\n✓ Sent to", teamEmail);
} // end main

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
