/**
 * Job handler: intel_run
 *
 * Phase A pipeline = the data-quality audit stage only. The audit is a single
 * server-side RPC (one row back), so no checkpointing is needed yet; Phase B+
 * stages (prepare/baseline) will chain via enqueueJob and adopt the 240s
 * soft-budget checkpoint pattern. entity_id carries the run id.
 */

import type { ClaimedJob, JobResult } from "../claimJobs";
import { assessDataQuality } from "@/lib/intelligence/dataQuality/audit";
import { markRunning, setStage, storeDataQuality, finishRun } from "@/lib/intelligence/runs";

export async function handleIntelligenceRun(job: ClaimedJob): Promise<JobResult> {
  const runId = job.entityId;
  if (!runId) {
    return { ok: false, reason: "intel_run missing run id (entity_id)", retriable: false };
  }

  try {
    await markRunning(runId);
    await setStage(runId, "auditing");

    const report = await assessDataQuality(job.shopId);

    await storeDataQuality(runId, report, {
      orders: report.facts.orders.count,
      disputes: report.facts.disputes.count,
      evidence_items: report.facts.evidence.item_count,
    });

    await finishRun(runId, "succeeded");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishRun(runId, "failed", [message]).catch(() => {});
    // Data-quality audit failures are typically transient (DB) → retriable.
    return { ok: false, reason: message, retriable: true };
  }
}
