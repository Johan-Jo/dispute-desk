/**
 * The owners the dispute page must READ (single-source plan 3.2), keyed by their
 * exact path in the workspace payload.
 *
 * Plan 3.2 names three of these without their payload prefix; the real paths are:
 *   `refundStatement`    -> `dispute.refundStatement`
 *   `orderSituation`     -> `dispute.orderSituation`
 *   `effectiveChecklist` -> `pack.checklistV2` (the route returns the EFFECTIVE checklist there)
 * The rest are as written in the plan.
 */
export const OWNER_KEYS = [
  "presentation.lifecycle",
  "presentation.attention",
  "presentation.automationMode",
  "pack.checklistV2",
  "dispute.refundStatement",
  "dispute.orderSituation",
  "returnRequest",
  "asks",
  "assessmentGate",
  "workspaceAssessment.caseStrength",
  "decidedView",
  "outcomeExplanation",
  "evidenceLineItems",
  "bankClaim",
  "dispute.evidenceSavedToShopifyAt",
  "dispute.automationMode",
] as const;

export type OwnerKey = (typeof OWNER_KEYS)[number];

/**
 * Owners no live builder reads, each with the reason and the PR that closes it.
 * An entry here that IS read fails the test (stale), so this list can only shrink.
 * `dispute.refundStatement` is deliberately NOT here: it is a known gap asserted
 * by `it.fails` in ownerCoverage.test.tsx, flipped by PR 2.
 */
export const OWNER_EXEMPTIONS: Partial<Record<OwnerKey, string>> = {
  "dispute.evidenceSavedToShopifyAt":
    "Not in the payload yet: PR 2 adds it in enrichWorkspacePayload and moves 'saved' off pack.savedToShopifyAt onto it.",
  "dispute.automationMode":
    "Not in the payload yet: PR 2 adds it in enrichWorkspacePayload for the case where presentation is null.",
  assessmentGate:
    "Not in the payload yet: PR 2 adds it in enrichWorkspacePayload; the record's strength band reads it.",
  asks: "Not in the payload yet: PR 3 adds the merchant asks registry; the record's action reads it.",
  outcomeExplanation:
    "Not in the payload yet: PR 2 adds it in enrichWorkspacePayload; the decided outcome line renders it beside the date/amount line.",
};
