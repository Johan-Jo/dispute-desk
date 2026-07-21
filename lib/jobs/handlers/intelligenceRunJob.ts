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
import { buildBaseline, type DisputeRecordRow } from "@/lib/intelligence/report/baseline";
import { detectOpportunities } from "@/lib/intelligence/opportunities/detect";
import { insertRecommendations } from "@/lib/intelligence/recommendations";
import { evaluateModelFeasibility } from "@/lib/intelligence/models/feasibility";
import { buildResponseWinModel } from "@/lib/intelligence/models/responseWin";
import { scopedSelectAll } from "@/lib/intelligence/db/tenantScope";
import { markRunning, setStage, storeDataQuality, storeBaseline, storeFeasibility, storeModelReport, finishRun } from "@/lib/intelligence/runs";

/**
 * Phase A: audit stage. Phase B: + baseline descriptive report + descriptive
 * opportunity detection. All stages run in one job (Blume Box is small — 454
 * disputes); Phase C+ heavier stages will chain via enqueueJob with the 240s
 * checkpoint pattern.
 */
export async function handleIntelligenceRun(job: ClaimedJob): Promise<JobResult> {
  const runId = job.entityId;
  if (!runId) {
    return { ok: false, reason: "intel_run missing run id (entity_id)", retriable: false };
  }

  try {
    await markRunning(runId);

    // Stage 1 — data-quality audit.
    await setStage(runId, "auditing");
    const dq = await assessDataQuality(job.shopId);
    await storeDataQuality(runId, dq, {
      orders: dq.facts.orders.count,
      disputes: dq.facts.disputes.count,
      evidence_items: dq.facts.evidence.item_count,
    });

    // Stage 2 — baseline descriptive report.
    await setStage(runId, "reporting");
    const rows = await scopedSelectAll<DisputeRecordRow>(
      "intel_dispute_records",
      job.shopId,
      "dispute_id,initiated_at,due_at,submitted_at,reason,phase,final_outcome,amount,currency_code,outcome_amount_recovered,is_adjudicated",
      "dispute_id",
    );
    const baseline = buildBaseline(rows);
    await storeBaseline(runId, baseline);

    // Stage 3 — descriptive opportunity detection.
    await setStage(runId, "recommending");
    const drafts = detectOpportunities(rows, baseline, dq);
    await insertRecommendations(runId, job.shopId, drafts);

    // Stage 4 — model-feasibility evaluation (Phase D, conditional).
    const feasibility = evaluateModelFeasibility(rows);
    await storeFeasibility(runId, feasibility);

    // Stage 5 — build the response-win model ONLY if it passed its gates.
    // Otherwise modeling is unsupported and descriptive outputs are retained.
    const responseFeasible = feasibility.verdicts.find((v) => v.model === "response_win_pooled")?.feasible;
    if (responseFeasible) {
      const modelReport = buildResponseWinModel(rows);
      await storeModelReport(runId, modelReport);
    }

    await finishRun(runId, "succeeded");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishRun(runId, "failed", [message]).catch(() => {});
    return { ok: false, reason: message, retriable: true };
  }
}
