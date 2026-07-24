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

/** Operational-lifecycle chip label. */
export function lifecycleLabelKey(p: Pick<DisputePresentation, "lifecycle">): string {
  return `presentation.lifecycle.${p.lifecycle}`;
}

/** Attention pill label (shown only when attention ≠ none on the
 *  detail heading; the list folds attention into the primary state). */
export function attentionLabelKey(p: Pick<DisputePresentation, "attention">): string {
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
  p: Pick<DisputePresentation, "lifecycle" | "attention">,
): { labelKey: string; subKey: string } {
  switch (p.attention) {
    case "technical_error":
      return {
        labelKey: "presentation.listState.technical_error",
        subKey: "presentation.listStateSub.technical_error",
      };
    case "blocking":
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
