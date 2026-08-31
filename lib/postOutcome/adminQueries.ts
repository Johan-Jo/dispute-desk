/**
 * Read model for /admin/outcome-analysis (plan §15, §16, §23 step 12).
 *
 * ── Every metric names its denominator ──
 *
 * Plan §15.2: outcome percentages use decided disputes; finding percentages use
 * eligible ANALYSED disputes; neither may quietly use all orders. Those are
 * three different denominators and the difference is not cosmetic — the same
 * numerator over the wrong one turns "24 of 50 analysed cases" into a number
 * that looks like a chargeback rate. So the summary returns counts, and the
 * only rates it computes carry their denominator alongside.
 *
 * ── Scoped to chargebacks by default ──
 *
 * Plan §15.2 forbids silently combining inquiries and chargebacks. The filter
 * defaults to `chargeback` rather than "all", so the page cannot show a blended
 * figure unless someone explicitly asks for one.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { deriveReviewState, type ReviewRecord } from "./reviews";
import type {
  AnalysisLevel,
  AnalysisStatus,
  ConfidenceLevel,
  FindingCategory,
  ReviewState,
} from "./taxonomy";

export interface OutcomeAnalysisFilters {
  /** Default 90 days (plan §15.2). */
  since?: string;
  until?: string;
  shopId?: string | null;
  phase?: string | null;
  outcome?: "won" | "lost" | null;
  reason?: string | null;
  paymentProvider?: string | null;
  providerAccessLevel?: string | null;
  analysisLevel?: AnalysisLevel | null;
  primaryCategory?: FindingCategory | null;
  confidence?: ConfidenceLevel | null;
  actionable?: boolean | null;
  reviewState?: ReviewState | null;
  analyzerVersion?: number | null;
  limit?: number;
  offset?: number;
}

export interface OutcomeAnalysisRow {
  id: string;
  disputeId: string;
  shopId: string;
  shopDomain: string | null;
  orderName: string | null;
  outcome: "won" | "lost";
  finalizedAt: string | null;
  amount: string | null;
  currency: string | null;
  paymentProvider: string;
  providerAccessLevel: string;
  submissionConfirmationSource: string;
  platformSaveConfirmation: boolean;
  reason: string | null;
  networkReasonCode: string | null;
  analysisLevel: AnalysisLevel;
  analysisStatus: AnalysisStatus;
  reasonSpecificStatus: string;
  dataIntegrityLimitation: boolean;
  primaryCategory: FindingCategory | null;
  primaryConfidence: ConfidenceLevel | null;
  actionable: boolean;
  analyzerVersion: number;
  reviewState: ReviewState;
  reviewCount: number;
  effectiveCategory: FindingCategory | null;
}

/**
 * Summary counts. Deliberately NOT a bag of percentages.
 *
 * Every consumer needs the denominator to render honestly, and returning a
 * pre-computed rate is how a denominator gets lost between the query and the
 * card.
 */
export interface OutcomeAnalysisSummary {
  /** Denominator for outcome rates. */
  decidedAnalysed: number;
  won: number;
  lost: number;
  /** Denominator for finding rates. */
  eligibleAnalysed: number;
  fullPostOutcome: number;
  packageIntegrityOnly: number;
  outcomeMetadataOnly: number;
  dataIntegrityLimitations: number;
  actionable: number;
  pendingReview: number;
  byPrimaryCategory: Record<string, number>;
  bySubmissionConfirmation: Record<string, number>;
  /** Analyses whose level permits an evidence-effectiveness conclusion. */
  evidenceEffectivenessEligible: number;
}

const DEFAULT_WINDOW_DAYS = 90;

export function defaultSince(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - DEFAULT_WINDOW_DAYS);
  return d.toISOString();
}

interface RawAnalysisRow {
  id: string;
  dispute_id: string;
  shop_id: string;
  final_outcome_snapshot: "won" | "lost";
  finalized_at_snapshot: string | null;
  payment_provider_snapshot: string;
  provider_access_level_snapshot: string;
  submission_confirmation_source: string;
  platform_save_confirmation: boolean;
  reason_snapshot: string | null;
  network_reason_code_snapshot: string | null;
  analysis_level: AnalysisLevel;
  analysis_status: AnalysisStatus;
  reason_specific_status: string;
  data_integrity_limitation: boolean;
  primary_category: FindingCategory | null;
  primary_confidence: ConfidenceLevel | null;
  actionable: boolean;
  analyzer_version: number;
  disputes?: { order_name: string | null; amount: string | null; currency_code: string | null; phase: string | null } | null;
  shops?: { shop_domain: string | null } | null;
}

const SELECT = `
  id, dispute_id, shop_id, final_outcome_snapshot, finalized_at_snapshot,
  payment_provider_snapshot, provider_access_level_snapshot,
  submission_confirmation_source, platform_save_confirmation,
  reason_snapshot, network_reason_code_snapshot, analysis_level, analysis_status,
  reason_specific_status, data_integrity_limitation, primary_category,
  primary_confidence, actionable, analyzer_version,
  disputes!inner ( order_name, amount, currency_code, phase ),
  shops ( shop_domain )
`;

/**
 * The chainable subset of the Supabase builder this module uses.
 *
 * Declared structurally so the filter helper is typed rather than `any` —
 * an `any` here silently disables checking on every `.eq()` column name below,
 * which is where a typo becomes a filter that matches nothing and a page that
 * looks merely empty.
 */
interface FilterableQuery<T> {
  gte(column: string, value: string): T;
  lte(column: string, value: string): T;
  eq(column: string, value: string | number | boolean): T;
  neq(column: string, value: string): T;
}

function applyFilters<T extends FilterableQuery<T>>(
  query: T,
  filters: OutcomeAnalysisFilters,
): T {
  let q: T = query
    .gte("finalized_at_snapshot", filters.since ?? defaultSince())
    // Superseded analyses stay in the table for audit but are not the current
    // answer; showing them would double-count a dispute (plan §13).
    .neq("analysis_status", "SUPERSEDED");

  if (filters.until) q = q.lte("finalized_at_snapshot", filters.until);
  if (filters.shopId) q = q.eq("shop_id", filters.shopId);
  if (filters.outcome) q = q.eq("final_outcome_snapshot", filters.outcome);
  if (filters.reason) q = q.eq("reason_snapshot", filters.reason);
  if (filters.paymentProvider) q = q.eq("payment_provider_snapshot", filters.paymentProvider);
  if (filters.providerAccessLevel) {
    q = q.eq("provider_access_level_snapshot", filters.providerAccessLevel);
  }
  if (filters.analysisLevel) q = q.eq("analysis_level", filters.analysisLevel);
  if (filters.primaryCategory) q = q.eq("primary_category", filters.primaryCategory);
  if (filters.confidence) q = q.eq("primary_confidence", filters.confidence);
  if (filters.actionable != null) q = q.eq("actionable", filters.actionable);
  if (filters.analyzerVersion != null) q = q.eq("analyzer_version", filters.analyzerVersion);
  // Chargeback by default; "all" requires passing phase explicitly as null.
  if (filters.phase !== null) q = q.eq("disputes.phase", filters.phase ?? "chargeback");
  return q;
}

export async function listOutcomeAnalyses(
  filters: OutcomeAnalysisFilters = {},
): Promise<{ rows: OutcomeAnalysisRow[]; total: number }> {
  const sb = getServiceClient();
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const base = sb.from("post_outcome_analyses").select(SELECT, { count: "exact" });
  const { data, count } = await applyFilters(base, filters)
    .order("finalized_at_snapshot", { ascending: false })
    .range(offset, offset + limit - 1)
    .returns<RawAnalysisRow[]>();

  const rows = data ?? [];
  if (rows.length === 0) return { rows: [], total: count ?? 0 };

  // Review state is derived from the append-only history, so it is fetched
  // alongside rather than denormalised onto the analysis.
  const { data: reviewRows } = await sb
    .from("post_outcome_analysis_reviews")
    .select("id, analysis_id, reviewer_user_id, disposition, category_override, confidence_override, notes, created_at")
    .in("analysis_id", rows.map((r) => r.id))
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

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
    const list = byAnalysis.get(rec.analysisId) ?? [];
    list.push(rec);
    byAnalysis.set(rec.analysisId, list);
  }

  const mapped = rows
    .map((r) => {
      const derived = deriveReviewState(
        byAnalysis.get(r.id) ?? [],
        r.primary_category,
        r.primary_confidence,
      );
      return {
        id: r.id,
        disputeId: r.dispute_id,
        shopId: r.shop_id,
        shopDomain: r.shops?.shop_domain ?? null,
        orderName: r.disputes?.order_name ?? null,
        outcome: r.final_outcome_snapshot,
        finalizedAt: r.finalized_at_snapshot,
        amount: r.disputes?.amount ?? null,
        currency: r.disputes?.currency_code ?? null,
        paymentProvider: r.payment_provider_snapshot,
        providerAccessLevel: r.provider_access_level_snapshot,
        submissionConfirmationSource: r.submission_confirmation_source,
        platformSaveConfirmation: r.platform_save_confirmation,
        reason: r.reason_snapshot,
        networkReasonCode: r.network_reason_code_snapshot,
        analysisLevel: r.analysis_level,
        analysisStatus: r.analysis_status,
        reasonSpecificStatus: r.reason_specific_status,
        dataIntegrityLimitation: r.data_integrity_limitation,
        primaryCategory: r.primary_category,
        primaryConfidence: r.primary_confidence,
        actionable: r.actionable,
        analyzerVersion: r.analyzer_version,
        reviewState: derived.state,
        reviewCount: derived.reviewCount,
        effectiveCategory: derived.effectiveCategory,
      } satisfies OutcomeAnalysisRow;
    })
    .filter((r) => (filters.reviewState ? r.reviewState === filters.reviewState : true));

  return { rows: mapped, total: count ?? mapped.length };
}

/**
 * Summary over the SAME filtered population as the table (plan §16).
 *
 * Computed from the filtered rows rather than a separate unfiltered query, so
 * a card can never disagree with the table beneath it.
 */
export function summarise(rows: readonly OutcomeAnalysisRow[]): OutcomeAnalysisSummary {
  const byPrimaryCategory: Record<string, number> = {};
  const bySubmissionConfirmation: Record<string, number> = {};
  for (const r of rows) {
    if (r.effectiveCategory) {
      byPrimaryCategory[r.effectiveCategory] = (byPrimaryCategory[r.effectiveCategory] ?? 0) + 1;
    }
    bySubmissionConfirmation[r.submissionConfirmationSource] =
      (bySubmissionConfirmation[r.submissionConfirmationSource] ?? 0) + 1;
  }

  return {
    decidedAnalysed: rows.length,
    won: rows.filter((r) => r.outcome === "won").length,
    lost: rows.filter((r) => r.outcome === "lost").length,
    eligibleAnalysed: rows.filter((r) => r.analysisStatus === "COMPLETED").length,
    fullPostOutcome: rows.filter((r) => r.analysisLevel === "FULL_POST_OUTCOME").length,
    packageIntegrityOnly: rows.filter((r) => r.analysisLevel === "PACKAGE_INTEGRITY_ONLY").length,
    outcomeMetadataOnly: rows.filter((r) => r.analysisLevel === "OUTCOME_METADATA_ONLY").length,
    dataIntegrityLimitations: rows.filter((r) => r.dataIntegrityLimitation).length,
    actionable: rows.filter((r) => r.actionable).length,
    pendingReview: rows.filter((r) => r.reviewState === "PENDING_REVIEW").length,
    byPrimaryCategory,
    bySubmissionConfirmation,
    evidenceEffectivenessEligible: rows.filter(
      (r) => r.analysisLevel === "FULL_POST_OUTCOME",
    ).length,
  };
}

/**
 * Default table ordering (plan §15.4): unreviewed high-confidence actionable
 * findings first, then failures and integrity blocks, then the rest by date.
 *
 * The ordering encodes what the page is FOR. Sorting by date alone would bury
 * the one DEFINITE omission under 47 routine analyses.
 */
const CONFIDENCE_RANK: Record<string, number> = {
  DEFINITE: 0,
  HIGH: 1,
  MODERATE: 2,
  LOW: 3,
};

export function orderForReview(rows: readonly OutcomeAnalysisRow[]): OutcomeAnalysisRow[] {
  return [...rows].sort((a, b) => {
    const aPriority = a.reviewState === "PENDING_REVIEW" && a.actionable ? 0 : 1;
    const bPriority = b.reviewState === "PENDING_REVIEW" && b.actionable ? 0 : 1;
    if (aPriority !== bPriority) return aPriority - bPriority;

    if (aPriority === 0) {
      const byConfidence =
        (CONFIDENCE_RANK[a.primaryConfidence ?? "LOW"] ?? 3) -
        (CONFIDENCE_RANK[b.primaryConfidence ?? "LOW"] ?? 3);
      if (byConfidence !== 0) return byConfidence;
    }

    const aBlocked = a.analysisStatus !== "COMPLETED" || a.dataIntegrityLimitation ? 0 : 1;
    const bBlocked = b.analysisStatus !== "COMPLETED" || b.dataIntegrityLimitation ? 0 : 1;
    if (aBlocked !== bBlocked) return aBlocked - bBlocked;

    return (b.finalizedAt ?? "").localeCompare(a.finalizedAt ?? "");
  });
}
