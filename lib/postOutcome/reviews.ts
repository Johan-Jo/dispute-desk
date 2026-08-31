/**
 * Review persistence (plan §11, §17, §23 step 9).
 *
 * Reviews are append-only. The current state of an analysis is DERIVED from the
 * latest review, never stored as a mutable column, so a reviewer who changes
 * their mind leaves both decisions in the record. Plan §17 makes this the
 * foundation for everything downstream — only reviewed findings may prioritise
 * product changes, calibrate case strength, or justify a learning action — and
 * an audit trail that can be overwritten cannot carry that weight.
 *
 * ── Why an unreviewed finding is not a fact ──
 *
 * Every finding the analyzer produces is a hypothesis until a human confirms it
 * (plan §17). The 49 actionable analyses in the current prod shadow run are 49
 * hypotheses, not 49 defects. This module is the gate between the two, which is
 * why it refuses a review from anyone without an active internal admin grant
 * rather than trusting the caller to have checked.
 */

import { getServiceClient } from "@/lib/supabase/server";
import {
  isConfidenceLevel,
  isFindingCategory,
  isReviewDisposition,
  type ConfidenceLevel,
  type FindingCategory,
  type ReviewDisposition,
  type ReviewState,
} from "./taxonomy";

export interface ReviewInput {
  analysisId: string;
  reviewerUserId: string;
  disposition: ReviewDisposition;
  categoryOverride?: FindingCategory | null;
  confidenceOverride?: ConfidenceLevel | null;
  notes?: string | null;
}

export interface ReviewRecord {
  id: string;
  analysisId: string;
  reviewerUserId: string;
  disposition: ReviewDisposition;
  categoryOverride: FindingCategory | null;
  confidenceOverride: ConfidenceLevel | null;
  notes: string | null;
  createdAt: string;
}

/**
 * The reviewed state of an analysis, plus how it got there.
 *
 * `effectiveCategory` is what the admin table shows: the reviewer's correction
 * when they made one, the analyzer's category otherwise. Keeping both means a
 * confirmation rate can be measured per category later (plan §21) without
 * having lost what the analyzer originally said.
 */
export interface DerivedReviewState {
  state: ReviewState;
  latest: ReviewRecord | null;
  reviewCount: number;
  effectiveCategory: FindingCategory | null;
  effectiveConfidence: ConfidenceLevel | null;
}

export class ReviewAuthorizationError extends Error {
  constructor(userId: string) {
    super(`User ${userId} does not hold an active internal admin grant.`);
    this.name = "ReviewAuthorizationError";
  }
}

export class ReviewValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewValidationError";
  }
}

/**
 * Authorisation is checked HERE, not left to the calling route.
 *
 * A review is the act that turns a hypothesis into something allowed to drive a
 * rule change, so the check belongs next to the write. A route that forgets to
 * call `hasAdminSession` would otherwise write an unauthorised confirmation
 * that looks identical to a real one afterwards.
 */
export async function assertReviewer(userId: string): Promise<void> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("internal_admin_grants")
    .select("user_id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (!data) throw new ReviewAuthorizationError(userId);
}

function validate(input: ReviewInput): void {
  if (!isReviewDisposition(input.disposition)) {
    throw new ReviewValidationError(`Unknown disposition ${input.disposition}`);
  }
  // An edit or rejection without a stated reason is not reviewable evidence —
  // a later reader cannot tell a considered correction from a mis-click. The
  // DB enforces this too; failing here gives a usable message instead of a
  // constraint violation.
  if (
    (input.disposition === "EDITED" || input.disposition === "REJECTED") &&
    !input.notes?.trim()
  ) {
    throw new ReviewValidationError(
      `A ${input.disposition} review requires a note explaining it.`,
    );
  }
  if (input.categoryOverride && !isFindingCategory(input.categoryOverride)) {
    throw new ReviewValidationError(
      `Unknown category override ${input.categoryOverride}`,
    );
  }
  if (input.confidenceOverride && !isConfidenceLevel(input.confidenceOverride)) {
    throw new ReviewValidationError(
      `Unknown confidence override ${input.confidenceOverride}`,
    );
  }
  // An override only means something on an EDITED review. Accepting one on a
  // CONFIRMED review would silently change the record while claiming the
  // analyzer got it right.
  if (
    input.disposition !== "EDITED" &&
    (input.categoryOverride || input.confidenceOverride)
  ) {
    throw new ReviewValidationError(
      "Category and confidence overrides are only valid on an EDITED review.",
    );
  }
}

export async function appendReview(input: ReviewInput): Promise<ReviewRecord> {
  validate(input);
  await assertReviewer(input.reviewerUserId);

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("post_outcome_analysis_reviews")
    .insert({
      analysis_id: input.analysisId,
      reviewer_user_id: input.reviewerUserId,
      disposition: input.disposition,
      category_override: input.categoryOverride ?? null,
      confidence_override: input.confidenceOverride ?? null,
      notes: input.notes ?? null,
    })
    .select("id, analysis_id, reviewer_user_id, disposition, category_override, confidence_override, notes, created_at")
    .single();

  if (error || !data) {
    throw new Error(`Review insert failed: ${error?.message ?? "unknown"}`);
  }
  return toRecord(data as RawReviewRow);
}

interface RawReviewRow {
  id: string;
  analysis_id: string;
  reviewer_user_id: string;
  disposition: string;
  category_override: string | null;
  confidence_override: string | null;
  notes: string | null;
  created_at: string;
}

function toRecord(row: RawReviewRow): ReviewRecord {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    reviewerUserId: row.reviewer_user_id,
    disposition: row.disposition as ReviewDisposition,
    categoryOverride: (row.category_override as FindingCategory | null) ?? null,
    confidenceOverride: (row.confidence_override as ConfidenceLevel | null) ?? null,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

/**
 * Derive the current review state from the append-only history.
 *
 * Pure, so the precedence rules are testable without a database.
 */
export function deriveReviewState(
  reviews: readonly ReviewRecord[],
  analyzerCategory: FindingCategory | null,
  analyzerConfidence: ConfidenceLevel | null,
): DerivedReviewState {
  if (reviews.length === 0) {
    return {
      state: "PENDING_REVIEW",
      latest: null,
      reviewCount: 0,
      effectiveCategory: analyzerCategory,
      effectiveConfidence: analyzerConfidence,
    };
  }

  // Ties broken by id, deterministically.
  //
  // Postgres `now()` is transaction time, so two reviews written in one
  // transaction share a timestamp exactly. Real reviews arrive in separate
  // requests and never tie, but a tie must not make "current state" flap
  // between reads — an audit surface that shows a different answer each
  // refresh is worse than one that picks a stable arbitrary winner.
  const ordered = [...reviews].sort((a, b) => {
    const byTime = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });
  const latest = ordered[ordered.length - 1];

  return {
    state: latest.disposition,
    latest,
    reviewCount: ordered.length,
    // Only the LATEST review's overrides apply. An earlier edit that a later
    // review superseded must not leak back into the effective values.
    effectiveCategory: latest.categoryOverride ?? analyzerCategory,
    effectiveConfidence: latest.confidenceOverride ?? analyzerConfidence,
  };
}

export async function getReviewState(
  analysisId: string,
  analyzerCategory: FindingCategory | null,
  analyzerConfidence: ConfidenceLevel | null,
): Promise<DerivedReviewState> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("post_outcome_analysis_reviews")
    .select("id, analysis_id, reviewer_user_id, disposition, category_override, confidence_override, notes, created_at")
    .eq("analysis_id", analysisId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .returns<RawReviewRow[]>();

  return deriveReviewState(
    (data ?? []).map(toRecord),
    analyzerCategory,
    analyzerConfidence,
  );
}
