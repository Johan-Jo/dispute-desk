import type {
  NormalizedStatus,
  NormalizedStatusResult,
  SubmissionState,
} from "./types";

/**
 * Derives the merchant-facing normalized status from raw state.
 *
 * Key rule: "submitted" only appears when we have a confirmed submission signal.
 * Evidence saved to Shopify + no confirmation = "action_needed".
 */
export function deriveNormalizedStatus(
  shopifyStatus: string | null,
  packStatus: string | null,
  submissionState: SubmissionState,
  needsReview: boolean,
): NormalizedStatusResult {
  // Terminal Shopify statuses
  if (shopifyStatus === "won") {
    return result("won", "Dispute won", null, null, false);
  }
  if (shopifyStatus === "lost") {
    return result("lost", "Dispute lost", null, null, false);
  }
  if (shopifyStatus === "charge_refunded") {
    return result("closed_other", "Charge refunded", null, null, false);
  }
  if (shopifyStatus === "accepted") {
    return result(
      "accepted_not_contested",
      "Dispute accepted / not contested",
      null,
      null,
      false,
    );
  }

  // Under review at issuer
  if (shopifyStatus === "under_review") {
    return result(
      "waiting_on_issuer",
      "Waiting on issuer decision",
      null,
      null,
      false,
    );
  }

  // needs_response — derive from pack + submission state
  if (shopifyStatus === "needs_response" || !shopifyStatus) {
    // Confirmed submission
    if (
      submissionState === "submitted_confirmed" ||
      submissionState === "manual_submission_reported"
    ) {
      return result(
        "submitted",
        "Representment submitted",
        null,
        null,
        false,
      );
    }

    // Evidence saved but not submitted
    if (submissionState === "saved_to_shopify") {
      return result(
        "action_needed",
        "Evidence saved to Shopify — submit in Shopify Admin",
        "submit_in_shopify",
        "Submit the representment in Shopify Admin",
        true,
      );
    }

    // Submission uncertain
    if (submissionState === "submission_uncertain") {
      return result(
        "action_needed",
        "Submission not confirmed",
        "verify_submission",
        "Verify that the representment was submitted in Shopify Admin",
        true,
      );
    }

    // Pack states
    if (packStatus === "blocked") {
      return result(
        "action_needed",
        "Evidence pack has blockers",
        "resolve_blockers",
        "Resolve missing required evidence before submitting",
        true,
      );
    }
    if (needsReview) {
      return result(
        "needs_review",
        "Pack ready — review before saving",
        "review_pack",
        "Review the evidence pack and approve for save",
        true,
      );
    }
    if (packStatus === "ready") {
      return result(
        "ready_to_submit",
        "Evidence ready to save to Shopify",
        "save_evidence",
        "Save evidence to Shopify and submit",
        true,
      );
    }
    if (packStatus === "building" || packStatus === "queued") {
      return result(
        "in_progress",
        "Evidence pack is being built",
        null,
        null,
        false,
      );
    }
    if (packStatus === "saving") {
      return result(
        "in_progress",
        "Saving evidence to Shopify",
        null,
        null,
        false,
      );
    }

    // No pack yet
    return result(
      "new",
      "New dispute — no evidence pack yet",
      "generate_pack",
      "Generate an evidence pack",
      true,
    );
  }

  // Fallback
  return result(
    "new",
    `Unknown Shopify status: ${shopifyStatus}`,
    null,
    null,
    false,
  );
}

function result(
  normalizedStatus: NormalizedStatus,
  statusReason: string,
  nextActionType: string | null,
  nextActionText: string | null,
  needsAttention: boolean,
): NormalizedStatusResult {
  return {
    normalizedStatus,
    statusReason,
    nextActionType,
    nextActionText,
    needsAttention,
  };
}
