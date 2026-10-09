/**
 * The one routine that maintains a shop's calendar-month records
 * (docs/plans/insights-first-day-gaps.plan.md §3.2). The nightly
 * `calculate-ratios` cron and the `materialize_insights_months` job both call
 * it, so a shop reaches the same state whichever runs.
 *
 *   1. A shop with no record at all is written only once its dispute history
 *      has arrived (`canMaterializeFirst`); until then nothing is written.
 *   2. For that first write, the 90-day daily-metrics backfill is enqueued
 *      before any month is written, so a run that dies later cannot lose it.
 *   3. The statement month (last month) is written first whenever the month
 *      before it has a record or lies outside the trend window — every
 *      established shop, every night.
 *   4. Missing / outdated / not-yet-final closed months are healed oldest
 *      first until `budgetMs` is used. Each month reads its predecessor's
 *      stored median, so the order matters.
 *   5. On a first materialization the statement month is written last, once
 *      every older month exists.
 *   6. Drift on the 2 final months before the statement month, and the day-9
 *      "not final" ops alert.
 *
 * The current, unfinished month is never written. All writes go through
 * `persistShopMonth`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { enqueueShopDailyMetricsBackfill } from "@/lib/disputes/backfillShopDailyMetrics";
import { sendAdminEmail } from "@/lib/email/adminEmail";
import { canMarkStable, type StabilityShop } from "./canMarkStable";
import { computeShopMonth } from "./computeShopMonth";
import { driftIsMaterial, type StoredMonth } from "./driftIsMaterial";
import { canMaterializeFirst } from "./firstMaterialization";
import { addMonths, statementMonth, trendWindow } from "./months";
import { persistShopMonth, METRICS_VERSION } from "./persistShopMonth";

/** Final months re-checked for late data (beyond the statement month). */
const DRIFT_MONTHS = 2;
const OPS_EMAIL = "support@disputedesk.app";

export interface MaintainShop extends StabilityShop {
  id: string;
  shop_domain: string;
}

interface MonthRow extends StoredMonth {
  period_month: string;
  stable_at: string | null;
  metrics_version: number | null;
  coverage: string | null;
}

export interface MaintainResult {
  /** No record yet and the shop's inputs are not complete; nothing written. */
  skipped?: "not_ready";
  /** Months written by steps 3–5, in write order. */
  written: string[];
  /** Months still to write, the statement month included. */
  remaining: number;
  /** The statement month has a record after this run. */
  statementRecorded: boolean;
  revised: string[];
  markedStable: string[];
}

export async function maintainShopMonths(
  sb: SupabaseClient,
  shop: MaintainShop,
  now: Date,
  opts: { budgetMs: number },
): Promise<MaintainResult> {
  const started = Date.now();
  const lastMonth = statementMonth(now);
  const out: MaintainResult = {
    written: [],
    remaining: 0,
    statementRecorded: false,
    revised: [],
    markedStable: [],
  };

  // 1. First records wait for the shop's disputes.
  const { count: recordCount, error: countErr } = await sb
    .from("ratio_snapshots")
    .select("period_month", { count: "exact", head: true })
    .eq("shop_id", shop.id);
  if (countErr) throw new Error(`record count: ${countErr.message}`);
  if ((recordCount ?? 0) === 0) {
    const first = await canMaterializeFirst(sb, shop, now);
    if (!first.ok) return { ...out, skipped: "not_ready" };

    // 2. Disputes are local now, so the daily rows can count them.
    await enqueueShopDailyMetricsBackfill(shop.id, { force: true });

    if (first.forced) await alertOnce(sb, shop, "first_records_forced", lastMonth, {
      logTag: "insights-first-records-forced",
      subject: `[Insights] ${shop.shop_domain}: first month records written without a dispute sync`,
      text: `${shop.shop_domain} finished its order import more than 24 hours ago and has no successful sync_disputes job. Its month records and daily metrics were computed without a successful dispute sync and must be recomputed once the sync is repaired (scripts/recompute-insights-months.ts, and a backfill_shop_daily_metrics job).`,
    });
  }

  const { data: firstOrder, error: firstErr } = await sb
    .from("shopify_orders")
    .select("created_at_shopify")
    .eq("shop_id", shop.id)
    .order("created_at_shopify", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (firstErr) throw new Error(`first order: ${firstErr.message}`);
  const window = trendWindow({
    now,
    sinceDate: shop.historical_import_since_date,
    firstOrderAt: (firstOrder?.created_at_shopify as string | null) ?? null,
  });

  const { data: rowsData, error: rowsErr } = await sb
    .from("ratio_snapshots")
    .select(
      "period_month, stable_at, metrics_version, coverage, card_chargeback_count, visa_chargeback_count, mc_chargeback_count, card_dispute_ratio, mc_ecm_ratio, card_framing_applies",
    )
    .eq("shop_id", shop.id)
    .in("period_month", [...new Set([...window, lastMonth])]);
  if (rowsErr) throw new Error(`rows: ${rowsErr.message}`);
  const rows = new Map(((rowsData ?? []) as MonthRow[]).map((r) => [String(r.period_month).slice(0, 10), r]));

  const write = async (month: string, reason: string) => {
    const data = await computeShopMonth(sb, shop.id, month);
    const r = await persistShopMonth(sb, { shopId: shop.id, shop, month, data, reason, now });
    out.written.push(month);
    if (r.changed && rows.has(month)) out.revised.push(month);
    if (r.stableAt && !rows.get(month)?.stable_at) out.markedStable.push(month);
    return r;
  };
  const statementReason = rows.get(lastMonth) ? "nightly" : "materialize";

  // Closed months with no current-version row, or not yet final when they
  // could be. A partial-coverage month never becomes final; once it has a
  // current row it is left alone.
  const toHeal = window
    .filter((m) => m !== lastMonth)
    .filter((m) => {
      const r = rows.get(m);
      if (!r || Number(r.metrics_version ?? 1) < METRICS_VERSION) return true;
      return !r.stable_at && r.coverage !== "partial" && canMarkStable(shop, m, now);
    });

  // 3. Statement month first when its predecessor is on record.
  const previous = addMonths(lastMonth, -1);
  let statementStableAt: string | null | undefined;
  if (rows.has(previous) || !window.includes(previous)) {
    statementStableAt = (await write(lastMonth, statementReason)).stableAt;
  }

  // 4. Heals, oldest first, within the budget.
  let healed = 0;
  for (const m of toHeal) {
    if (Date.now() - started > opts.budgetMs) break;
    await write(m, rows.get(m) ? "self_heal" : "materialize");
    healed++;
  }

  // 5. First materialization: the statement month last, after its predecessor.
  if (statementStableAt === undefined && healed === toHeal.length) {
    statementStableAt = (await write(lastMonth, statementReason)).stableAt;
  }

  const statementWritten = statementStableAt !== undefined;
  out.remaining = toHeal.length - healed + (statementWritten ? 0 : 1);
  out.statementRecorded = statementWritten || rows.has(lastMonth);

  // 6a. Drift on the final months just before the statement month.
  for (let i = 1; i <= DRIFT_MONTHS; i++) {
    const m = addMonths(lastMonth, -i);
    const r = rows.get(m);
    if (!r || !r.stable_at || toHeal.includes(m) || !window.includes(m)) continue;
    if (Number(r.metrics_version ?? 1) < METRICS_VERSION) continue;
    const data = await computeShopMonth(sb, shop.id, m);
    if (!driftIsMaterial(r, data.programme)) continue;
    await persistShopMonth(sb, { shopId: shop.id, shop, month: m, data, reason: "late_data", now });
    out.revised.push(m);
  }

  // 6b. The statement month should be final from the 8th; say so once if it
  //     is not. A statement month that has no record yet (a first
  //     materialization still in progress) is not judged.
  const stableAt = statementWritten ? statementStableAt : rows.get(lastMonth)?.stable_at;
  if (out.statementRecorded && now.getUTCDate() >= 9 && !stableAt) {
    await alertOnce(sb, shop, "m1_not_stable", lastMonth, {
      logTag: "insights-m1-not-stable",
      subject: `[Insights] ${shop.shop_domain}: ${lastMonth.slice(0, 7)} is not final`,
      text: `${shop.shop_domain}'s ${lastMonth.slice(0, 7)} month row is still not final on day ${now.getUTCDate()}, so its monthly digest cannot send. Check historical_import_status / since_date and the calculate-ratios cron output.`,
    });
  }

  return out;
}

/** One ops email per (shop, alert, month): the row is the dedup. */
export async function alertOnce(
  sb: SupabaseClient,
  shop: { id: string },
  alertKey: string,
  month: string,
  email: { logTag: string; subject: string; text: string },
): Promise<void> {
  const { data: inserted } = await sb
    .from("insights_ops_alerts")
    .upsert(
      { shop_id: shop.id, alert_key: alertKey, period_month: month },
      { onConflict: "shop_id,alert_key,period_month", ignoreDuplicates: true },
    )
    .select("id");
  if ((inserted ?? []).length === 0) return;
  await sendAdminEmail({
    to: OPS_EMAIL,
    logTag: email.logTag,
    subject: email.subject,
    text: email.text,
    html: `<p>${email.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`,
  });
}
