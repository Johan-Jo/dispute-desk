import { getServiceClient } from "../supabase/server";
import { deriveNormalizedStatus } from "./normalizeStatus";
import { deriveFinalOutcome } from "./deriveFinalOutcome";
import type { SubmissionState } from "./types";

/**
 * Recalculates normalized status and outcome snapshot columns on a dispute.
 *
 * Reads the dispute + its latest evidence pack, derives the normalized
 * state, and writes the snapshot back. Fire-and-forget safe.
 */
export async function updateNormalizedStatus(
  disputeId: string,
): Promise<void> {
  try {
    const db = getServiceClient();

    // Load dispute
    const { data: dispute, error: dErr } = await db
      .from("disputes")
      .select(
        "id, status, needs_review, submission_state, amount",
      )
      .eq("id", disputeId)
      .single();

    if (dErr || !dispute) {
      console.error("[updateNormalizedStatus] dispute not found", {
        disputeId,
        error: dErr?.message,
      });
      return;
    }

    // Load latest non-archived pack for this dispute
    const { data: pack } = await db
      .from("packs")
      .select("id, status")
      .eq("dispute_id", disputeId)
      .neq("status", "ARCHIVED")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const submissionState: SubmissionState =
      (dispute.submission_state as SubmissionState) ?? "not_saved";

    const statusResult = deriveNormalizedStatus(
      dispute.status,
      pack?.status?.toLowerCase() ?? null,
      submissionState,
      dispute.needs_review ?? false,
    );

    const update: Record<string, unknown> = {
      normalized_status: statusResult.normalizedStatus,
      status_reason: statusResult.statusReason,
      next_action_type: statusResult.nextActionType,
      next_action_text: statusResult.nextActionText,
      needs_attention: statusResult.needsAttention,
    };

    // Derive outcome if terminal
    const outcome = deriveFinalOutcome(
      dispute.status ?? "",
      Number(dispute.amount) || 0,
    );
    if (outcome) {
      update.final_outcome = outcome.finalOutcome;
      update.outcome_amount_recovered = outcome.outcomeAmountRecovered;
      update.outcome_amount_lost = outcome.outcomeAmountLost;
      update.outcome_source = outcome.outcomeSource;
      update.outcome_confidence = outcome.outcomeConfidence;
    }

    await db.from("disputes").update(update).eq("id", disputeId);
  } catch (err) {
    console.error("[updateNormalizedStatus] Unexpected error", {
      disputeId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
