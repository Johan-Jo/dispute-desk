/**
 * i18n key mapping for the presentation model — ALL label decisions in
 * one place (plan §3.1 `labels.ts`). Surfaces call these helpers and
 * resolve the returned keys through next-intl; no surface re-derives
 * vocabulary.
 *
 * Strings live under `presentation.*` in messages/{locale}.json.
 * Controlled vocabulary per the approved mockups:
 *   lifecycle  — Building evidence / Monitoring / Evidence package
 *                prepared / Evidence saved to Shopify / Under review /
 *                Won / Lost / Closed
 *   attention  — No action required / Communication available /
 *                Communication recommended / Review communication /
 *                Approval required / Technical attention required
 *   strength   — list: Strong, Moderate, Weak, Not yet assessed;
 *                detail: Strong evidence, Partially supported,
 *                Limited evidence, Not yet assessed.
 */

import type { DisputePresentation } from "./types";
import { effectiveReviewDecision } from "./reviewDecision";

/** Operational-lifecycle chip label. */
export function lifecycleLabelKey(p: Pick<DisputePresentation, "lifecycle">): string {
  return `presentation.lifecycle.${p.lifecycle}`;
}

/** Blocking causes with dedicated labels. Anything outside this set
 *  falls back to the cause-neutral generic `attention.blocking`. */
const BLOCKING_LABELED_REASONS = new Set([
  "approval_gate",
  "missing_required_evidence",
  "quota_exceeded",
  "feature_blocked",
  "subscription_expired",
  "payment_failed",
  "auto_build_off",
]);

/** Attention pill label (shown only when attention ≠ none on the
 *  detail heading; the list folds attention into the primary state).
 *  `blocking` is labeled by its CAUSE — "Approval required" is only
 *  true for the approval gate; a missing-evidence block says
 *  "Evidence needed", billing halts say "Billing action required". */
export function attentionLabelKey(
  p: Pick<DisputePresentation, "attention" | "blockingReason">,
): string {
  if (
    p.attention === "blocking" &&
    p.blockingReason &&
    BLOCKING_LABELED_REASONS.has(p.blockingReason)
  ) {
    return `presentation.attentionBlocking.${p.blockingReason}`;
  }
  return `presentation.attention.${p.attention}`;
}

/** Evidence-strength label — terse on the list, descriptive on the
 *  detail page (plan §3.2 reconciliation). Same underlying grade. */
export function strengthLabelKey(
  surface: "list" | "detail",
  p: Pick<DisputePresentation, "strength">,
): string {
  return `presentation.strength.${surface}.${p.strength}`;
}

/**
 * The list "Status & next step" cell — primary label + secondary
 * responsibility copy. Communication attention states take the primary
 * slot (mockup `OPS` rows `communication_recommended` /
 * `review_communication`); a merchant-resolvable technical error shows
 * "Technical attention required"; otherwise the lifecycle label leads.
 * Secondary copy is responsibility information, never an imperative.
 */
export function listPrimaryState(
  p: Pick<DisputePresentation, "lifecycle" | "attention" | "blockingReason">,
  reviewStateInput?: "in_review" | "approved" | "conceded" | null,
): { labelKey: string; subKey: string } {
  // A recorded merchant decision OVERRIDES the attention-derived status:
  // once the merchant has approved / held / conceded, the row must stop
  // saying "Approval required" and reflect the standing decision, even
  // though the underlying approval gate (attention=blocking/approval_gate)
  // is technically still open until the deadline fires.
  //
  // …but only while the decision is still PENDING. `review_state` is never
  // cleared when the deadline cron carries it out, so past the save it
  // would keep the row on "Scheduled to submit" for an already-filed
  // dispute — see effectiveReviewDecision.
  const reviewState = effectiveReviewDecision(p.lifecycle, reviewStateInput);
  if (reviewState === "approved") {
    return {
      labelKey: "presentation.reviewDecision.approved",
      subKey: "presentation.reviewDecisionSub.approved",
    };
  }
  if (reviewState === "conceded") {
    return {
      labelKey: "presentation.reviewDecision.conceded",
      subKey: "presentation.reviewDecisionSub.conceded",
    };
  }
  if (reviewState === "in_review") {
    return {
      labelKey: "presentation.reviewDecision.in_review",
      subKey: "presentation.reviewDecisionSub.in_review",
    };
  }
  switch (p.attention) {
    case "technical_error":
      return {
        labelKey: "presentation.listState.technical_error",
        subKey: "presentation.listStateSub.technical_error",
      };
    case "blocking":
      if (p.blockingReason && BLOCKING_LABELED_REASONS.has(p.blockingReason)) {
        return {
          labelKey: `presentation.attentionBlocking.${p.blockingReason}`,
          subKey: `presentation.attentionBlockingSub.${p.blockingReason}`,
        };
      }
      return {
        labelKey: "presentation.listState.blocking",
        subKey: "presentation.listStateSub.blocking",
      };
    case "requested":
      return {
        labelKey: "presentation.listState.requested",
        subKey: "presentation.listStateSub.requested",
      };
    case "recommended":
      return {
        labelKey: "presentation.listState.recommended",
        subKey: "presentation.listStateSub.recommended",
      };
    default:
      return {
        labelKey: `presentation.lifecycle.${p.lifecycle}`,
        subKey: `presentation.lifecycleSub.${p.lifecycle}`,
      };
  }
}
