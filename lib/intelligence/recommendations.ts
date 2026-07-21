/**
 * Recommendation + decision-log persistence (design §11, §23). Reached via the
 * service-role client; always shop_id-scoped. Recommendations are never
 * silently replaced — a new run writes new rows.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { assertShopId } from "./db/tenantScope";
import type { RecommendationRow } from "./types";
import type { RecommendationDraft } from "./opportunities/detect";

export async function insertRecommendations(
  runId: string,
  shopId: string,
  drafts: RecommendationDraft[],
): Promise<number> {
  assertShopId(shopId);
  if (drafts.length === 0) return 0;
  const db = getServiceClient();
  const rows = drafts.map((d) => ({
    analysis_run_id: runId,
    shop_id: shopId,
    category: d.category,
    title: d.title,
    summary: d.summary,
    suggested_action: d.suggestedAction,
    affected_order_count: d.affectedOrderCount,
    affected_dispute_count: d.affectedDisputeCount,
    affected_disputed_minor: d.affectedDisputedMinor,
    currency: d.currency,
    baseline_metric: d.baselineMetric,
    estimate_lower_minor: d.estimateLowerMinor,
    estimate_point_minor: d.estimatePointMinor,
    estimate_upper_minor: d.estimateUpperMinor,
    estimate_period: d.estimatePeriod,
    evidence_grade: d.evidenceGrade,
    confidence: d.confidence,
    confidence_kind: d.confidenceKind,
    implementation_effort: d.implementationEffort,
    customer_friction_risk: d.customerFrictionRisk,
    limitations: d.limitations,
    assumptions: d.assumptions,
    required_data_quality_checks: d.requiredDataQualityChecks,
    supporting_segment_ids: d.supportingSegmentIds,
  }));
  const { error } = await db.from("intelligence_recommendations").insert(rows);
  if (error) throw new Error(`[intelligence/recommendations] insert failed: ${error.message}`);
  return rows.length;
}

export async function listRecommendations(
  runId: string,
  shopId: string,
): Promise<RecommendationRow[]> {
  assertShopId(shopId);
  const db = getServiceClient();
  const { data } = await db
    .from("intelligence_recommendations")
    .select("*")
    .eq("shop_id", shopId)
    .eq("analysis_run_id", runId)
    .order("created_at", { ascending: true });
  return (data as RecommendationRow[]) ?? [];
}

export async function logDecision(params: {
  shopId: string;
  recommendationId?: string;
  analysisRunId?: string;
  actor: string;
  action: "shown" | "accepted" | "rejected" | "marked_later" | "modified" | "activated" | "overridden";
  reason?: string;
  methodologyVersion?: string;
}): Promise<void> {
  assertShopId(params.shopId);
  const db = getServiceClient();
  const { error } = await db.from("intelligence_decision_log").insert({
    shop_id: params.shopId,
    recommendation_id: params.recommendationId ?? null,
    analysis_run_id: params.analysisRunId ?? null,
    actor: params.actor,
    action: params.action,
    reason: params.reason ?? null,
    methodology_version: params.methodologyVersion ?? null,
  });
  if (error) throw new Error(`[intelligence/recommendations] logDecision failed: ${error.message}`);
}
