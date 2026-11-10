/**
 * The ONE place the workspace payload is enriched with fields derived from
 * `EnrichSourceRows` (single-source plan 3.1). The route and every test call
 * this same function, so a frozen fixture gains a field the moment it is added
 * here - no prod redeploy to re-capture, no fixture drift.
 *
 * PR 1 scaffolding: the plan's later PRs add `dispute.evidenceSavedToShopifyAt`,
 * `dispute.automationMode`, `assessmentGate`, `asks` and `outcomeExplanation`
 * HERE. Until then it returns the payload untouched (PR 1 changes no route
 * output). Emits tokens and ISO dates only; dates are formatted at render.
 */

import type { EnrichSourceRows } from "./sourceRows";

/**
 * Dotted payload paths `enrichWorkspacePayload` ADDS. The capture script strips
 * these from a route response so a frozen fixture is always the PRE-enrichment
 * payload; `tests/unit/enrichWorkspacePayload.test.ts` fails if enrichment adds
 * anything not listed. Empty in PR 1.
 */
export const ENRICHED_PATHS: readonly string[] = [];

export function enrichWorkspacePayload<P extends object>(payload: P, sourceRows: EnrichSourceRows): P {
  void sourceRows;
  return payload;
}
