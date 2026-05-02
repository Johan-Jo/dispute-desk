import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { enqueueJob } from "@/lib/jobs/claimJobs";

const CRON_SECRET = process.env.CRON_SECRET;

const CIRCUIT_BREAKER_WINDOW = 5;
const CLAIM_BATCH = 200;

/**
 * GET /api/cron/sync-disputes
 *
 * Reconciliation cron. Webhooks (disputes/create, disputes/update) drive
 * primary sync; this catches missed webhooks via per-shop next_reconcile_at.
 *
 * Each tick claims up to CLAIM_BATCH shops whose next_reconcile_at <= now()
 * (atomic, FOR UPDATE SKIP LOCKED), advances their schedule, and enqueues
 * one sync_disputes job per claimed shop. Bounded by CLAIM_BATCH regardless
 * of tenant count.
 */
export async function GET(req: NextRequest) {
  const secret =
    req.headers.get("authorization")?.replace("Bearer ", "") ??
    req.nextUrl.searchParams.get("secret");

  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getServiceClient();

  const { data: due, error: claimErr } = await sb.rpc("claim_due_shops", {
    p_limit: CLAIM_BATCH,
  });

  if (claimErr) {
    return NextResponse.json({ error: claimErr.message }, { status: 500 });
  }

  const enqueued: string[] = [];
  const skipped: { shopId: string; reason: string }[] = [];

  for (const shop of (due ?? []) as { id: string; shop_domain: string }[]) {
    const { data: existing } = await sb
      .from("jobs")
      .select("id")
      .eq("shop_id", shop.id)
      .eq("job_type", "sync_disputes")
      .in("status", ["queued", "running"])
      .limit(1)
      .maybeSingle();

    if (existing) {
      skipped.push({ shopId: shop.id, reason: "job_already_pending" });
      continue;
    }

    // Root-cause skip: no offline Shopify session = every sync will fail with
    // "No offline session for shop ...". Don't enqueue work that can't succeed.
    const { data: session } = await sb
      .from("shop_sessions")
      .select("id")
      .eq("shop_id", shop.id)
      .eq("session_type", "offline")
      .is("user_id", null)
      .limit(1)
      .maybeSingle();

    if (!session) {
      skipped.push({ shopId: shop.id, reason: "no_offline_session" });
      continue;
    }

    // Circuit-breaker: if the last N sync_disputes jobs for this shop ALL
    // failed, pause enqueuing until an admin intervenes.
    const { data: recent } = await sb
      .from("jobs")
      .select("status")
      .eq("shop_id", shop.id)
      .eq("job_type", "sync_disputes")
      .in("status", ["succeeded", "failed"])
      .order("created_at", { ascending: false })
      .limit(CIRCUIT_BREAKER_WINDOW);

    if (
      (recent?.length ?? 0) >= CIRCUIT_BREAKER_WINDOW &&
      (recent ?? []).every((j) => j.status === "failed")
    ) {
      skipped.push({ shopId: shop.id, reason: "circuit_breaker_open" });
      continue;
    }

    const jobId = await enqueueJob({
      shopId: shop.id,
      jobType: "sync_disputes",
      entityId: shop.id,
      priority: 50,
    });
    enqueued.push(jobId);
  }

  return NextResponse.json({
    claimed: (due ?? []).length,
    enqueued: enqueued.length,
    skipped: skipped.length,
    skippedDetails: skipped,
    jobIds: enqueued,
  });
}
