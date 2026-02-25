import { NextRequest, NextResponse } from "next/server";
import { claimJobs, markJobSucceeded, markJobFailed } from "@/lib/jobs/claimJobs";
import { handleBuildPack } from "@/lib/jobs/handlers/buildPackJob";
import { handleRenderPdf } from "@/lib/jobs/handlers/renderPdfJob";
import { handleSyncDisputes } from "@/lib/jobs/handlers/syncDisputesJob";
import { handleSaveToShopify } from "@/lib/jobs/handlers/saveToShopifyJob";

export const runtime = "nodejs";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * POST /api/jobs/worker
 *
 * Called by Vercel Cron (or external scheduler) every 1-5 minutes.
 * Requires CRON_SECRET header for authentication.
 * Claims queued jobs and executes handlers.
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret") ?? req.headers.get("authorization")?.replace("Bearer ", "");
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workerId = `worker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const claimed = await claimJobs(workerId, 5);

  const results: Array<{ jobId: string; status: string; error?: string }> = [];

  for (const job of claimed) {
    try {
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
          await handleSaveToShopify(job);
          break;
        default:
          throw new Error(`Unknown job type: ${job.jobType}`);
      }
      await markJobSucceeded(job.id);
      results.push({ jobId: job.id, status: "succeeded" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markJobFailed(job.id, message, job.attempts, job.maxAttempts);
      results.push({ jobId: job.id, status: "failed", error: message });
    }
  }

  return NextResponse.json({
    claimed: claimed.length,
    results,
  });
}
