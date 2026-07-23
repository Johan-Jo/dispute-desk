/**
 * Canonical values for `disputes.attention_reason`.
 *
 * The UI uses these strings to pick the right banner, CTA, and next
 * action — it must NOT parse free-text `next_action_text` to make
 * routing decisions. Every code path that sets `needs_attention=true`
 * MUST also set `attention_reason` to one of these constants and
 * attach a structured `attention_payload`.
 *
 * Adding a new reason:
 *   1. Append a constant below.
 *   2. Add the matching banner + CTA copy keys to messages/{locale}.json.
 *   3. Wire the banner into the disputes list / detail view-models.
 *   4. Document the payload shape in the JSDoc on the constant.
 *
 * Removing a reason: leave the constant in place for one release after
 * the last writer is removed, so historical rows still resolve. Delete
 * only after a backfill clears any lingering uses.
 */

export const DISPUTE_ATTENTION_REASONS = {
  /** `runAutomationPipeline` exited because `auto_build_enabled = false`
   *  on shop_settings. Payload: `{ source: "automation_pipeline" }`. */
  AUTO_BUILD_OFF: "auto_build_off",

  /** `runAutomationPipeline` exited because `checkPackQuota` returned
   *  `allowed: false`. Payload:
   *  `{ plan: PlanId, remaining: number, limit: number | null }`. */
  QUOTA_EXCEEDED: "quota_exceeded",

  /** `runAutomationPipeline` exited because the plan doesn't include
   *  the `autoPack` feature. Payload: `{ plan: PlanId }`. */
  FEATURE_BLOCKED: "feature_blocked",

  /** Billing reconciliation cron transitioned the shop's subscription
   *  state to `expired` (cycle ended without renewal). Payload:
   *  `{ cycle_ended_at: string, plan: PlanId }`. */
  SUBSCRIPTION_EXPIRED: "subscription_expired",

  /** App_subscriptions/update webhook reported a FROZEN status (Shopify
   *  failed to charge the merchant's card). Payload:
   *  `{ shopify_charge_gid: string, retry_count?: number }`. */
  PAYMENT_FAILED: "payment_failed",

  /** Completeness gate blocked auto-save with required-evidence
   *  failures. Payload: `{ pack_id, missing_fields: string[] }`. */
  MISSING_REQUIRED_EVIDENCE: "missing_required_evidence",

  /** Save-to-Shopify job exhausted retries. Payload:
   *  `{ pack_id, job_id, last_error: string }`. */
  SUBMISSION_FAILED: "submission_failed",

  /** Gorgias enrichment finished with AI-proposed communication evidence
   *  awaiting merchant review. Payload:
   *  `{ proposal_count: number, run_id: string }`. Cleared by the review
   *  routes once no proposed messages / unconfirmed medium tickets /
   *  re-approval flags remain. */
  GORGIAS_EVIDENCE_READY: "gorgias_evidence_ready",

  /** A dispute the merchant put on hold (`review_state = 'in_review'`)
   *  is approaching its evidence deadline while still untouched. The
   *  `dispute-reminders` cron resurfaces it (sets needs_attention=true,
   *  clears review_state) so a held dispute can't silently rot to the
   *  deadline. Payload: `{ hours_to_deadline: number, due_at: string }`.
   *  Cleared when the merchant takes a fresh review action. */
  REVIEW_DEADLINE_APPROACHING: "review_deadline_approaching",
} as const;

export type DisputeAttentionReason =
  (typeof DISPUTE_ATTENTION_REASONS)[keyof typeof DISPUTE_ATTENTION_REASONS];

/** Reasons that should surface a billing CTA. The pipeline and the
 *  embedded/portal banner layers both read this set; do not duplicate
 *  the list. */
export const BILLING_ATTENTION_REASONS: ReadonlySet<DisputeAttentionReason> =
  new Set<DisputeAttentionReason>([
    DISPUTE_ATTENTION_REASONS.QUOTA_EXCEEDED,
    DISPUTE_ATTENTION_REASONS.FEATURE_BLOCKED,
    DISPUTE_ATTENTION_REASONS.SUBSCRIPTION_EXPIRED,
    DISPUTE_ATTENTION_REASONS.PAYMENT_FAILED,
  ]);

export function isBillingAttentionReason(
  reason: string | null | undefined,
): reason is DisputeAttentionReason {
  return (
    typeof reason === "string" &&
    BILLING_ATTENTION_REASONS.has(reason as DisputeAttentionReason)
  );
}
