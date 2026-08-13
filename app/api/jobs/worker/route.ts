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
import { handleEnrichGorgiasComms } from "@/lib/jobs/handlers/enrichGorgiasCommsJob";
import { handleIntelligenceRun } from "@/lib/jobs/handlers/intelligenceRunJob";
import { cronEnvGate } from "@/lib/cron/envGate";

export const runtime = "nodejs";
// Backfill jobs walk 90 UTC days × ~700ms/day ≈ 63s. Other handlers
// typically finish in <10s. 300s leaves headroom for retries on slow
// Shopify responses without leaking into the worker's 2-min cadence.
export const maxDuration = 300;

/**
 * POST|GET /api/jobs/worker
 *
 * Called by Vercel Cron every 2 minutes.
 * Requires CRON_SECRET header for authentication.
 * Claims queued jobs and executes handlers.
 */
async function runWorker(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

  /* ── BATCH SIZE, SIZED AGAINST THE REAL BUDGET ──────────────────────
   *
   * Was 5. With the cron at every 2 minutes that is a hard ceiling of 150
   * jobs/hour no matter how fast the work is, and jobs run SEQUENTIALLY in
   * the loop below.
   *
   * Measured on production 2026-08-12 over 43 pack rebuilds:
   *
   *   build_pack             work  9.5s avg (max 17s) · queue wait ~1238s
   *   build_defence_package  work 29.7s avg (max 46s) · queue wait  ~771s
   *
   * Wait was 99 % of elapsed time — a 43-pack rebuild (86 jobs, each
   * `build_pack` chaining a `build_defence_package`) took hours of wall clock
   * for ~40 seconds of work per dispute. Every bulk operation hits this.
   *
   * 10 is the size the 300s `maxDuration` supports with real margin: ten of
   * the SLOWEST observed job (46s) is 460s and would overrun, so the bound is
   * not "worst case × batch". It is that the queue is overwhelmingly
   * `build_pack` (9.5s) with at most a few defence builds interleaved — 10
   * mixed jobs measure ~100-200s. A batch that overruns is not lost: the job
   * stays claimed, `claim_jobs` reclaims stale locks, and the next tick
   * continues. Doubling throughput while keeping ~40 % headroom is the trade;
   * raising it further would start betting on the mix.
   */
  const workerId = `worker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const claimed = await claimJobs(workerId, 10);

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
        case "enrich_gorgias_comms":
          handlerResult = await handleEnrichGorgiasComms(job);
          break;
        case "intel_run":
          handlerResult = await handleIntelligenceRun(job);
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
