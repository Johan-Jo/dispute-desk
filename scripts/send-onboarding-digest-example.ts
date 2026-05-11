// One-shot: compose and deliver the onboarding analysis digest for
// the surasvenne dev shop. Pulls real metrics from Supabase (same
// window logic as the in-app Chargeback Exposure page) and sends
// via Resend.
//
// Run:  npx tsx scripts/send-onboarding-digest-example.ts

import { config } from "dotenv";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

config({ path: join(process.cwd(), ".env.local") });
config({ path: join(process.cwd(), ".env") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const SHOP_DOMAIN = "surasvenne.myshopify.com";

async function main() {
  // Dynamic import — ensures dotenv has populated process.env before
  // the email lib reads RESEND_API_KEY at module load.
  const { sendOnboardingAnalysisDigest } = await import(
    "../lib/email/sendOnboardingAnalysisDigest"
  );

  const { data: shop } = await sb
    .from("shops")
    .select("id, shop_domain")
    .eq("shop_domain", SHOP_DOMAIN)
    .single();
  if (!shop) {
    console.error("shop not found");
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
    console.error("no team email configured");
    process.exit(1);
  }

  // Anchor on most-recent order (seed data — production uses now()).
  const { data: maxRow } = await sb
    .from("shopify_orders")
    .select("created_at_shopify")
    .eq("shop_id", shop.id)
    .order("created_at_shopify", { ascending: false })
    .limit(1);
  const anchor = new Date((maxRow as any)[0].created_at_shopify);
  const w30 = new Date(anchor);
  w30.setUTCDate(anchor.getUTCDate() - 30);
  const w90 = new Date(anchor);
  w90.setUTCDate(anchor.getUTCDate() - 90);

  // ── 30-day snapshot ────────────────────────────────────────────
  const { data: orders30d } = await sb
    .from("shopify_orders")
    .select(
      "id, risk_level_initial, three_ds_authenticated, processed_at, fulfilled_at, signed_by_name, delivered_at_tracking, fraud_protection_level",
    )
    .eq("shop_id", shop.id)
    .gte("created_at_shopify", w30.toISOString())
    .lt("created_at_shopify", anchor.toISOString());

  const rows = (orders30d ?? []) as Array<{
    risk_level_initial: string | null;
    three_ds_authenticated: boolean | null;
    processed_at: string | null;
    fulfilled_at: string | null;
    signed_by_name: string | null;
    delivered_at_tracking: string | null;
    fraud_protection_level: string | null;
  }>;
  const tot = rows.length;
  const high = rows.filter((o) => o.risk_level_initial === "HIGH").length;
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

  const { count: fraudDisputes30d } = await sb
    .from("disputes")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shop.id)
    .eq("reason", "FRAUDULENT")
    .gte("initiated_at", w30.toISOString())
    .lt("initiated_at", anchor.toISOString());

  // ── 90-day chargeback rate (denominator: orders in same window) ─
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
    orders90d && orders90d > 0 ? ((chargebacks90d ?? 0) / orders90d) * 100 : null;

  // ── Total historical orders analyzed (anchors the hero) ───────
  const { count: ordersAnalyzedTotal } = await sb
    .from("shopify_orders")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shop.id);

  console.log("\n— onboarding digest input ——————————————");
  console.log("recipient:", teamEmail);
  console.log("orders analyzed total:", ordersAnalyzedTotal);
  console.log("90d:", {
    chargebacks90d,
    orders90d,
    chargebackRate90dPct: chargebackRate90dPct?.toFixed(2),
  });
  console.log("last 30d snapshot:", {
    orders: tot,
    highRiskPct: tot > 0 ? ((high / tot) * 100).toFixed(1) : null,
    fulfilledHighRiskPct: high > 0 ? ((fulfilledHigh / high) * 100).toFixed(1) : null,
    threeDsAuthRatePct: threeDsEligible > 0 ? ((threeDsOk / threeDsEligible) * 100).toFixed(1) : null,
    signedForRatePct: delivered > 0 ? ((signed / delivered) * 100).toFixed(1) : null,
  });
  console.log("———————————————————————————————————————\n");

  const result = await sendOnboardingAnalysisDigest({
    shopDomain: SHOP_DOMAIN,
    merchantName: "Søra Svende",
    to: teamEmail,
    ordersAnalyzedTotal: ordersAnalyzedTotal ?? 0,
    chargebackRate90dPct,
    chargebackOrders90d: chargebacks90d ?? 0,
    last30d: {
      ordersTotal: tot,
      highRiskPct: tot > 0 ? (high / tot) * 100 : null,
      fulfilledHighRiskPct:
        high > 0 ? (fulfilledHigh / high) * 100 : null,
      fraudDisputeRatePct:
        tot > 0 ? ((fraudDisputes30d ?? 0) / tot) * 100 : null,
      shopifyProtectCoveragePct: tot > 0 ? (protected_ / tot) * 100 : null,
      threeDsAuthRatePct:
        threeDsEligible > 0 ? (threeDsOk / threeDsEligible) * 100 : null,
      signedForRatePct: delivered > 0 ? (signed / delivered) * 100 : null,
      medianFulfillmentHours: median,
    },
  });

  console.log("subject:", result.subject);
  console.log("delivered:", result.delivered);
  if (!result.delivered) {
    console.error("send failed");
    process.exit(1);
  }
  console.log("\n✓ Sent to", teamEmail);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
