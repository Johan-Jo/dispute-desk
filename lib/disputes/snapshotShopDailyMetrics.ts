/**
 * Snapshot one (shop, date) row into `shop_daily_metrics`.
 *
 * Inputs:
 *   - shopId — internal `shops.id`
 *   - dateIso — `YYYY-MM-DD` (UTC). The snapshot is anchored to UTC
 *     midnight boundaries; merchant timezones are intentionally not
 *     considered. The chargeback-rate metric is reported in UTC days.
 *
 * Sources:
 *   - Order count: live Shopify Admin GraphQL `ordersCount` (single
 *     call, ~1 query point).
 *   - Dispute counts: local `disputes` table filtered by
 *     `initiated_at` falling inside the UTC day, split by `phase`.
 *     Source-of-truth for "initiated" is Shopify, not our ingestion
 *     time — the metric matches card-network semantics.
 *
 * Side effect: upserts a single row into `shop_daily_metrics` keyed by
 * (shop_id, date). Re-runs are idempotent and refresh `last_synced_at`.
 *
 * Failure modes:
 *   - No offline session → throws `NoBackgroundSessionError` (the cron
 *     skips this shop on the next round).
 *   - Shopify auth invalid → throws `ShopifyAuthInvalidError`.
 *   - Shopify GraphQL error → propagates; the job runner retries
 *     according to `jobs.max_attempts`.
 *
 * The PRD's fallback rule (PRD §6: "If snapshot missing, return null /
 * loading state — do NOT compute from live Shopify") is enforced at the
 * read side (metrics util), not here.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { getShopBackgroundSession, assertNotAuthInvalid } from "@/lib/shopify/sessions/getShopBackgroundSession";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import {
  SHOP_ORDERS_COUNT_QUERY,
  ordersCountSearchQueryForDate,
  type OrdersCountResult,
} from "@/lib/shopify/queries/ordersCount";

export interface SnapshotResult {
  shopId: string;
  date: string;
  orderCount: number;
  disputeCount: number;
  chargebackCount: number;
  inquiryCount: number;
  precision: OrdersCountResult["precision"];
}

export async function snapshotShopDailyMetrics(
  shopId: string,
  dateIso: string,
  opts: { correlationId?: string } = {},
): Promise<SnapshotResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    throw new Error(`snapshotShopDailyMetrics: invalid date "${dateIso}", expected YYYY-MM-DD`);
  }

  const session = await getShopBackgroundSession(shopId);

  // Order count from Shopify.
  const gqlResp = await requestShopifyGraphQL<{ ordersCount: OrdersCountResult }>({
    session: { shopDomain: session.shopDomain, accessToken: session.accessToken },
    query: SHOP_ORDERS_COUNT_QUERY,
    variables: { query: ordersCountSearchQueryForDate(dateIso) },
    correlationId: opts.correlationId ?? `snapshot-${shopId}-${dateIso}`,
  });

  assertNotAuthInvalid(shopId, "offline", { errors: gqlResp.errors ?? null });

  if (gqlResp.errors && gqlResp.errors.length > 0) {
    throw new Error(
      `Shopify ordersCount failed: ${gqlResp.errors.map((e) => e.message).join("; ")}`,
    );
  }
  if (!gqlResp.data?.ordersCount) {
    throw new Error("Shopify ordersCount returned no data");
  }

  const orderCount = gqlResp.data.ordersCount.count;
  const precision = gqlResp.data.ordersCount.precision;

  // Dispute counts from the local table. We rely on the routine
  // `sync-disputes` job (every 5 min) to keep this up-to-date; for
  // brand-new installs the backfill orchestrator should run a fresh
  // dispute sync before invoking the snapshot job for that day.
  const sb = getServiceClient();
  const startIso = `${dateIso}T00:00:00Z`;
  const endIso = `${nextDateIso(dateIso)}T00:00:00Z`;

  const { data: disputeRows, error: disputeErr } = await sb
    .from("disputes")
    .select("id, phase")
    .eq("shop_id", shopId)
    .gte("initiated_at", startIso)
    .lt("initiated_at", endIso);

  if (disputeErr) {
    throw new Error(`disputes lookup failed: ${disputeErr.message}`);
  }

  let chargebackCount = 0;
  let inquiryCount = 0;
  for (const row of disputeRows ?? []) {
    if (row.phase === "chargeback") chargebackCount += 1;
    else if (row.phase === "inquiry") inquiryCount += 1;
    // phase NULL is excluded from both buckets per PRD §11. The total
    // `dispute_count` still includes them.
  }
  const disputeCount = (disputeRows ?? []).length;

  // Upsert.
  const { error: upsertErr } = await sb
    .from("shop_daily_metrics")
    .upsert(
      {
        shop_id: shopId,
        date: dateIso,
        order_count: orderCount,
        dispute_count: disputeCount,
        chargeback_count: chargebackCount,
        inquiry_count: inquiryCount,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "shop_id,date" },
    );

  if (upsertErr) {
    throw new Error(`shop_daily_metrics upsert failed: ${upsertErr.message}`);
  }

  return {
    shopId,
    date: dateIso,
    orderCount,
    disputeCount,
    chargebackCount,
    inquiryCount,
    precision,
  };
}

function nextDateIso(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Yesterday in UTC (`YYYY-MM-DD`). The most recent fully complete day. */
export function yesterdayUtcDateIso(now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Build a list of YYYY-MM-DD strings for the last `days` UTC days
 *  ending at (and excluding) today — used for backfill. */
export function recentUtcDates(days: number, now: Date = new Date()): string[] {
  const dates: string[] = [];
  for (let i = 1; i <= days; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}
