import { NextRequest, NextResponse } from "next/server";
import { claimJobs, markJobSucceeded, markJobFailed, releaseJob } from "@/lib/jobs/claimJobs";
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
import { handleReplayBlockedBuilds } from "@/lib/jobs/handlers/replayBlockedBuildsJob";
import { handleCollectProductEvidence } from "@/lib/jobs/handlers/collectProductEvidenceJob";
import { handleMaterializeInsightsMonths } from "@/lib/jobs/handlers/materializeInsightsMonthsJob";
import { cronEnvGate } from "@/lib/cron/envGate";

export const runtime = "nodejs";
// Backfill jobs walk 90 UTC days × ~700ms/day ≈ 63s; order backfills and
// dispute syncs run for minutes. 300s leaves headroom for one long job
// started within the 150s start budget below.
export const maxDuration = 300;

/**
 * No new job starts after this much of the invocation has passed; the rest of
 * the batch goes back to the queue for the next tick (2 min). Jobs run one
 * after another, so without it a batch holding two long jobs (e.g. two
 * sync_disputes of ~4 min) was killed at 300 s mid-job and only resumed when
 * its lock expired 10 min later — every hour (2026-09-29: 2-3 of 4 sync jobs
 * reclaimed per hour, some only finishing on their last attempt).
 */
const START_BUDGET_MS = 150_000;

/**
 * Job types that may START in a later claim round, i.e. part-way through the
 * invocation. These finish in seconds (measured: `build_pack` ~8 s,
 * `build_defence_package` ~30 s, max 46 s).
 *
 * Everything else is only started from the first claim, at t≈0, exactly as
 * before the re-claim loop existed. `backfill_shop_orders` measures its 240 s
 * soft budget from its own start, and `sync_disputes` /
 * `backfill_fraud_daily_metrics` run for minutes: started at t=140 s they
 * would be killed at the 300 s `maxDuration`, burn an attempt and hold the
 * shop's only slot until the 600 s lock expires. A type missing from this
 * list just waits for the next tick, so new job types are safe by default.
 */
const LATE_START_JOB_TYPES = new Set([
  "build_pack",
  "build_defence_package",
  "render_pdf",
  "save_to_shopify",
  "replay_blocked_builds",
  "collect_product_evidence",
]);

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
   *
   * 10 is per CLAIM. It spreads one claim over up to ten shops; it never
   * gave one shop more than one job — see the re-claim loop below.
   */
  const workerId = `worker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const results: Array<{ jobId: string; status: string; error?: string }> = [];
  const startedAt = Date.now();

  /* ── CLAIM AGAIN WHILE THE START BUDGET LASTS ───────────────────────
   *
   * `claim_jobs` caps a shop at ONE running job, and the cap is evaluated
   * inside the claim — so a single call hands back at most one job per shop,
   * whatever `p_limit` says. The batch size of 10 above only ever helped a
   * queue spread over ten shops. A backlog for ONE shop drained at one job
   * per 2-minute tick.
   *
   * Measured on production 2026-10-09, shop d595d90a after a
   * `replay_blocked_builds`: 27 `build_pack` jobs of ~8 s each, claimed at
   * 10:24:38, 10:26:38, 10:28:38 … exactly one per tick. The chained
   * `build_defence_package` for Order #23294 waited 54 minutes for ~30 s of
   * work, and the whole replay needed ~1 h 50 for ~15 minutes of work.
   *
   * So when a batch finishes with budget left, claim again. Still one job
   * per shop at a time: the previous job is `succeeded`/`failed` before the
   * next claim runs, and a job another invocation holds is `running` and
   * counted by the same SQL cap.
   *
   * A job this invocation already ran is not run twice. A failed job is
   * re-queued with a 30 s × attempts delay, which could come due inside this
   * window; ticks used to space attempts at least 2 minutes apart, and a
   * transient outage should not burn all three attempts in 90 seconds. It is
   * released untouched and the next tick takes it.
   *
   * Later rounds only start the short job types in `LATE_START_JOB_TYPES`;
   * anything else is released the same way. A released job keeps its place
   * at the head of its shop's queue, so that shop does no more work in this
   * invocation — the old one-job-per-tick rate, never worse.
   */
  const handled = new Set<string>();
  let claimedTotal = 0;
  let budgetSpent = false;
  let round = 0;

  while (!budgetSpent) {
    round += 1;
    const batch = await claimJobs(workerId, 10);
    const claimed: typeof batch = [];
    for (const job of batch) {
      if (handled.has(job.id) || (round > 1 && !LATE_START_JOB_TYPES.has(job.jobType))) {
        await releaseJob(job.id, workerId, job.attempts);
        results.push({ jobId: job.id, status: "released" });
      } else {
        claimed.push(job);
      }
    }
    if (claimed.length === 0) break;
    claimedTotal += claimed.length;

    for (const [index, job] of claimed.entries()) {
      if (index > 0 && Date.now() - startedAt > START_BUDGET_MS) {
        for (const rest of claimed.slice(index)) {
          await releaseJob(rest.id, workerId, rest.attempts);
          results.push({ jobId: rest.id, status: "released" });
        }
        budgetSpent = true;
        break;
      }
      handled.add(job.id);
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
            // Returns a JobResult so `shop_unavailable` is honoured as
            // non-retriable; discarding it would re-queue a deleted store daily.
            handlerResult = await handleSnapshotShopDailyMetrics(job);
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
          case "replay_blocked_builds":
            await handleReplayBlockedBuilds(job);
            break;
          case "collect_product_evidence":
            handlerResult = await handleCollectProductEvidence(job);
            break;
          case "materialize_insights_months":
            await handleMaterializeInsightsMonths(job);
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

    if (Date.now() - startedAt > START_BUDGET_MS) budgetSpent = true;
  }

  return NextResponse.json({
    claimed: claimedTotal,
    results,
  });
}

export async function POST(req: NextRequest) {
  return runWorker(req);
}

export async function GET(req: NextRequest) {
  return runWorker(req);
}
