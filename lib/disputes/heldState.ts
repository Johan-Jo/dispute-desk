/**
 * heldState — what "held" means for an Auto-pilot dispute, in one place.
 *
 * WHY THIS EXISTS. An auto-mode case that the guards park (Moderate) or block
 * (Weak / Insufficient) is not waiting for a merchant decision: it is waiting
 * for a clock. `defence_packages` stays `draft / validation_status=ok /
 * pdf_path`, and at 08:00 UTC on the due date
 * `app/api/cron/defence-package-deadline-submit` finalizes exactly that shape
 * and saves it to Shopify. Three surfaces describe this state — the
 * new-dispute email, the dispute Overview, and the Automation/onboarding
 * cards — and before this module they each phrased it their own way. The email
 * asked for a "review" the page offered no control for, and named a concede
 * action that only renders in review mode.
 *
 * So the state is derived ONCE here and the copy hangs off the result.
 *
 * It also answers the second half of the question the merchant actually has:
 * *is there anything I can do?* For a held case there is exactly one genuine
 * contribution — a cardholder acknowledgement. Pasting a message in which the
 * cardholder confirms they placed / received the order writes
 * `payload.customerConfirmsOrder === true`
 * (`app/api/packs/[packId]/cardholder-acknowledgement/route.ts`), which the
 * canonical categorizer treats as the discriminator that elevates
 * `customer_communication` supporting → strong. Everything else on a held
 * fraud case is gateway-, carrier- or Shopify-derived and cannot be supplied
 * by hand.
 *
 * PURE — no DB, no I/O. The strength ladder is NOT restated here: this module
 * reads the ONE canonical `CaseAutomationDecision`, the same object the
 * pipeline, the defence-package job, the reconcile pass and the deadline cron
 * read (CP-C). Re-deriving it is precisely the drift the canonical decision was
 * created to end — and before it, five ladders answered this question five
 * ways.
 *
 * WHY THE DECISION ANSWERS "held". "Held" is not a fifth state; it is what ONE
 * of the decision's outcomes MEANS to a merchant on Auto-pilot, read at two
 * different reason codes (contract revision 2 — weak no longer blocks):
 *   hold_for_deadline + strength_insufficient  → weak_strength
 *   hold_for_deadline, any other reason        → moderate_strength
 * Everything else — coverage, fatal-loss, review mode, a hard block — has its
 * own copy elsewhere and is deliberately NOT held.
 */

import type { CaseAssessmentSnapshot, GateDecision } from "@/lib/pipeline/contracts";
import { canonicalPipelineEnabled } from "@/lib/pipeline/activation";
import { resolveHeldStateLegacy } from "./heldState.legacy";
import {
  AUTOMATION_POLICY_VERSION,
  deriveCaseAutomationDecision,
  gateDecisionFromFacts,
  type AutomationGateFacts,
  type RawGateFacts,
} from "@/lib/automation/decision";

/**
 * The gate facts a held-state caller has to hand: the decision's own
 * `AutomationGateFacts` (credit-already-issued), the two raw gate values that
 * contract revision 1 turned into `CaseAssessmentSnapshot.gateDecision`, and
 * the pack's recorded strength band, which the decision reads off the
 * assessment.
 *
 * CONTRACT REVISION 1. `AutomationGateFacts` used to carry `coverageState` and
 * `fatalLoss`; they now live on the assessment as one named `gateDecision`.
 * They stay on THIS interface because a held-state caller holds two `pack_json`
 * values, not an assessment — the projection happens here, through the shared
 * `gateDecisionFromFacts`, so this module cannot form its own opinion of what
 * "covered" means.
 */
export interface HeldGuardInput extends AutomationGateFacts, RawGateFacts {
  /** `pack_json.case_strength.overall`. */
  caseStrength: string | null | undefined;
}

/** Why the case is held. Both end in the same place (saved on the due date);
 *  they differ in what we can honestly promise about improving it. */
export type HeldReason = "moderate_strength" | "weak_strength";

/** The one merchant contribution a held case can actually take. */
export type HeldOffer = "cardholder_acknowledgement";

export interface HeldState {
  /** Auto mode AND the shared guards declined to submit on strength. */
  held: boolean;
  reason: HeldReason | null;
  /** Non-null only when the acknowledgement CTA would really be reachable. */
  offer: HeldOffer | null;
  /**
   * True when providing the offer is guaranteed to reach "strong" — i.e. the
   * case is Moderate, which by `calculateCaseStrength` means at least one
   * strong signal is already counted, so a strong `communication` signal makes
   * `strongCount >= 2`. Weak cases get the honest weaker claim instead.
   */
  offerFlipsToStrong: boolean;
}

export interface AcknowledgementOfferInput {
  /**
   * True when the MERCHANT has already supplied a cardholder acknowledgement
   * for this pack — not merely when the `customer_communication` row has
   * something in it.
   *
   * The card used to hide on `EvidenceLineItem.hasEvidence` (checklist row
   * `available`/`waived`). That conflates two different things, and prod
   * showed the cost: 11 of blume-box's 17 open WEAK disputes had the row
   * flipped `available` by an auto-collected `shopify_timeline` order note
   * with no `customerConfirmsOrder`, contributing nothing to strength. Those
   * are the cases with ZERO strong signals — the ones an acknowledgement
   * could actually move — and the CTA was hidden on every one of them.
   *
   * The original reason for the wide gate still holds and is preserved: a
   * merchant who pasted an acknowledgement that the categorizer kept at
   * `supporting` must not be invited to redo the work. That is why this keys
   * on the acknowledgement MARKER (or an explicit confirmation), not on
   * whether the result scored strong.
   */
  merchantSuppliedAcknowledgement: boolean;
  /** `disputes.submission_state` — the resubmission window is closed once
   *  Shopify has forwarded to the bank. */
  submissionState?: string | null;
  /** `disputes.final_outcome` — terminal disputes take no new evidence. */
  finalOutcome?: string | null;
}

export interface HeldStateInput extends HeldGuardInput {
  /** Resolved rule mode for this dispute (`normalizeMode` output). */
  automationMode: "auto" | "review" | null;
  /** Offer facts. Omit to resolve `held` without an offer. */
  acknowledgement?: AcknowledgementOfferInput | null;
}

/** The `evidence_items.payload` shape this module reads. */
export interface EvidenceItemPayloadRow {
  payload?: Record<string, unknown> | null;
}

/**
 * Written ONLY by `app/api/packs/[packId]/cardholder-acknowledgement/route.ts`
 * — i.e. by the merchant, through the acknowledgement form.
 */
const ACKNOWLEDGEMENT_KIND = "cardholder_acknowledgement";

/**
 * Has the merchant already supplied a cardholder acknowledgement for this pack?
 *
 * Two accepted markers:
 *   - `payload.kind === "cardholder_acknowledgement"` — the form's own stamp.
 *     Present whatever the categorizer later decided, so a paste that stayed
 *     `supporting` still counts as "done" and is not re-requested.
 *   - `payload.customerConfirmsOrder === true` — the decisive discriminator,
 *     which a Gorgias conversation the merchant approved can also carry.
 *
 * Auto-collected communications (`shopify_timeline` order notes, unconfirmed
 * Gorgias threads) carry NEITHER, so they no longer suppress the offer.
 */
export function merchantSuppliedAcknowledgementFromItems(
  items: ReadonlyArray<EvidenceItemPayloadRow> | null | undefined,
): boolean {
  return (items ?? []).some((item) => {
    const p = item?.payload;
    if (!p || typeof p !== "object") return false;
    return (
      (p as Record<string, unknown>).kind === ACKNOWLEDGEMENT_KIND ||
      (p as Record<string, unknown>).customerConfirmsOrder === true
    );
  });
}

/**
 * Written ONLY by `app/api/packs/[packId]/parcel-outcome/route.ts` — i.e.
 * by the merchant, through the returned-parcel form.
 */
const PARCEL_OUTCOME_KIND = "returned_parcel_outcome";

/** Has the merchant already answered the returned-parcel question? */
export function merchantAnsweredParcelOutcomeFromItems(
  items: ReadonlyArray<EvidenceItemPayloadRow> | null | undefined,
): boolean {
  return (items ?? []).some(
    (item) =>
      !!item?.payload &&
      typeof item.payload === "object" &&
      (item.payload as Record<string, unknown>).kind === PARCEL_OUTCOME_KIND,
  );
}

export interface ParcelOutcomeOfferInput {
  /** A carrier returned a shipment on this order to the merchant. */
  returnedToSender: boolean;
  merchantAnsweredParcelOutcome: boolean;
  submissionState: string | null | undefined;
  finalOutcome: string | null | undefined;
}

/**
 * Would the returned-parcel question render? THE ONE gate, for the same
 * reason `canOfferCardholderAcknowledgement` below is: a surface that
 * invites an action the card hides — or that hides while the card is on
 * screen — is the failure mode this shape exists to prevent.
 *
 * Note the first condition. The question is only ever asked about a
 * parcel that actually came back; asking it otherwise would be a demand
 * the merchant cannot satisfy, which is exactly what the checklist's
 * `required_if_returned_to_sender` mode also encodes.
 */
export function canOfferParcelOutcome(input: ParcelOutcomeOfferInput): boolean {
  if (!input.returnedToSender) return false;
  if (input.merchantAnsweredParcelOutcome) return false;
  if (input.submissionState === "submitted_confirmed") return false;
  if (input.finalOutcome) return false;
  return true;
}

/**
 * Would the cardholder-acknowledgement CTA render? This is the ONE gate;
 * `CardholderAcknowledgementCard` calls it too, so a surface can never invite
 * an action the card hides (or stay silent while the card is on screen).
 */
export function canOfferCardholderAcknowledgement(
  input: AcknowledgementOfferInput,
): boolean {
  if (input.merchantSuppliedAcknowledgement) return false;
  if (input.submissionState === "submitted_confirmed") return false;
  if (input.finalOutcome) return false;
  return true;
}

/**
 * This module is pure and its output is never persisted, so `computedAt` has no
 * reader. A constant keeps it out of any accidental hash and out of snapshot
 * churn; see the time-invariance rule in the automation-decision contract.
 */
const HELD_STATE_COMPUTED_AT = "1970-01-01T00:00:00.000Z";

/**
 * The minimum assessment the held question needs: the recorded strength band,
 * and nothing that could make another rung of the ladder fire.
 */
function heldAssessment(
  caseStrength: string | null | undefined,
  gateDecision: GateDecision,
): CaseAssessmentSnapshot {
  const overall =
    caseStrength === "strong" ||
    caseStrength === "moderate" ||
    caseStrength === "weak" ||
    caseStrength === "insufficient"
      ? caseStrength
      : // A pack built before `case_strength` existed is not held — the same
        // fall-through every caller had before the canonical decision.
        ("strong" as const);
  return {
    caseId: "held-state",
    assessmentVersion: 1,
    strength: {
      overall,
      score: 0,
      coveragePercent: 0,
      strongCount: 0,
      moderateCount: 0,
      supportingCount: 0,
      supportedClaims: 0,
      totalClaims: 0,
      strengthReasonI18n: { key: "automation.decision.projectedStrength" },
      improvementHintI18n: null,
      heroVariant:
        overall === "strong"
          ? "likely_to_win"
          : overall === "moderate"
            ? "could_win"
            : "hard_to_win",
    },
    completeness: {
      score: 100,
      evidenceStrengthScore: 100,
      readiness: "ready",
      blockers: [],
    },
    /**
     * WHICH gate decided the case, projected from the caller's two raw values
     * by the shared `gateDecisionFromFacts`.
     *
     * CONTRACT REVISION 1. This used to be `gateDecided: boolean` plus a
     * separate `coverageState` / `fatalLoss` pair on the decision's gate facts.
     * Carrying the named gate on the assessment is what lets rungs 1 and 2 of
     * the ladder answer coverage and fatal-loss for this module too, instead of
     * `resolveHeldState` re-deriving "is it covered" a second way. Both return
     * `block` with their own reason code, which maps to no `HeldReason` below —
     * so a covered or fatally-lost case is still NOT held, and now it is not
     * held for the reason the rest of the product gives.
     */
    gateDecision,
    /** Held-ness is a STRENGTH question. The synthetic case carries no plan. */
    reviewRequiredCount: 0,
    /** Not derived from a `CaseEvidenceModel` — see `assessmentFromPackRow`. */
    modelVersion: 0,
    freshness: {
      inputHash: "held-state",
      policyVersion: AUTOMATION_POLICY_VERSION,
      computedAt: HELD_STATE_COMPUTED_AT,
    },
  };
}

/**
 * Resolve the held state. Coverage and fatal-loss are NOT "held": they have
 * their own dedicated copy (Shopify Protect / hard-to-win) and no amount of
 * merchant evidence changes them, so they return `held: false` and are left
 * to the surfaces that already handle them.
 */
export function resolveHeldState(input: HeldStateInput): HeldState {
  // DARK UNTIL PR 3. The canonical ladder below answers weak/insufficient with
  // `hold_for_deadline` (contract revision 2) where the shipped one answers
  // `block`; both produce `weak_strength`, but only through different actions,
  // and the difference is visible at every other reader of the same decision.
  // Until the switch flips, the shipped ladder runs — the same code, not a
  // re-expression of it.
  if (!canonicalPipelineEnabled()) return resolveHeldStateLegacy(input);

  const none: HeldState = {
    held: false,
    reason: null,
    offer: null,
    offerFlipsToStrong: false,
  };

  if (input.automationMode !== "auto") return none;

  const decision = deriveCaseAutomationDecision({
    caseId: "held-state",
    assessment: heldAssessment(
      input.caseStrength,
      gateDecisionFromFacts({
        coverageState: input.coverageState,
        fatalLoss: input.fatalLoss,
        returnedToSender: input.returnedToSender,
      }),
    ),
    assessmentFreshness: { fresh: true },
    policy: {
      version: AUTOMATION_POLICY_VERSION,
      autoSaveEnabled: true,
      // Held-ness is a STRENGTH question, not a completeness one. The synthetic
      // assessment sits at the ceiling on both so the completeness and
      // hard-block rungs cannot fire and change the answer — the caller has
      // neither value to hand, and inventing one would make this module
      // disagree with the pipeline about the same dispute.
      completenessThreshold: 0,
      enforceNoBlockers: false,
    },
    automationMode: "auto",
    gates: { creditAlreadyIssued: input.creditAlreadyIssued },
    evidenceDueAt: null,
    computedAt: HELD_STATE_COMPUTED_AT,
  });

  /*
   * CONTRACT REVISION 2. Weak / insufficient used to come back as `block` with
   * `strength_insufficient`, so the two held reasons were told apart by the
   * ACTION. They no longer are: strength is an odds judgement and odds never
   * withhold a filing, so weak now HOLDS for the deadline exactly as moderate
   * does. Both reasons arrive as `hold_for_deadline` and the REASON CODE is the
   * discriminator.
   *
   * That is the more honest reading anyway — the two states always did end in
   * the same place (saved on the due date) and differed only in what we can
   * promise about improving them, which is a reason, not an action.
   */
  let reason: HeldReason | null = null;
  if (decision.action === "hold_for_deadline") {
    reason = decision.reasonCodes.includes("strength_insufficient")
      ? "weak_strength"
      : "moderate_strength";
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
