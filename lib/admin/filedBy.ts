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
 * That is the discriminator this module is built on. Whether the *platform*
 * filed is then read from Shopify's own lifecycle (`disputes.status`), because
 * its `evidenceSentOn` confirmation is missing on 72% of the cases it filed —
 * see `resolveFiledBy`.
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
export type FiledBy = "disputedesk" | "shopify" | "pending";

/** The subset of `disputes` columns this decision reads. */
export interface FiledByInput {
  /** Set only by our own save job. The sole DisputeDesk-authored signal. */
  evidence_saved_to_shopify_at?: string | null;
  submission_state?: string | null;
  /** Shopify's own lifecycle status. Authoritative about whether the dispute
   *  advanced past the response window. */
  status?: string | null;
}

/**
 * Shopify statuses meaning "the response window is still open" — nobody has
 * filed yet, and that is the correct, expected state.
 *
 * Everything else Shopify reports (`under_review`, `won`, `lost`, `accepted`)
 * means the dispute moved on: the window closed and the case went to the
 * issuer. Compared case-insensitively because prod holds one `NEEDS_RESPONSE`
 * row alongside 17 lowercase ones, and a case-sensitive check would read that
 * open dispute as filed.
 */
const AWAITING_RESPONSE_STATUSES = new Set(["needs_response"]);

/**
 * Resolve who filed.
 *
 * - `disputedesk` — we saved evidence to Shopify. Ours, regardless of whether
 *   the platform went on to confirm forwarding (it often never reports it; see
 *   `docs/plans/submission-confirmation-gap.plan.md`).
 * - `shopify` — no save of ours, and either the platform confirmed a
 *   submission OR the dispute advanced past the response window. Shopify's
 *   own auto-file at the deadline or a manual submit in Admin; Shopify exposes
 *   no actor, so these two are deliberately NOT guessed apart.
 * - `pending` — no save of ours and the window is still open. Nothing has been
 *   filed yet, which is the correct state for a new dispute, not a mystery.
 *
 * WHY THE LIFECYCLE IS CONSULTED, NOT JUST `submission_state`:
 * `submitted_confirmed` is set only when Shopify reports an `evidenceSentOn`,
 * and it frequently does not. Measured on prod 2026-09-22, of 487 disputes
 * that reached the issuer with no save of ours, **349 (72%) carried no
 * confirmation at all** — including 138 won and 186 lost. Keying solely on the
 * confirmation flag labelled those "unknown", which put `won` + `Unknown` next
 * to `won` + `Shopify` in the admin list for two cases with identical
 * lifecycles. A decided dispute was filed by someone; we know it was not us.
 *
 * INFERENCE BOUNDARY: for a dispute that advanced without a confirmation, that
 * it was filed is read from the lifecycle, not from a filing record. Shopify
 * exposes no such record. "Shopify" is therefore the best-supported attribution
 * rather than a logged fact — but the alternative, calling a decided case
 * "unknown", asserts an ambiguity that the dispute's own status refutes.
 */
export function resolveFiledBy(dispute: FiledByInput): FiledBy {
  if (dispute.evidence_saved_to_shopify_at) return "disputedesk";
  if (
    dispute.submission_state === "submitted_confirmed" ||
    dispute.submission_state === "manual_submission_reported"
  ) {
    return "shopify";
  }
  const status = dispute.status?.toLowerCase() ?? null;
  // No status at all is not evidence that the window closed — stay `pending`
  // rather than attributing a filing we have nothing to base it on.
  if (status && !AWAITING_RESPONSE_STATUSES.has(status)) return "shopify";
  return "pending";
}

/** True when DisputeDesk authored the filing — the predicate for any metric
 *  that claims to measure this product's performance. */
export function isDisputeDeskFiled(dispute: FiledByInput): boolean {
  return resolveFiledBy(dispute) === "disputedesk";
}
