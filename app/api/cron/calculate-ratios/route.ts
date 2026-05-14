import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import {
  calculateRatiosForMonth,
  monthStart,
} from "@/lib/liabilityShift/ratios/calculate";

export const runtime = "nodejs";
// Vercel free plan caps maxDuration at 60s; we expect this to finish
// well within that for any realistic shop count.
export const maxDuration = 300;

/**
 * GET /api/cron/calculate-ratios
 *
 * Nightly LSE-5 ratio snapshot job. For every shop, calculates VAMP /
 * Mastercard ECM / Mastercard EFM ratios for the current month and the
 * previous month if the current date is in the first 7 days (so
 * late-arriving dispute data still updates the previous month's snapshot).
 *
 * Idempotent: upserts ratio_snapshots by (shop_id, period_month).
 *
 * Authentication: CRON_SECRET in the Authorization header (standard
 * Vercel cron pattern). Vercel adds it automatically when calling
 * cron routes; manual triggers must include it explicitly.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  const sb = getServiceClient();
  const { data: shops, error } = await sb
    .from("shops")
    .select("id")
    .is("uninstalled_at", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const now = new Date();
  const currentMonth = monthStart(now);
  const prevMonth = (() => {
    const d = new Date(now);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return monthStart(d);
  })();
  // Re-compute previous month only in the first 7 days of the new
  // month — keeps the workload bounded while catching late dispute data.
  const dayOfMonth = now.getUTCDate();
  const includePrev = dayOfMonth <= 7;

  const results: Array<{ shopId: string; status: string; error?: string }> = [];

  for (const shop of shops ?? []) {
    const months = [currentMonth, ...(includePrev ? [prevMonth] : [])];
    for (const period of months) {
      try {
        await calculateRatiosForMonth({ shopId: shop.id, periodMonth: period });
        results.push({ shopId: shop.id, status: `ok:${period}` });
      } catch (err) {
        results.push({
          shopId: shop.id,
          status: `error:${period}`,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    shopsProcessed: shops?.length ?? 0,
    includePrev,
    currentMonth,
    prevMonth,
    results,
  });
}
