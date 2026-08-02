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

export interface HeldStateInput extends AutoSubmitGuardInput {
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
