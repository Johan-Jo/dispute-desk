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
 * calls `evaluateAutoSubmitGuards`, the same function the pipeline and the
 * defence-package job call. Re-deriving it is precisely the drift that guard
 * module was created to end.
 */

import {
  evaluateAutoSubmitGuards,
  type AutoSubmitGuardInput,
} from "@/lib/automation/autoSubmitGuards";

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
   * True when the `customer_communication` row already has evidence (checklist
   * status `available` or `waived`). Mirrors `EvidenceLineItem.hasEvidence`,
   * which is what `CardholderAcknowledgementCard` gates on — deliberately NOT
   * "is it already strong", because the categorizer can keep a provided
   * conversation at supporting and we must not re-ask for work already done.
   */
  communicationHasEvidence: boolean;
  /** `disputes.submission_state` — the resubmission window is closed once
   *  Shopify has forwarded to the bank. */
  submissionState?: string | null;
  /** `disputes.final_outcome` — terminal disputes take no new evidence. */
  finalOutcome?: string | null;
}

export interface HeldStateInput extends AutoSubmitGuardInput {
  /** Resolved rule mode for this dispute (`normalizeMode` output). */
  automationMode: "auto" | "review" | null;
  /** Offer facts. Omit to resolve `held` without an offer. */
  acknowledgement?: AcknowledgementOfferInput | null;
}

/** Checklist row shape shared by `checklist_v2` consumers. */
export interface ChecklistStatusRow {
  field: string;
  status: string;
}

const COMMUNICATION_FIELD = "customer_communication";
const HAS_EVIDENCE_STATUSES = new Set(["available", "waived"]);

/**
 * Server-side equivalent of `EvidenceLineItem.hasEvidence` for the
 * communication row, read straight off `evidence_packs.checklist_v2`.
 * A missing row means nothing has been collected, so the offer stands
 * (same as the card, whose `ccRow?.hasEvidence` is undefined → falsy).
 */
export function communicationHasEvidenceFromChecklist(
  checklist: ReadonlyArray<ChecklistStatusRow> | null | undefined,
): boolean {
  const row = checklist?.find((c) => c.field === COMMUNICATION_FIELD);
  return row ? HAS_EVIDENCE_STATUSES.has(row.status) : false;
}

/**
 * Would the cardholder-acknowledgement CTA render? This is the ONE gate;
 * `CardholderAcknowledgementCard` calls it too, so a surface can never invite
 * an action the card hides (or stay silent while the card is on screen).
 */
export function canOfferCardholderAcknowledgement(
  input: AcknowledgementOfferInput,
): boolean {
  if (input.communicationHasEvidence) return false;
  if (input.submissionState === "submitted_confirmed") return false;
  if (input.finalOutcome) return false;
  return true;
}

/**
 * Resolve the held state. Coverage and fatal-loss are NOT "held": they have
 * their own dedicated copy (Shopify Protect / hard-to-win) and no amount of
 * merchant evidence changes them, so they return `held: false` and are left
 * to the surfaces that already handle them.
 */
export function resolveHeldState(input: HeldStateInput): HeldState {
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
