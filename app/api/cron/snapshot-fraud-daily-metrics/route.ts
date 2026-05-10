import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { enqueueJob } from "@/lib/jobs/claimJobs";
import { fraudYesterdayUtcDateIso } from "@/lib/disputes/snapshotFraudDailyMetrics";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * GET /api/cron/snapshot-fraud-daily-metrics
 *
 * Vercel Cron once daily (parallel to /api/cron/snapshot-daily-metrics).
 * Enqueues a `snapshot_fraud_daily_metrics` job per active shop for
 * yesterday UTC. Idempotent via upsert on (shop_id, date).
 *
 * Only shops with `historical_import_status = 'complete'` are
 * scheduled — until the order backfill finishes there's no source
 * data to aggregate.
 *
 * Backfill of the rollup table for historical dates happens as a
 * one-shot `backfill_fraud_daily_metrics` job enqueued by the order
 * backfill orchestrator on completion.
 */
export async function GET(req: NextRequest) {
  const secret =
    req.headers.get("authorization")?.replace("Bearer ", "") ??
    req.nextUrl.searchParams.get("secret");

  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getServiceClient();
  const date = fraudYesterdayUtcDateIso();

  const { data: shops, error } = await sb
    .from("shops")
    .select("id")
    .is("uninstalled_at", null)
    .eq("historical_import_status", "complete");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const enqueued: string[] = [];
  for (const shop of shops ?? []) {
    // Skip when a job for the same (shop, date) is already in flight.
    const { data: existing } = await sb
      .from("jobs")
      .select("id")
      .eq("shop_id", shop.id)
      .eq("job_type", "snapshot_fraud_daily_metrics")
      .eq("entity_id", date)
      .in("status", ["queued", "running"])
      .limit(1)
      .maybeSingle();
    if (existing) continue;

    const jobId = await enqueueJob({
      shopId: shop.id,
      jobType: "snapshot_fraud_daily_metrics",
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
