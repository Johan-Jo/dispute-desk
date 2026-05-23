import { NextRequest, NextResponse } from "next/server";
import { claimJobs, markJobSucceeded, markJobFailed } from "@/lib/jobs/claimJobs";
import { handleBuildPack } from "@/lib/jobs/handlers/buildPackJob";
import { handleRenderPdf } from "@/lib/jobs/handlers/renderPdfJob";
import { handleSyncDisputes } from "@/lib/jobs/handlers/syncDisputesJob";
import { handleSaveToShopify } from "@/lib/jobs/handlers/saveToShopifyJob";
import { handleBuildDefencePackage } from "@/lib/jobs/handlers/buildDefencePackageJob";
import { handleSnapshotShopDailyMetrics } from "@/lib/jobs/handlers/snapshotShopDailyMetricsJob";
import { handleBackfillShopDailyMetrics } from "@/lib/jobs/handlers/backfillShopDailyMetricsJob";
import { handleBackfillShopOrders } from "@/lib/jobs/handlers/backfillOrdersJob";
import { handleSnapshotFraudDailyMetrics } from "@/lib/jobs/handlers/snapshotFraudDailyMetricsJob";
import { handleBackfillFraudDailyMetrics } from "@/lib/jobs/handlers/backfillFraudDailyMetricsJob";
import { handleReconcileMissingOrder } from "@/lib/jobs/handlers/reconcileMissingOrderJob";

export const runtime = "nodejs";
// Backfill jobs walk 90 UTC days × ~700ms/day ≈ 63s. Other handlers
// typically finish in <10s. 300s leaves headroom for retries on slow
// Shopify responses without leaking into the worker's 2-min cadence.
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * POST|GET /api/jobs/worker
 *
 * Called by Vercel Cron every 2 minutes.
 * Requires CRON_SECRET header for authentication.
 * Claims queued jobs and executes handlers.
 */
async function runWorker(req: NextRequest) {
  const secret =
    req.headers.get("x-cron-secret") ??
    req.headers.get("authorization")?.replace("Bearer ", "") ??
    req.nextUrl.searchParams.get("secret");
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workerId = `worker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const claimed = await claimJobs(workerId, 5);

  const results: Array<{ jobId: string; status: string; error?: string }> = [];

  for (const job of claimed) {
    try {
      // Handlers return either `void` (legacy) or a `JobResult` (Phase
      // 2.6+). When a handler explicitly returns `{ ok: false, ... }`,
      // the dispatcher honors `retriable` instead of always retrying
      // until maxAttempts. Throws stay retriable by default.
      let handlerResult: void | { ok: boolean; reason?: string; retriable?: boolean } | undefined;
      switch (job.jobType) {
        case "build_pack":
          await handleBuildPack(job);
          break;
        case "render_pdf":
          await handleRenderPdf(job);
          break;
        case "sync_disputes":
          await handleSyncDisputes(job);
          break;
        case "save_to_shopify":
          handlerResult = await handleSaveToShopify(job);
          break;
        case "build_defence_package":
          handlerResult = await handleBuildDefencePackage(job);
          break;
        case "snapshot_shop_daily_metrics":
          await handleSnapshotShopDailyMetrics(job);
          break;
        case "backfill_shop_daily_metrics":
          await handleBackfillShopDailyMetrics(job);
          break;
        case "backfill_shop_orders":
          await handleBackfillShopOrders(job);
          break;
        case "snapshot_fraud_daily_metrics":
          await handleSnapshotFraudDailyMetrics(job);
          break;
        case "backfill_fraud_daily_metrics":
          await handleBackfillFraudDailyMetrics(job);
          break;
        case "reconcile_missing_order":
          await handleReconcileMissingOrder(job);
          break;
        default:
          throw new Error(`Unknown job type: ${job.jobType}`);
      }

      if (handlerResult && handlerResult.ok === false) {
        const reason = handlerResult.reason ?? "handler returned failure";
        await markJobFailed(job.id, reason, job.attempts, job.maxAttempts, {
          retriable: handlerResult.retriable !== false,
        });
        results.push({ jobId: job.id, status: "failed", error: reason });
      } else {
        await markJobSucceeded(job.id);
        results.push({ jobId: job.id, status: "succeeded" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Unhandled exception → retriable by default. Handlers that
      // need non-retriable behavior should return JobResult instead.
      await markJobFailed(job.id, message, job.attempts, job.maxAttempts);
      results.push({ jobId: job.id, status: "failed", error: message });
    }
  }

  return NextResponse.json({
    claimed: claimed.length,
    results,
  });
}

export async function POST(req: NextRequest) {
  return runWorker(req);
}

export async function GET(req: NextRequest) {
  return runWorker(req);
}
