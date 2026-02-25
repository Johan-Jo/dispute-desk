import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { enqueueJob } from "@/lib/jobs/claimJobs";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * GET /api/cron/sync-disputes
 *
 * Called by Vercel Cron every 5 minutes. Enqueues a sync_disputes
 * job for each active (installed) shop.
 */
export async function GET(req: NextRequest) {
  const secret =
    req.headers.get("authorization")?.replace("Bearer ", "") ??
    req.nextUrl.searchParams.get("secret");

  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getServiceClient();

  const { data: shops, error } = await sb
    .from("shops")
    .select("id")
    .is("uninstalled_at", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const enqueued: string[] = [];
  for (const shop of shops ?? []) {
    // Skip if a sync job is already queued/running for this shop
    const { data: existing } = await sb
      .from("jobs")
      .select("id")
      .eq("shop_id", shop.id)
      .eq("job_type", "sync_disputes")
      .in("status", ["queued", "running"])
      .limit(1)
      .maybeSingle();

    if (existing) continue;

    const jobId = await enqueueJob({
      shopId: shop.id,
      jobType: "sync_disputes",
      entityId: shop.id,
      priority: 50,
    });
    enqueued.push(jobId);
  }

  return NextResponse.json({
    shops: (shops ?? []).length,
    enqueued: enqueued.length,
    jobIds: enqueued,
  });
}
