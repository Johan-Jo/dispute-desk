/**
 * GET /api/admin/outcome-analysis/summary?shop_id=…&dispute_id=…
 *
 * Compact post-outcome context for the merchant admin page (plan §14.2) and the
 * internal dispute detail (plan §14.3).
 *
 * Both callers get counts and, for a single dispute, its analysis header. They
 * deliberately do NOT get a duplicate of the findings table: plan §14.2 is
 * explicit that the shop page must not become a second Outcome Analysis
 * surface, and two tables of the same data drift the moment one is changed.
 * Each response carries the link to the real page instead.
 */

import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { getServiceClient } from "@/lib/supabase/server";
import { defaultSince } from "@/lib/postOutcome/adminQueries";
import { deriveReviewState, type ReviewRecord } from "@/lib/postOutcome/reviews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Row {
  id: string;
  dispute_id: string;
  final_outcome_snapshot: "won" | "lost";
  analysis_level: string;
  analysis_status: string;
  reason_specific_status: string;
  data_integrity_limitation: boolean;
  primary_category: string | null;
  primary_confidence: string | null;
  submission_confirmation_source: string;
  actionable: boolean;
  analyzer_version: number;
  finalized_at_snapshot: string | null;
}

const SELECT =
  "id, dispute_id, final_outcome_snapshot, analysis_level, analysis_status, reason_specific_status, data_integrity_limitation, primary_category, primary_confidence, submission_confirmation_source, actionable, analyzer_version, finalized_at_snapshot";

export async function GET(request: Request) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const shopId = url.searchParams.get("shop_id");
  const disputeId = url.searchParams.get("dispute_id");
  if (!shopId && !disputeId) {
    return NextResponse.json(
      { error: "shop_id or dispute_id is required" },
      { status: 400 },
    );
  }

  const sb = getServiceClient();
  let query = sb
    .from("post_outcome_analyses")
    .select(SELECT)
    .neq("analysis_status", "SUPERSEDED");

  if (disputeId) {
    query = query.eq("dispute_id", disputeId);
  } else {
    query = query
      .eq("shop_id", shopId as string)
      .gte("finalized_at_snapshot", url.searchParams.get("since") ?? defaultSince());
  }

  const { data } = await query
    .order("finalized_at_snapshot", { ascending: false })
    .returns<Row[]>();
  const rows = data ?? [];

  // Review state is derived from the append-only history, never denormalised.
  const { data: reviewRows } = rows.length
    ? await sb
        .from("post_outcome_analysis_reviews")
        .select(
          "id, analysis_id, reviewer_user_id, disposition, category_override, confidence_override, notes, created_at",
        )
        .in("analysis_id", rows.map((r) => r.id))
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
    : { data: [] };

  const byAnalysis = new Map<string, ReviewRecord[]>();
  for (const raw of reviewRows ?? []) {
    const rec: ReviewRecord = {
      id: raw.id,
      analysisId: raw.analysis_id,
      reviewerUserId: raw.reviewer_user_id,
      disposition: raw.disposition,
      categoryOverride: raw.category_override,
      confidenceOverride: raw.confidence_override,
      notes: raw.notes,
      createdAt: raw.created_at,
    };
    byAnalysis.set(rec.analysisId, [...(byAnalysis.get(rec.analysisId) ?? []), rec]);
  }

  const enriched = rows.map((r) => {
    const derived = deriveReviewState(
      byAnalysis.get(r.id) ?? [],
      r.primary_category as never,
      r.primary_confidence as never,
    );
    return {
      analysisId: r.id,
      disputeId: r.dispute_id,
      outcome: r.final_outcome_snapshot,
      finalizedAt: r.finalized_at_snapshot,
      analysisLevel: r.analysis_level,
      analysisStatus: r.analysis_status,
      reasonSpecificStatus: r.reason_specific_status,
      dataIntegrityLimitation: r.data_integrity_limitation,
      submissionConfirmationSource: r.submission_confirmation_source,
      actionable: r.actionable,
      analyzerVersion: r.analyzer_version,
      reviewState: derived.state,
      // The reviewer's correction when there is one; the analyzer's otherwise.
      category: derived.effectiveCategory,
      confidence: derived.effectiveConfidence,
    };
  });

  // Only REVIEWED findings are counted as confirmed gaps (plan §17). An
  // unreviewed finding is a hypothesis, and a card labelled "confirmed" that
  // counts hypotheses is the whole failure mode this feature guards against.
  const confirmed = enriched.filter((e) => e.reviewState === "CONFIRMED");
  const confirmedByCategory: Record<string, number> = {};
  for (const c of confirmed) {
    if (c.category) {
      confirmedByCategory[c.category] = (confirmedByCategory[c.category] ?? 0) + 1;
    }
  }

  return NextResponse.json({
    analyses: enriched,
    counts: {
      analysed: enriched.length,
      won: enriched.filter((e) => e.outcome === "won").length,
      lost: enriched.filter((e) => e.outcome === "lost").length,
      fullAnalysis: enriched.filter((e) => e.analysisLevel === "FULL_POST_OUTCOME").length,
      blocked: enriched.filter(
        (e) => e.analysisStatus !== "COMPLETED" || e.dataIntegrityLimitation,
      ).length,
      actionable: enriched.filter((e) => e.actionable).length,
      pendingReview: enriched.filter((e) => e.reviewState === "PENDING_REVIEW").length,
      confirmed: confirmed.length,
    },
    confirmedByCategory,
  });
}
