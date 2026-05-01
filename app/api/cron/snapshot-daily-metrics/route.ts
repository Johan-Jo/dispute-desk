import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { enqueueJob } from "@/lib/jobs/claimJobs";
import { yesterdayUtcDateIso } from "@/lib/disputes/snapshotShopDailyMetrics";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * GET /api/cron/snapshot-daily-metrics
 *
 * Called by Vercel Cron once daily. Enqueues a
 * `snapshot_shop_daily_metrics` job per active shop for the just-
 * completed UTC day. The job is idempotent (upsert by (shop_id,
 * date)) so re-runs are safe.
 *
 * Why "yesterday" and not "today": today is still in flight, so its
 * row would be partial. The PRD treats the chargeback rate as a
 * monitoring metric — up-to-yesterday accuracy is correct.
 *
 * The 30d/90d backfill on install is handled separately by the
 * `enqueueShopDailyMetricsBackfill` helper (lib/disputes/...).
 */
export async function GET(req: NextRequest) {
  const secret =
    req.headers.get("authorization")?.replace("Bearer ", "") ??
    req.nextUrl.searchParams.get("secret");

  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getServiceClient();
  const date = yesterdayUtcDateIso();

  const { data: shops, error } = await sb
    .from("shops")
    .select("id")
    .is("uninstalled_at", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const enqueued: string[] = [];
  for (const shop of shops ?? []) {
    // Avoid stacking duplicate jobs for the same (shop, date) — if a
    // prior job is still queued/running for this shop and same
    // entity_id, skip.
    const { data: existing } = await sb
      .from("jobs")
      .select("id")
      .eq("shop_id", shop.id)
      .eq("job_type", "snapshot_shop_daily_metrics")
      .eq("entity_id", date)
      .in("status", ["queued", "running"])
      .limit(1)
      .maybeSingle();

    if (existing) continue;

    const jobId = await enqueueJob({
      shopId: shop.id,
      jobType: "snapshot_shop_daily_metrics",
      entityId: date,
      priority: 80,
    });
    enqueued.push(jobId);
  }

  return NextResponse.json({
    date,
    shops: (shops ?? []).length,
    enqueued: enqueued.length,
    jobIds: enqueued,
  });
}
