/**
 * The held-state ladder as production runs it TODAY, moved verbatim.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────
 *
 * PR 2 wires the canonical `CaseAutomationDecision` into `resolveHeldState`,
 * but ships it dark (`lib/pipeline/activation.ts`). "Dark" has to mean the
 * same code runs, not a faithful-looking re-expression of it: the canonical
 * ladder answers weak/insufficient differently after contract revision 2
 * (`hold_for_deadline` instead of `block`), and a reviewer must be able to
 * see that the OFF path cannot inherit that change.
 *
 * So the body below is `resolveHeldState` exactly as it stood at the kickoff
 * baseline `58e15806`, renamed and nothing else. It still calls
 * `evaluateAutoSubmitGuards`, still discriminates the two held reasons by the
 * guard's ACTION, and still maps `weak` / `insufficient` through `block`.
 *
 * PR 3 deletes this file together with the switch's `false` branch.
 */

import { evaluateAutoSubmitGuards } from "@/lib/automation/autoSubmitGuards";
import {
  canOfferCardholderAcknowledgement,
  type HeldReason,
  type HeldState,
  type HeldStateInput,
} from "./heldState";

/**
 * Verbatim from `58e15806:lib/disputes/heldState.ts`.
 *
 * Coverage and fatal-loss are NOT "held": they have their own dedicated copy
 * (Shopify Protect / hard-to-win) and no amount of merchant evidence changes
 * them, so they return `held: false` and are left to the surfaces that
 * already handle them.
 */
export function resolveHeldStateLegacy(input: HeldStateInput): HeldState {
  const none: HeldState = {
    held: false,
    reason: null,
    offer: null,
    offerFlipsToStrong: false,
  };

  if (input.automationMode !== "auto") return none;

  const verdict = evaluateAutoSubmitGuards({
    coverageState: input.coverageState,
    fatalLoss: input.fatalLoss,
    returnedToSender: input.returnedToSender ?? null,
    caseStrength: input.caseStrength,
    creditAlreadyIssued: input.creditAlreadyIssued,
  });

  let reason: HeldReason | null = null;
  if (verdict.decision === "park" && verdict.reason === "moderate_strength") {
    reason = "moderate_strength";
  } else if (
    verdict.decision === "block" &&
    (verdict.reason === "weak" || verdict.reason === "insufficient")
  ) {
    reason = "weak_strength";
  }
  if (!reason) return none;

  const offer =
    input.acknowledgement &&
    canOfferCardholderAcknowledgement(input.acknowledgement)
      ? ("cardholder_acknowledgement" as const)
      : null;

  return {
    held: true,
    reason,
    offer,
    offerFlipsToStrong: offer !== null && reason === "moderate_strength",
  };
}
