/**
 * Who filed the evidence — DisputeDesk, or the platform?
 *
 * `disputes.normalized_status` collapses three different histories into one
 * badge. `deriveNormalizedStatus` maps Shopify's `under_review` to
 * `submitted_to_bank`, and `submission_state === "submitted_confirmed"` to
 * `submitted` — and `submitted_confirmed` is itself set in
 * `applyDisputeSnapshot` purely from Shopify's `evidenceSentOn` timestamp.
 *
 * `evidenceSentOn` says evidence reached the bank. It does NOT say who put it
 * there. Shopify auto-files its own scrape at the deadline, and the merchant
 * can submit by hand in Shopify Admin. Both land on the identical status as a
 * DisputeDesk save, so the status vocabulary has no author dimension at all.
 *
 * Measured on prod 2026-09-21: `6a8848-dd` had 579 disputes, 313 of them
 * platform-confirmed and ZERO with a DisputeDesk save — including 206 wins. Any
 * win rate computed over that set describes Shopify, not this product.
 *
 * The one column that only we write is `disputes.evidence_saved_to_shopify_at`
 * (`saveToShopifyJob.ts`, alongside `submission_state = "saved_to_shopify"`).
 * That is the discriminator this module is built on.
 *
 * NOT to be confused with `postOutcome`'s `SubmissionConfirmationSource`, which
 * answers a different question — *how well can we prove forwarding happened* —
 * and deliberately returns `SHOPIFY_EVIDENCE_SENT_ON` whenever the platform
 * confirmed, whether or not we saved anything (`resolveConfirmationSource`
 * checks our save only as a fallback). It therefore collapses exactly the
 * distinction made here. It is also not available as a data source: only 50 of
 * 1,092 decided prod disputes carry a post-outcome analysis.
 */

/** Who put the evidence in front of the bank. */
export type FiledBy = "disputedesk" | "shopify" | "unknown";

/** The subset of `disputes` columns this decision reads. */
export interface FiledByInput {
  /** Set only by our own save job. The sole DisputeDesk-authored signal. */
  evidence_saved_to_shopify_at?: string | null;
  submission_state?: string | null;
}

/**
 * Resolve who filed.
 *
 * - `disputedesk` — we saved evidence to Shopify. Ours, regardless of whether
 *   the platform went on to confirm forwarding (it often never reports it; see
 *   `docs/plans/submission-confirmation-gap.plan.md`).
 * - `shopify` — the platform confirmed a submission we have no save for. Either
 *   Shopify's own auto-file at the deadline or a manual submit in Admin;
 *   Shopify exposes no actor on `evidenceSentOn`, so these two are genuinely
 *   indistinguishable and are deliberately NOT guessed apart.
 * - `unknown` — neither signal. Includes disputes that reached the issuer with
 *   no submission recorded on either side (16 such rows on `6a8848-dd`).
 */
export function resolveFiledBy(dispute: FiledByInput): FiledBy {
  if (dispute.evidence_saved_to_shopify_at) return "disputedesk";
  if (
    dispute.submission_state === "submitted_confirmed" ||
    dispute.submission_state === "manual_submission_reported"
  ) {
    return "shopify";
  }
  return "unknown";
}

/** True when DisputeDesk authored the filing — the predicate for any metric
 *  that claims to measure this product's performance. */
export function isDisputeDeskFiled(dispute: FiledByInput): boolean {
  return resolveFiledBy(dispute) === "disputedesk";
}
