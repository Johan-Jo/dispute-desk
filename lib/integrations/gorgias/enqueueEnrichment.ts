/**
 * enqueueGorgiasEnrichment — the single entry point for scheduling an
 * `enrich_gorgias_comms` job (dispute-opened dispatcher, manual refresh
 * route, ticket-confirm route).
 *
 * Idempotency at the enqueue boundary:
 *   1. Skip when the shop has no connected Gorgias integration (cheap
 *      status lookup — no secret decrypt here).
 *   2. Skip when a queued/running job already exists for the dispute.
 *   3. Create the run row HERE (status 'queued', trigger_source recorded
 *      at enqueue time — the jobs table has no payload column). The
 *      partial unique index on active runs is the race backstop: a
 *      concurrent enqueue loses the insert and reports already_active.
 *   4. Only then insert the job. If the job insert fails, the run row is
 *      cancelled so the active-run slot is not leaked.
 *
 * Callers treat every non-enqueued outcome as a silent skip — enrichment
 * must never block the dispute pipeline.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { enqueueJob } from "@/lib/jobs/claimJobs";
import { logSetupEvent } from "@/lib/setup/events";
import { ACTIVE_RUN_STATUSES } from "./enrichment";

export const GORGIAS_ENRICH_JOB_TYPE = "enrich_gorgias_comms";

export type EnrichmentTrigger =
  | "dispute_opened"
  | "manual"
  | "ticket_confirmed"
  | "retry";

export interface EnqueueEnrichmentResult {
  enqueued: boolean;
  reason?:
    | "not_connected"
    | "job_already_pending"
    | "run_already_active"
    | "enqueue_failed";
  runId?: string;
  jobId?: string;
}

export async function enqueueGorgiasEnrichment(params: {
  shopId: string;
  disputeId: string;
  trigger: EnrichmentTrigger;
}): Promise<EnqueueEnrichmentResult> {
  const sb = getServiceClient();

  const { data: integration } = await sb
    .from("integrations")
    .select("id, status")
    .eq("shop_id", params.shopId)
    .eq("type", "gorgias")
    .maybeSingle();
  if (!integration || integration.status !== "connected") {
    return { enqueued: false, reason: "not_connected" };
  }

  const { data: pendingJobs } = await sb
    .from("jobs")
    .select("id")
    .eq("shop_id", params.shopId)
    .eq("job_type", GORGIAS_ENRICH_JOB_TYPE)
    .eq("entity_id", params.disputeId)
    .in("status", ["queued", "running"])
    .limit(1);
  if (pendingJobs && pendingJobs.length > 0) {
    return { enqueued: false, reason: "job_already_pending" };
  }

  // run_number = max + 1 for this dispute+integration. A concurrent
  // enqueue computing the same number collides on either unique index
  // (run_number or the active-run partial) — both mean "already active".
  const { data: lastRun } = await sb
    .from("gorgias_enrichment_runs")
    .select("run_number")
    .eq("dispute_id", params.disputeId)
    .eq("integration_id", integration.id)
    .order("run_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const runNumber = ((lastRun?.run_number as number) ?? 0) + 1;

  const { data: run, error: runErr } = await sb
    .from("gorgias_enrichment_runs")
    .insert({
      shop_id: params.shopId,
      dispute_id: params.disputeId,
      integration_id: integration.id,
      run_number: runNumber,
      status: "queued",
      trigger_source: params.trigger,
    })
    .select("id")
    .single();

  if (runErr || !run) {
    if (runErr?.code === "23505") {
      return { enqueued: false, reason: "run_already_active" };
    }
    return { enqueued: false, reason: "enqueue_failed" };
  }

  let jobId: string;
  try {
    jobId = await enqueueJob({
      shopId: params.shopId,
      jobType: GORGIAS_ENRICH_JOB_TYPE,
      entityId: params.disputeId,
    });
  } catch {
    // Don't leak the active-run slot when the job insert failed.
    await sb
      .from("gorgias_enrichment_runs")
      .update({
        status: "cancelled",
        error_code: "job_enqueue_failed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id)
      .in("status", [...ACTIVE_RUN_STATUSES]);
    return { enqueued: false, reason: "enqueue_failed" };
  }

  await logSetupEvent(params.shopId, "gorgias_enrichment_queued", {
    disputeId: params.disputeId,
    runId: run.id,
    trigger: params.trigger,
  });

  return { enqueued: true, runId: run.id as string, jobId };
}
