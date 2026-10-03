import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase/server";
import { cronEnvGate } from "@/lib/cron/envGate";
import { computeShopMonth } from "@/lib/insights/period/computeShopMonth";
import { persistShopMonth, METRICS_VERSION } from "@/lib/insights/period/persistShopMonth";
import { canMarkStable, type StabilityShop } from "@/lib/insights/period/canMarkStable";
import { driftIsMaterial, type StoredMonth } from "@/lib/insights/period/driftIsMaterial";
import { addMonths, statementMonth, trendWindow } from "@/lib/insights/period/months";
import { sendAdminEmail } from "@/lib/email/adminEmail";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Stop starting new shops after this; the next night continues. */
const TIME_BUDGET_MS = 240_000;
/** Missing or not-yet-final closed months filled per shop per run. A
 *  12-month window fills in ≤ 4 nights. */
const SELF_HEAL_CAP = 3;
/** Final months re-checked for late data (beyond last month itself). */
const DRIFT_MONTHS = 2;
const OPS_EMAIL = "support@disputedesk.app";

interface ShopRow extends StabilityShop {
  id: string;
  shop_domain: string;
}

interface MonthRow extends StoredMonth {
  period_month: string;
  stable_at: string | null;
  metrics_version: number | null;
  coverage: string | null;
}

/**
 * GET /api/cron/calculate-ratios  (02:00 UTC)
 *
 * Maintains the per-shop calendar-month rows every Insights surface reads
 * (docs/plans/insights-single-source.plan.md PR2). For each installed shop
 * whose history import is complete:
 *   1. last month: recompute, and mark final once `canMarkStable` allows;
 *   2. self-heal: up to 3 missing / not-yet-final closed months in the
 *      trend window, oldest first (zero-dispute months included);
 *   3. drift: re-check the 2 final months before it, and write a revision
 *      only when the change is material (`driftIsMaterial`);
 *   4. from the 9th, if last month is still not final, one deduped ops email.
 * The current, unfinished month is never written. All writes go through
 * `persistShopMonth`.
 */
export async function GET(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

  const sb = getServiceClient();
  const started = Date.now();
  const now = new Date();
  const lastMonth = statementMonth(now);

  const { data: shops, error } = await sb
    .from("shops")
    .select(
      "id, shop_domain, historical_import_status, historical_import_completed_at, historical_import_since_date",
    )
    .is("uninstalled_at", null)
    .eq("historical_import_status", "complete")
    .order("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: Array<Record<string, unknown>> = [];
  for (const shop of (shops ?? []) as ShopRow[]) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      results.push({ shop: shop.shop_domain, skipped: "time_budget" });
      continue;
    }
    try {
      results.push(await maintainShop(sb, shop, lastMonth, now));
    } catch (err) {
      results.push({ shop: shop.shop_domain, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({ ok: true, lastMonth, shops: results.length, results });
}

async function maintainShop(
  sb: SupabaseClient,
  shop: ShopRow,
  lastMonth: string,
  now: Date,
): Promise<Record<string, unknown>> {
  const out = { shop: shop.shop_domain, recomputed: [] as string[], revised: [] as string[], markedStable: [] as string[] };

  const { data: first, error: firstErr } = await sb
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
    firstOrderAt: (first?.created_at_shopify as string | null) ?? null,
  });

  const { data: rowsData, error: rowsErr } = await sb
    .from("ratio_snapshots")
    .select(
      "period_month, stable_at, metrics_version, coverage, card_chargeback_count, visa_chargeback_count, mc_chargeback_count, card_dispute_ratio, mc_ecm_ratio, card_framing_applies",
    )
    .eq("shop_id", shop.id)
    .in("period_month", window);
  if (rowsErr) throw new Error(`rows: ${rowsErr.message}`);
  const rows = new Map(((rowsData ?? []) as MonthRow[]).map((r) => [String(r.period_month).slice(0, 10), r]));

  const write = async (month: string, reason: string) => {
    const data = await computeShopMonth(sb, shop.id, month);
    const r = await persistShopMonth(sb, { shopId: shop.id, shop, month, data, reason, now });
    out.recomputed.push(month);
    if (r.changed && rows.has(month)) out.revised.push(month);
    if (r.stableAt && !rows.get(month)?.stable_at) out.markedStable.push(month);
    return r;
  };

  // 1. Last month, every night.
  const last = await write(lastMonth, rows.get(lastMonth) ? "nightly" : "materialize");

  // 2. Self-heal: closed months with no v2 row, or not yet final when they
  //    could be. A partial-coverage month never becomes final; once it has a
  //    v2 row it is left alone.
  const toHeal = window
    .filter((m) => m !== lastMonth)
    .filter((m) => {
      const r = rows.get(m);
      if (!r || Number(r.metrics_version ?? 1) < METRICS_VERSION) return true;
      return !r.stable_at && r.coverage !== "partial" && canMarkStable(shop, m, now);
    })
    .slice(0, SELF_HEAL_CAP);
  for (const m of toHeal) await write(m, rows.get(m) ? "self_heal" : "materialize");

  // 3. Drift on the final months just before last month.
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

  // 4. Last month should be final from the 8th; say so once if it is not.
  if (now.getUTCDate() >= 9 && !last.stableAt) {
    const { data: inserted } = await sb
      .from("insights_ops_alerts")
      .upsert(
        { shop_id: shop.id, alert_key: "m1_not_stable", period_month: lastMonth },
        { onConflict: "shop_id,alert_key,period_month", ignoreDuplicates: true },
      )
      .select("id");
    if ((inserted ?? []).length > 0) {
      await sendAdminEmail({
        to: OPS_EMAIL,
        logTag: "insights-m1-not-stable",
        subject: `[Insights] ${shop.shop_domain}: ${lastMonth.slice(0, 7)} is not final`,
        text: `${shop.shop_domain}'s ${lastMonth.slice(0, 7)} month row is still not final on day ${now.getUTCDate()}, so its monthly digest cannot send. Check historical_import_status / since_date and the calculate-ratios cron output.`,
        html: `<p><strong>${shop.shop_domain}</strong>'s ${lastMonth.slice(0, 7)} month row is still not final on day ${now.getUTCDate()}, so its monthly digest cannot send.</p><p>Check <code>historical_import_status</code> / <code>since_date</code> and the calculate-ratios cron output.</p>`,
      });
    }
  }

  return out;
}
