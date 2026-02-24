import { getServiceClient } from "../supabase/server";

const MAX_CONCURRENT_PER_SHOP = 1;

export interface ClaimedJob {
  id: string;
  shopId: string;
  jobType: string;
  entityId: string | null;
  attempts: number;
  maxAttempts: number;
}

/**
 * Claim up to `limit` queued jobs using SELECT ... FOR UPDATE SKIP LOCKED.
 * Enforces per-shop concurrency cap (V1: 1 running job per shop).
 *
 * Uses raw SQL via Supabase rpc to get skip-locked semantics.
 */
export async function claimJobs(
  workerId: string,
  limit: number = 5
): Promise<ClaimedJob[]> {
  const db = getServiceClient();

  const { data, error } = await db.rpc("claim_jobs", {
    p_worker_id: workerId,
    p_limit: limit,
    p_max_concurrent: MAX_CONCURRENT_PER_SHOP,
  });

  if (error) {
    console.error("[jobs] claim_jobs rpc failed:", error.message);
    return [];
  }

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    shopId: row.shop_id as string,
    jobType: row.job_type as string,
    entityId: (row.entity_id as string) ?? null,
    attempts: row.attempts as number,
    maxAttempts: row.max_attempts as number,
  }));
}

/**
 * Mark a job as succeeded.
 */
export async function markJobSucceeded(jobId: string): Promise<void> {
  const db = getServiceClient();
  await db
    .from("jobs")
    .update({ status: "succeeded", updated_at: new Date().toISOString() })
    .eq("id", jobId);
}

/**
 * Mark a job as failed. If attempts < max_attempts, re-queue it.
 */
export async function markJobFailed(
  jobId: string,
  error: string,
  attempts: number,
  maxAttempts: number
): Promise<void> {
  const db = getServiceClient();
  const shouldRetry = attempts < maxAttempts;

  await db
    .from("jobs")
    .update({
      status: shouldRetry ? "queued" : "failed",
      last_error: error,
      locked_at: null,
      locked_by: null,
      run_at: shouldRetry
        ? new Date(Date.now() + attempts * 30_000).toISOString()
        : undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

/**
 * Enqueue a new job. Returns the job ID.
 */
export async function enqueueJob(params: {
  shopId: string;
  jobType: string;
  entityId?: string;
  priority?: number;
}): Promise<string> {
  const db = getServiceClient();

  const { data, error } = await db
    .from("jobs")
    .insert({
      shop_id: params.shopId,
      job_type: params.jobType,
      entity_id: params.entityId ?? null,
      priority: params.priority ?? 100,
      status: "queued",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to enqueue job: ${error?.message}`);
  }
  return data.id;
}
