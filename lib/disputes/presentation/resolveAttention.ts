/**
 * Merchant-attention resolver.
 *
 * Never returns or mutates a lifecycle value. Deadline risk is a
 * separate fact (it amplifies emphasis) — it is NOT an attention value
 * and never creates one (plan §3.1).
 *
 * Deterministic ladder — first match wins; every backend signal maps to
 * exactly one rung (classifications recorded in plan §12V):
 *
 *   technical_error  merchant-RESOLVABLE technical problem only
 *                    (integrations reconnect_required — Gorgias 401/403,
 *                    enrichGorgiasCommsJob.ts:493-511).
 *   blocking         DisputeDesk cannot continue without merchant
 *                    intervention, deadline or not:
 *                    - billing halts (quota_exceeded / feature_blocked /
 *                      subscription_expired / payment_failed)
 *                    - missing_required_evidence (completeness gate)
 *                    - auto_build_off (pipeline disabled by merchant)
 *                    - review-mode approval gate (rule mode 'review' +
 *                      pack ready + not approved).
 *   requested        the merchant has been explicitly asked to review /
 *                    approve / decide, but work is not halted:
 *                    - gorgias_evidence_ready / actionable Gorgias count
 *                    - review_deadline_approaching (cron re-ask on a
 *                      held dispute).
 *   recommended      a concrete contribution is available and
 *                    recommended; no explicit task exists. NEVER derived
 *                    from caseStrength / heroVariant / generic
 *                    improvementHint copy.
 *   opportunity      something optional is available; not recommended.
 *   none.
 *
 * INTERNAL failures are NOT merchant attention (§12V decision 4):
 * submission_failed, pack build failures (order_fetch_failed), all
 * defence-package failure codes, submission_uncertain, and
 * gorgiasEvidenceStale surface as `internalIssue` transparency only.
 *
 * Stale-attention guard: a terminal or transmission-confirmed dispute
 * never yields a task (bucket precedence also protects — §4).
 */

import type { MerchantAttention } from "./types";

/** attention_reason values that halt the pipeline pending a merchant
 *  action (lib/disputes/attentionReasons.ts) → blocking. */
const BLOCKING_ATTENTION_REASONS = new Set([
  "quota_exceeded",
  "feature_blocked",
  "subscription_expired",
  "payment_failed",
  "missing_required_evidence",
  "auto_build_off",
]);

/** attention_reason values that are an explicit ask without halting
 *  work → requested. */
const REQUESTED_ATTENTION_REASONS = new Set([
  "gorgias_evidence_ready",
  "review_deadline_approaching",
]);

/** attention_reason values that are internal failures — transparency
 *  only, never merchant attention (§12V decision 4). */
const INTERNAL_ATTENTION_REASONS = new Set(["submission_failed"]);

/** attention_reason values that constitute a genuine merchant task
 *  (blocking + requested). Shared by the /api/disputes attention
 *  filter and the shop-wide merchant-action aggregate so the two can
 *  never disagree. */
export const MERCHANT_TASK_ATTENTION_REASONS: readonly string[] = [
  ...BLOCKING_ATTENTION_REASONS,
  ...REQUESTED_ATTENTION_REASONS,
];

export interface AttentionInput {
  /** `disputes.attention_reason` — authoritative on its own. A blocking
   *  reason is honoured even when `needsAttention` is false, because
   *  `updateNormalizedStatus` overwrites that boolean without clearing the
   *  reason (see `resolveAttention` for the incident). */
  attentionReason: string | null;
  /** `disputes.needs_attention`. Retained for the REQUESTED reasons and as a
   *  signal in its own right; never a veto over a blocking reason. */
  needsAttention: boolean;
  /** Shop-level integration state: `integrations.status =
   *  'needs_attention'` with `meta.error_code='reconnect_required'` —
   *  the only verified merchant-resolvable technical signal. */
  integrationReconnectRequired: boolean;
  /** Gorgias actionable count: proposed messages + medium-confidence
   *  proposed_match tickets (RPC gorgias_recompute_attention), or
   *  `attention_payload.proposal_count`. */
  gorgiasActionableCount: number;
  /** Review-mode approval gate: resolved rule mode for this dispute. */
  automationMode: "auto" | "review" | null;
  /** Latest pack status + approval stamp (approval gate =
   *  mode 'review' AND status 'ready' AND approvedForSaveAt null). */
  packStatus: string | null;
  approvedForSaveAt: string | null;
  /** Server-side concrete-contribution signal (derived from
   *  pack_json.checklistV2 via the canMerchantUpload predicate —
   *  a specific addable item, never generic improvement copy).
   *  "recommended" = the pipeline recommends it; "optional" = merely
   *  available. Null when nothing concrete is addable. */
  concreteContribution: "recommended" | "optional" | null;
  /** Internal-failure facts (transparency only). */
  packFailed: boolean;
  gorgiasEvidenceStale: boolean;
  submissionUncertain: boolean;
  /** Stale-attention guards from the objective facts. */
  terminal: boolean;
  transmissionConfirmed: boolean;
}

/** The specific cause behind attention=`blocking`, so surfaces can
 *  label it truthfully instead of a one-size-fits-all pill ("Approval
 *  required" is only true for the approval gate — a missing-evidence
 *  block is NOT awaiting approval; dev report 2026-07-24). */
export type BlockingReason =
  | "approval_gate"
  | "missing_required_evidence"
  | "quota_exceeded"
  | "feature_blocked"
  | "subscription_expired"
  | "payment_failed"
  | "auto_build_off";

export interface AttentionResult {
  attention: MerchantAttention;
  /** Set iff attention === "blocking" — the matched cause. */
  blockingReason: BlockingReason | null;
  /** An internal, non-merchant-resolvable issue exists — surface
   *  neutral transparency copy only ("DisputeDesk detected a technical
   *  issue and is working to resolve it. No action is currently
   *  required from you."). */
  internalIssue: boolean;
}

export function resolveAttention(input: AttentionInput): AttentionResult {
  const internalIssue =
    input.packFailed ||
    input.submissionUncertain ||
    input.gorgiasEvidenceStale ||
    (input.needsAttention &&
      input.attentionReason != null &&
      INTERNAL_ATTENTION_REASONS.has(input.attentionReason));

  // Stale-attention guard: nothing is a merchant task once the response
  // is locked or the dispute is terminal.
  if (input.terminal || input.transmissionConfirmed) {
    return { attention: "none", blockingReason: null, internalIssue };
  }

  // 1 — merchant-resolvable technical problem only.
  if (input.integrationReconnectRequired) {
    return { attention: "technical_error", blockingReason: null, internalIssue };
  }

  // 2 — blocking: work halted pending the merchant (deadline or not).
  // The specific cause travels with the result so surfaces can label
  // it truthfully (evidence needed vs approval vs billing).
  /* `attention_reason` stands on its own — it is NOT gated on the
   * `needs_attention` boolean.
   *
   * WHY (2026-09-03). The two columns are written together by the pipeline
   * (pipeline.ts:121-124), but `updateNormalizedStatus.ts:60` later overwrites
   * `needs_attention` alone, from `deriveNormalizedStatus` — which reads
   * Shopify status + pack state and knows nothing about `attention_reason`.
   * So any status sync can flip the boolean to false and leave the reason
   * orphaned. Measured on prod: 7 rows disagreed this way, 3 of them still
   * open, including #99413.
   *
   * The consequence was silence. `auto_build_off` means the merchant has
   * automatic evidence building switched off, so NO pack will ever be built —
   * and this gate discarded it, resolving attention to `none`. The page then
   * rendered "Building your evidence pack… no action needed from you" over a
   * dispute where nothing was building and the deadline was running.
   *
   * A reason in `BLOCKING_ATTENTION_REASONS` is a statement about the
   * pipeline's own state, not a notification preference. It is authoritative
   * whenever present; the boolean is treated as a hint that can be stale, not
   * a veto. The stale-attention guards above (terminal / transmission
   * confirmed) still clear it, which is the case the boolean was really
   * protecting against. */
  const reason = input.attentionReason;
  const approvalGate =
    input.automationMode === "review" &&
    input.packStatus === "ready" &&
    input.approvedForSaveAt == null;
  if (reason != null && BLOCKING_ATTENTION_REASONS.has(reason)) {
    return {
      attention: "blocking",
      blockingReason: reason as BlockingReason,
      internalIssue,
    };
  }
  if (approvalGate) {
    return { attention: "blocking", blockingReason: "approval_gate", internalIssue };
  }

  // 3 — requested: an explicit ask, work not halted. This is the ONLY
  // "you can add something" state we surface — a CONCRETE, matched Gorgias
  // conversation awaiting approval (gorgias_evidence_ready), not a generic
  // suggestion.
  /* The REQUESTED reasons stay gated on `needsAttention`, deliberately.
   * Unlike the blocking set, these are notification-shaped
   * (`gorgias_evidence_ready`, `review_deadline_approaching`): the boolean is
   * how a resurfacing cron says "raise this now" and how it is dismissed
   * again. Un-gating them would resurrect asks the merchant already cleared —
   * a different bug from the one above, so the narrowing stops here. */
  if (
    (input.needsAttention &&
      reason != null &&
      REQUESTED_ATTENTION_REASONS.has(reason)) ||
    input.gorgiasActionableCount > 0
  ) {
    return { attention: "requested", blockingReason: null, internalIssue };
  }

  // The generic `recommended` / `opportunity` "customer communication may
  // strengthen this" states were REMOVED (2026-07-27, user decision):
  // virtually EVERY dispute improves with customer communication, so
  // flagging it on a few and not others is arbitrary and confusing. We
  // only surface a real, concrete Gorgias match that needs approval
  // (the `requested` rung above) — nothing generic. `concreteContribution`
  // is still computed for other consumers but no longer raises attention.
  return { attention: "none", blockingReason: null, internalIssue };
}
