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

export interface AttentionInput {
  /** `disputes.attention_reason` (meaningful when needs_attention). */
  attentionReason: string | null;
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

export interface AttentionResult {
  attention: MerchantAttention;
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
    return { attention: "none", internalIssue };
  }

  // 1 — merchant-resolvable technical problem only.
  if (input.integrationReconnectRequired) {
    return { attention: "technical_error", internalIssue };
  }

  // 2 — blocking: work halted pending the merchant (deadline or not).
  const reason = input.needsAttention ? input.attentionReason : null;
  const approvalGate =
    input.automationMode === "review" &&
    input.packStatus === "ready" &&
    input.approvedForSaveAt == null;
  if ((reason != null && BLOCKING_ATTENTION_REASONS.has(reason)) || approvalGate) {
    return { attention: "blocking", internalIssue };
  }

  // 3 — requested: an explicit ask, work not halted.
  if (
    (reason != null && REQUESTED_ATTENTION_REASONS.has(reason)) ||
    input.gorgiasActionableCount > 0
  ) {
    return { attention: "requested", internalIssue };
  }

  // 4 — recommended: a concrete recommended contribution exists.
  if (input.concreteContribution === "recommended") {
    return { attention: "recommended", internalIssue };
  }

  // 5 — opportunity: optional and available, not recommended.
  if (input.concreteContribution === "optional") {
    return { attention: "opportunity", internalIssue };
  }

  return { attention: "none", internalIssue };
}
