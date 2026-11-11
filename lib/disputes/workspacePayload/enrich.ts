/**
 * The ONE place the workspace payload is enriched with fields derived from
 * `EnrichSourceRows` (single-source plan 3.1). The route and every test call
 * this same function, so a frozen fixture gains a field the moment it is added
 * here - no prod redeploy to re-capture, no fixture drift.
 *
 * Adds `asks` (the merchant asks registry, `lib/disputes/merchantAsks.ts`). The
 * plan's PR 2 adds `dispute.evidenceSavedToShopifyAt`, `dispute.automationMode`,
 * `assessmentGate` and `outcomeExplanation` HERE. Emits tokens and ISO dates
 * only; dates are formatted at render.
 */

import { merchantAsksFromPayload } from "@/lib/disputes/merchantAsks";
import { resolveOutcomeExplanation } from "@/lib/disputes/outcomeExplanation";
import { recordStatusOf } from "@/lib/disputes/workspacePayload/recordStage";
import type { WorkspaceData } from "@/app/(embedded)/app/disputes/[id]/workspace-components/types";
import type { EnrichSourceRows } from "./sourceRows";

/**
 * Dotted payload paths `enrichWorkspacePayload` ADDS. The capture script strips
 * these from a route response so a frozen fixture is always the PRE-enrichment
 * payload; `tests/unit/enrichWorkspacePayload.test.ts` fails if enrichment adds
 * anything not listed.
 */
export const ENRICHED_PATHS: readonly string[] = ["asks", "outcomeExplanation"];

export function enrichWorkspacePayload<P extends object>(payload: P, sourceRows: EnrichSourceRows): P {
  const data = payload as unknown as WorkspaceData;
  const status = recordStatusOf(data);
  // Only a decided dispute has an explanation; a live case never does (outcomeExplanation.ts, rule 1).
  const outcomeExplanation =
    status === "won" || status === "lost"
      ? resolveOutcomeExplanation({
          outcome: status,
          reason: data.dispute?.reason ?? null,
          pack: sourceRows.outcomeInputs,
          customerName: data.dispute?.customerName ?? null,
        })
      : null;
  return { ...payload, asks: merchantAsksFromPayload(data), outcomeExplanation };
}
