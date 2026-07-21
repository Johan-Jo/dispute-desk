/**
 * Analysis-run lifecycle for the Intelligence Engine (design §19, §20).
 * Runs are versioned + reproducible; a duplicate-run guard prevents two
 * active runs per shop (mirrors the backfill enqueue guards).
 */

import { getServiceClient } from "@/lib/supabase/server";
import { assertShopId } from "./db/tenantScope";
import { runVersions } from "./config";
import type { AnalysisRunRow, RunStage, RunStatus, DataQualityReport } from "./types";

export interface CreateRunResult {
  runId: string | null;
  duplicate: boolean;
}

/**
 * Create a queued run unless one is already active for the shop. Returns
 * duplicate:true (runId null) when an active run exists.
 */
export async function createRun(
  shopId: string,
  triggeredBy: string,
): Promise<CreateRunResult> {
  assertShopId(shopId);
  const db = getServiceClient();

  const { data: active } = await db
    .from("intelligence_analysis_runs")
    .select("id")
    .eq("shop_id", shopId)
    .in("status", ["queued", "running"])
    .limit(1);
  if (active && active.length > 0) return { runId: null, duplicate: true };

  const versions = runVersions();
  const { data, error } = await db
    .from("intelligence_analysis_runs")
    .insert({
      shop_id: shopId,
      status: "queued",
      stage: "pending",
      triggered_by: triggeredBy,
      data_cutoff: new Date().toISOString(),
      feature_registry_version: versions.featureRegistryVersion,
      classification_version: versions.classificationVersion,
      methodology_version: versions.methodologyVersion,
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`[intelligence/runs] createRun failed: ${error?.message}`);
  return { runId: data.id, duplicate: false };
}

export async function markRunning(runId: string): Promise<void> {
  const db = getServiceClient();
  await db
    .from("intelligence_analysis_runs")
    .update({ status: "running", started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", runId);
}

export async function setStage(runId: string, stage: RunStage): Promise<void> {
  const db = getServiceClient();
  await db
    .from("intelligence_analysis_runs")
    .update({ stage, updated_at: new Date().toISOString() })
    .eq("id", runId);
}

export async function storeDataQuality(
  runId: string,
  report: DataQualityReport,
  sourceRowCounts: Record<string, number>,
): Promise<void> {
  const db = getServiceClient();
  await db
    .from("intelligence_analysis_runs")
    .update({
      data_quality: report,
      source_row_counts: sourceRowCounts,
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId);
}

export async function storeBaseline(runId: string, baseline: unknown): Promise<void> {
  const db = getServiceClient();
  await db
    .from("intelligence_analysis_runs")
    .update({ baseline, updated_at: new Date().toISOString() })
    .eq("id", runId);
}

export async function storeFeasibility(runId: string, feasibility: unknown): Promise<void> {
  const db = getServiceClient();
  await db
    .from("intelligence_analysis_runs")
    .update({ feasibility, updated_at: new Date().toISOString() })
    .eq("id", runId);
}

export async function storeModelReport(runId: string, modelReport: unknown): Promise<void> {
  const db = getServiceClient();
  await db
    .from("intelligence_analysis_runs")
    .update({ model_report: modelReport, updated_at: new Date().toISOString() })
    .eq("id", runId);
}

export async function finishRun(
  runId: string,
  status: Extract<RunStatus, "succeeded" | "failed">,
  errors: string[] = [],
): Promise<void> {
  const db = getServiceClient();
  await db
    .from("intelligence_analysis_runs")
    .update({
      status,
      stage: status === "succeeded" ? "complete" : undefined,
      completed_at: new Date().toISOString(),
      errors,
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId);
}

export async function getRun(runId: string): Promise<AnalysisRunRow | null> {
  const db = getServiceClient();
  const { data } = await db
    .from("intelligence_analysis_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  return (data as AnalysisRunRow) ?? null;
}

export async function listRuns(shopId: string, limit = 25): Promise<AnalysisRunRow[]> {
  assertShopId(shopId);
  const db = getServiceClient();
  const { data } = await db
    .from("intelligence_analysis_runs")
    .select("*")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as AnalysisRunRow[]) ?? [];
}
