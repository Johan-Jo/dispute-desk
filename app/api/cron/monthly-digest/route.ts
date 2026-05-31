import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { sendMonthlyChargebackDigest } from "@/lib/email/sendMonthlyChargebackDigest";
import type { DigestPeriodMetrics } from "@/lib/email/sendMonthlyChargebackDigest";
import { gatherDisputeActivity } from "@/lib/email/digestDisputeActivity";
import { cronEnvGate } from "@/lib/cron/envGate";

export const runtime = "nodejs";
// Some shops are large enough that gathering metrics + sending takes
// a few seconds each. The cron only runs monthly so total runtime is
// bounded by the merchant pool.
export const maxDuration = 300;

/**
 * GET /api/cron/monthly-digest
 *
 * Vercel Cron entry. Iterates every shop with a completed historical
 * import, gathers the same window metrics the in-app page computes,
 * and sends the monthly Chargeback Exposure digest. Idempotency is
 * enforced via `shop_setup.steps.team.payload.lastMonthlyDigestYyyyMm`
 * — we skip any shop whose marker already equals the current month.
 *
 * Schedule: 09:00 UTC on the 1st of each month (see vercel.json).
 *
 * Respects the merchant opt-out flag at
 * `shop_setup.steps.team.payload.notifications.monthlyDigest`.
 * Default ON (sent unless explicitly `false`).
 */
export async function GET(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

  const sb = getServiceClient();
  const now = new Date();
  const yyyyMm = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  // Eligible shops: historical analysis complete. We avoid sending to
  // shops still backfilling — their data is partial and would mislead.
  const { data: shops, error } = await sb
    .from("shops")
    .select("id, shop_domain, historical_import_status")
    .eq("historical_import_status", "complete");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!shops?.length) {
    return NextResponse.json({ sent: 0, skipped: 0, total: 0 });
  }

  let sent = 0;
  let skipped = 0;
  const failures: Array<{ shop: string; reason: string }> = [];

  for (const shop of shops) {
    try {
      const { data: setup } = await sb
        .from("shop_setup")
        .select("steps")
        .eq("shop_id", shop.id)
        .maybeSingle();

      const steps = (setup?.steps ?? {}) as Record<
        string,
        { payload?: Record<string, unknown> }
      >;
      const teamPayload = steps.team?.payload ?? {};

      // Opt-out check. Default ON — only skip when explicitly false.
      const notifications = teamPayload.notifications as
        | { monthlyDigest?: boolean }
        | undefined;
      if (notifications?.monthlyDigest === false) {
        skipped++;
        failures.push({ shop: shop.shop_domain, reason: "opted_out" });
        continue;
      }

      // Idempotency: don't re-send within the same calendar month.
      const lastMarker = teamPayload.lastMonthlyDigestYyyyMm as
        | string
        | undefined;
      if (lastMarker === yyyyMm) {
        skipped++;
        continue;
      }

      const teamEmail = teamPayload.teamEmail as string | undefined;
      if (!teamEmail) {
        skipped++;
        failures.push({ shop: shop.shop_domain, reason: "no_team_email" });
        continue;
      }

      // ── Gather window metrics ────────────────────────────────────
      // Anchor on `now`; backfilled-but-stale shops still get a
      // representative current/prior window.
      const anchor = new Date(now);
      const w30 = new Date(anchor);
      w30.setUTCDate(anchor.getUTCDate() - 30);
      const w60 = new Date(anchor);
      w60.setUTCDate(anchor.getUTCDate() - 60);
      const w90 = new Date(anchor);
      w90.setUTCDate(anchor.getUTCDate() - 90);

      const cur = await windowMetrics(sb, shop.id, w30, anchor);
      const prior = await windowMetrics(sb, shop.id, w60, w30);

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

      // Don't email a shop with no recent activity — they'd see a
      // table full of "—" and lose trust in the digest.
      if (cur.ordersTotal === 0) {
        skipped++;
        failures.push({ shop: shop.shop_domain, reason: "no_recent_orders" });
        continue;
      }

      const periodLabel = new Date(
        anchor.getUTCFullYear(),
        anchor.getUTCMonth() - 1,
        1,
      ).toLocaleDateString("en-US", { month: "long", year: "numeric" });

      // Real dispute activity for the section between "Where you
      // stand" and "Month over month."
      const disputeActivity = await gatherDisputeActivity(
        sb,
        shop.id,
        anchor,
      );

      const { delivered } = await sendMonthlyChargebackDigest({
        shopDomain: shop.shop_domain,
        merchantName: null,
        to: teamEmail,
        periodLabel,
        chargebackRate90dPct,
        chargebackOrders90d: chargebacks90d ?? 0,
        current30d: cur,
        prior30d: prior,
        disputeActivity,
      });

      if (!delivered) {
        failures.push({ shop: shop.shop_domain, reason: "send_failed" });
        skipped++;
        continue;
      }

      // Update the idempotency marker. JSONB merge: rewrite the
      // `team.payload` slot preserving sibling keys.
      const newTeamPayload = {
        ...teamPayload,
        lastMonthlyDigestYyyyMm: yyyyMm,
      };
      const newSteps = {
        ...steps,
        team: { ...(steps.team ?? {}), payload: newTeamPayload },
      };
      await sb
        .from("shop_setup")
        .update({ steps: newSteps })
        .eq("shop_id", shop.id);

      sent++;
    } catch (err) {
      failures.push({
        shop: shop.shop_domain,
        reason: err instanceof Error ? err.message : "unknown",
      });
      skipped++;
    }
  }

  return NextResponse.json({
    sent,
    skipped,
    total: shops.length,
    yyyyMm,
    failures: failures.slice(0, 20),
  });
}

// ─── Window metrics gatherer ──────────────────────────────────────

interface SbClient {
  from: (table: string) => unknown;
}

async function windowMetrics(
  sb: SbClient,
  shopId: string,
  start: Date,
  end: Date,
): Promise<DigestPeriodMetrics> {
  const builder = (sb.from("shopify_orders") as unknown as {
    select: (cols: string) => unknown;
  })
    .select(
      "id, risk_level_initial, three_ds_authenticated, processed_at, fulfilled_at, signed_by_name, delivered_at_tracking, fraud_protection_level",
    );
  // Chain the query manually because the supabase-js return type is
  // too dynamic to thread through the helper cleanly.
  const { data } = await (builder as unknown as {
    eq: (c: string, v: string) => {
      gte: (c: string, v: string) => {
        lt: (c: string, v: string) => Promise<{ data: unknown[] }>;
      };
    };
  })
    .eq("shop_id", shopId)
    .gte("created_at_shopify", start.toISOString())
    .lt("created_at_shopify", end.toISOString());

  const rows = (data ?? []) as Array<{
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

  const { count: fraudDisputes } = await ((sb.from("disputes") as unknown as {
    select: (cols: string, opts: { count: string; head: boolean }) => unknown;
  })
    .select("id", { count: "exact", head: true }) as unknown as {
    eq: (c: string, v: string) => {
      eq: (c: string, v: string) => {
        gte: (c: string, v: string) => {
          lt: (c: string, v: string) => Promise<{ count: number | null }>;
        };
      };
    };
  })
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
    fraudDisputeRatePct:
      tot > 0 ? ((fraudDisputes ?? 0) / tot) * 100 : null,
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
