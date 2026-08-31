/**
 * Persisting a composed analysis (plan §13, §23 step 9).
 *
 * ── Idempotency is the whole contract ──
 *
 * The unique key is `(dispute_id, analyzer_version, source_snapshot_sha256)`.
 * That single index gives the four behaviours plan §13 requires, without any
 * bookkeeping in application code:
 *
 *   a retry of the same build ......... conflicts, returns the existing row
 *   a new analyzer version ............ different key, new row, old preserved
 *   a repaired source snapshot ........ hash moves, new row, old preserved
 *   an unchanged re-run ............... conflicts, no duplicate
 *
 * So this module never UPDATEs an analysis. A completed analysis is immutable
 * (plan §13); the only mutation any later event performs is marking a row
 * superseded, which is an insert of the replacement plus one pointer.
 *
 * ── Why findings are written in the same transaction-ish unit ──
 *
 * An analysis row with no findings and an analysis row whose findings failed to
 * insert look identical afterwards, and the second is a silent lie: the admin
 * page would read "no material gap observed" from a case that had six. Findings
 * are therefore inserted immediately after the parent, and a failure there
 * deletes the parent rather than leaving it half-written. Supabase gives us no
 * client-side transaction, so this compensating delete is the honest
 * approximation — and it is safe precisely because the parent is worthless
 * without its children.
 */

import { getServiceClient } from "@/lib/supabase/server";
import type { ComposedAnalysis } from "./composeAnalysis";
import type { PostOutcomeSourceSnapshot } from "./snapshotContract";

export interface PersistResult {
  analysisId: string;
  /** True when an identical analysis already existed and nothing was written. */
  alreadyExisted: boolean;
  findingsWritten: number;
}

function analysisRow(
  analysis: ComposedAnalysis,
  snapshot: PostOutcomeSourceSnapshot,
  snapshotUri: string | null,
) {
  return {
    shop_id: analysis.shopId,
    dispute_id: analysis.disputeId,

    payment_provider_snapshot: snapshot.provider.paymentProvider,
    provider_account_ref_snapshot: snapshot.provider.providerAccountRef,
    provider_access_level_snapshot: snapshot.provider.accessLevel,
    provider_capabilities_snapshot: snapshot.provider.capabilities,

    // Storage confirmation and forwarding provenance stay separate columns.
    // The DB check constraint refuses FULL_POST_OUTCOME without real
    // forwarding, so a regression here fails loudly rather than silently.
    platform_save_confirmation: snapshot.lifecycle.platformSaveVerified,
    submission_confirmation_source: snapshot.provider.submissionConfirmationSource,
    package_evidence_tie: snapshot.provider.packageEvidenceTie,

    analyzer_version: analysis.analyzerVersion,
    source_snapshot_uri: snapshotUri,
    source_snapshot_sha256: analysis.snapshotHash,

    submitted_package_id: snapshot.submittedPackage?.packageId ?? null,
    submitted_package_sha256: snapshot.submittedPackage?.pdfSha256 ?? null,
    submission_state_snapshot: snapshot.lifecycle.submissionState,
    submitted_at_snapshot: snapshot.lifecycle.submittedAt,

    final_outcome_snapshot: snapshot.outcome.finalOutcome,
    finalized_at_snapshot: snapshot.outcome.finalizedAt,
    reason_snapshot: snapshot.dispute.reason,
    network_reason_code_snapshot: snapshot.dispute.networkReasonCode,
    network_snapshot: snapshot.provider.cardNetwork,

    merchant_niche_snapshot: null,
    merchant_niche_source: null,

    analysis_level: analysis.analysisLevel,
    analysis_status: analysis.analysisStatus,
    reason_specific_status: analysis.reasonSpecificStatus,
    data_integrity_limitation: analysis.dataIntegrityLimitation,

    primary_category: analysis.primaryCategory,
    primary_confidence: analysis.primaryConfidence,
    actionable: analysis.actionable,
    summary: analysis.summary,

    completed_at: new Date().toISOString(),
  };
}

export async function persistAnalysis(
  analysis: ComposedAnalysis,
  snapshot: PostOutcomeSourceSnapshot,
  options: { snapshotUri?: string | null } = {},
): Promise<PersistResult> {
  const sb = getServiceClient();

  const { data: existing } = await sb
    .from("post_outcome_analyses")
    .select("id")
    .eq("dispute_id", analysis.disputeId)
    .eq("analyzer_version", analysis.analyzerVersion)
    .eq("source_snapshot_sha256", analysis.snapshotHash)
    .maybeSingle<{ id: string }>();

  if (existing) {
    return { analysisId: existing.id, alreadyExisted: true, findingsWritten: 0 };
  }

  const { data: inserted, error } = await sb
    .from("post_outcome_analyses")
    .insert(analysisRow(analysis, snapshot, options.snapshotUri ?? null))
    .select("id")
    .single<{ id: string }>();

  if (error || !inserted) {
    // A concurrent writer may have won the race on the unique index. That is
    // the idempotency working, not a failure — re-read and return theirs.
    const { data: raced } = await sb
      .from("post_outcome_analyses")
      .select("id")
      .eq("dispute_id", analysis.disputeId)
      .eq("analyzer_version", analysis.analyzerVersion)
      .eq("source_snapshot_sha256", analysis.snapshotHash)
      .maybeSingle<{ id: string }>();
    if (raced) {
      return { analysisId: raced.id, alreadyExisted: true, findingsWritten: 0 };
    }
    throw new Error(
      `post_outcome_analyses insert failed for ${analysis.disputeId}: ${error?.message ?? "unknown"}`,
    );
  }

  const primary = analysis.findings.length > 0
    ? analysis.findings.indexOf(
        analysis.findings.find(
          (f) => f.category === analysis.primaryCategory,
        ) ?? analysis.findings[0],
      )
    : -1;

  const findingRows = analysis.findings.map((f, index) => ({
    analysis_id: inserted.id,
    is_primary: index === primary,
    category: f.category,
    confidence: f.confidence,
    severity: f.severity,
    title: f.title,
    description: f.description,
    observed_fact: f.observedFact,
    counterfactual_improvement: f.counterfactualImprovement,
    action_class: f.actionClass,
    evidence_refs: f.evidenceRefs,
    rule_refs: f.ruleRefs,
  }));

  if (findingRows.length > 0) {
    const { error: findingError } = await sb
      .from("post_outcome_findings")
      .insert(findingRows);

    if (findingError) {
      // An analysis without its findings reads as "nothing found", which is a
      // silent lie about a case that had some. Roll the parent back.
      await sb.from("post_outcome_analyses").delete().eq("id", inserted.id);
      throw new Error(
        `post_outcome_findings insert failed for ${analysis.disputeId}: ${findingError.message}`,
      );
    }
  }

  return {
    analysisId: inserted.id,
    alreadyExisted: false,
    findingsWritten: findingRows.length,
  };
}

/**
 * Point an older analysis at its replacement (plan §13: outcome corrections
 * supersede without deleting). Never removes the superseded row — an old
 * conclusion stays auditable, including the review decisions taken on it.
 */
export async function supersedeAnalysis(
  oldAnalysisId: string,
  newAnalysisId: string,
): Promise<void> {
  const sb = getServiceClient();
  const { error } = await sb
    .from("post_outcome_analyses")
    .update({ superseded_by_id: newAnalysisId, analysis_status: "SUPERSEDED" })
    .eq("id", oldAnalysisId);
  if (error) {
    throw new Error(`superseding ${oldAnalysisId} failed: ${error.message}`);
  }
}
