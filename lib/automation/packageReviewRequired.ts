/**
 * The merchant-visible consequence of a PR-C1 background block.
 *
 * A blocked background attempt (auto-save, reconcile, finalize) must not leave
 * the merchant with nothing but a failed internal job. It raises the ordinary
 * structured attention state the dashboards and the workspace already read, so
 * the dispute surfaces in the attention queues with a review-required banner.
 *
 * Deliberately narrow: it sets `needs_attention` + the canonical reason +
 * payload, and nothing else. It does not touch submission state, pack status,
 * review state, or send email — a containment block is "look at this", not a
 * lifecycle transition.
 */

import { DISPUTE_ATTENTION_REASONS } from "@/lib/disputes/attentionReasons";

type SbLike = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export interface MarkPackageReviewRequiredInput {
  disputeId: string;
  /** The blocked candidate, when one was identified. */
  packageId: string | null;
  /** Machine-readable reason codes from the safety preflight. */
  reasons: string[];
}

export async function markPackageReviewRequired(
  sb: SbLike,
  input: MarkPackageReviewRequiredInput,
): Promise<void> {
  try {
    await sb
      .from("disputes")
      .update({
        needs_attention: true,
        attention_reason: DISPUTE_ATTENTION_REASONS.PACKAGE_REVIEW_REQUIRED,
        attention_payload: {
          package_id: input.packageId,
          reasons: input.reasons,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.disputeId);
  } catch (err) {
    // Non-fatal by design: the block itself already happened and is audited.
    // Failing to raise the banner must never turn into an exception that a
    // caller mistakes for "the block did not apply".
    console.error("[packageReviewRequired] failed to set attention state", err);
  }
}
