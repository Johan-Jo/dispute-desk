import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { cronEnvGate } from "@/lib/cron/envGate";
import { maintainShopMonths, type MaintainShop } from "@/lib/insights/period/maintainShopMonths";
import { enqueueMaterializeInsightsMonths } from "@/lib/insights/period/enqueueMaterialize";
import { statementMonth } from "@/lib/insights/period/months";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Stop starting new shops after this; the next night continues. */
const TIME_BUDGET_MS = 240_000;

/**
 * GET /api/cron/calculate-ratios  (02:00 UTC)
 *
 * Maintains the per-shop calendar-month rows every Insights surface reads
 * (docs/plans/insights-single-source.plan.md PR2). For each installed shop
 * whose history import is complete it runs `maintainShopMonths`:
 *   1. a shop with no record yet is written only once its disputes have
 *      synced (or, after 24 hours without a sync, anyway, with an ops alert);
 *   2. last month: recomputed, and marked final once `canMarkStable` allows;
 *   3. self-heal: missing / not-yet-final closed months in the trend window,
 *      oldest first (zero-dispute months included), within the shop's share
 *      of the time budget;
 *   4. drift: re-check the 2 final months before it, and write a revision
 *      only when the change is material (`driftIsMaterial`);
 *   5. from the 9th, if last month is still not final, one deduped ops email.
 * The current, unfinished month is never written. All writes go through
 * `persistShopMonth`.
 *
 * New shops normally get their records from the `materialize_insights_months`
 * job; this cron is the reconciler that reaches the same state if that job
 * is lost.
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

  const list = (shops ?? []) as MaintainShop[];
  const results: Array<Record<string, unknown>> = [];
  for (const [index, shop] of list.entries()) {
    const left = TIME_BUDGET_MS - (Date.now() - started);
    if (left <= 0) {
      results.push({ shop: shop.shop_domain, skipped: "time_budget" });
      continue;
    }
    try {
      // A fair share of what is left, so one shop with many months to heal
      // (a new shop, or every shop after a metrics-version bump) cannot take
      // the night from the shops after it.
      const r = await maintainShopMonths(sb, shop, now, { budgetMs: left / (list.length - index) });
      if (r.skipped) {
        results.push({ shop: shop.shop_domain, skipped: r.skipped });
        continue;
      }
      // A first materialization cut by the share: hand the rest to the job
      // rather than leave the statement month for tomorrow night.
      const handedOff =
        r.remaining > 0 && !r.statementRecorded
          ? (await enqueueMaterializeInsightsMonths(shop.id, { unfinished: true })) !== null
          : false;
      results.push({
        shop: shop.shop_domain,
        recomputed: r.written,
        revised: r.revised,
        markedStable: r.markedStable,
        remaining: r.remaining,
        ...(handedOff ? { handedOff } : {}),
      });
    } catch (err) {
      results.push({ shop: shop.shop_domain, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({ ok: true, lastMonth, shops: results.length, results });
}
