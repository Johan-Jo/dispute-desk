/**
 * CE 3.0 Branch 1: Visa Secure / Data Only auto-qualification.
 *
 * Effective 2025-10-17, Visa automatically pre-qualifies for CE 3.0 any
 * transaction authenticated via Visa Secure (3DS2 with cardholder
 * challenge) or Visa Data Only (frictionless 3DS data exchange).
 * Effective 2026-04-17, Visa charges a per-qualification fee for
 * successful auto-qualifications (paid through the acquirer).
 *
 * This branch short-circuits the standard 2-priors-plus-anchor logic
 * when the disputed transaction's 3DS state is `authenticated === true`.
 * The merchant still submits rebuttal evidence, but the qualification
 * metadata is already attached at the network level.
 *
 * See docs/epics/EPIC-LSE-1-qualification-engine.md § Branch 1.
 */

import type {
  CE30Result,
  QualificationOrder,
  AutoQualificationVia,
} from "./types";
import { AUTO_QUALIFICATION_FEE_EFFECTIVE_DATE } from "./types";

export interface AutoQualifiedDecision {
  applies: boolean;
  via: AutoQualificationVia | null;
  feeApplies: boolean;
  reason: string;
}

/**
 * Decide whether the disputed order auto-qualifies for CE 3.0 via 3DS.
 * Visa-only: Mastercard 3DS authentication does NOT trigger CE 3.0
 * auto-qualification (CE 3.0 is Visa-only). Mastercard 3DS is handled
 * separately by FPT (LSE-3).
 */
export function decideAutoQualified(disputed: QualificationOrder): AutoQualifiedDecision {
  if (disputed.cardNetwork !== "visa") {
    return {
      applies: false,
      via: null,
      feeApplies: false,
      reason: "auto_qualification:not_visa",
    };
  }

  const tds = disputed.threeDSecure;
  if (!tds) {
    return {
      applies: false,
      via: null,
      feeApplies: false,
      reason: "auto_qualification:no_3ds_signal",
    };
  }

  if (tds.authenticated !== true) {
    return {
      applies: false,
      via: null,
      feeApplies: false,
      reason: "auto_qualification:not_authenticated",
    };
  }

  let via: AutoQualificationVia;
  if (tds.merchantConfirmed) {
    via = "merchant_confirmed";
  } else if (tds.dataOnly) {
    via = "visa_data_only";
  } else {
    via = "visa_secure";
  }

  return {
    applies: true,
    via,
    feeApplies: feeAppliesOn(disputed.createdAt),
    reason: `auto_qualification:applies:${via}`,
  };
}

/**
 * Visa's per-qualification fee starts on 2026-04-17 — any disputed
 * transaction created on or after that date with auto-qualification
 * carries the fee.
 */
export function feeAppliesOn(disputedAt: string): boolean {
  const dispute = new Date(disputedAt);
  const effective = new Date(`${AUTO_QUALIFICATION_FEE_EFFECTIVE_DATE}T00:00:00Z`);
  if (Number.isNaN(dispute.getTime()) || Number.isNaN(effective.getTime())) {
    return false;
  }
  return dispute.getTime() >= effective.getTime();
}

/** Build the CE30Result for a successful auto-qualification. */
export function buildAutoQualifiedResult(
  decision: AutoQualifiedDecision,
): CE30Result {
  if (!decision.applies || !decision.via) {
    throw new Error("buildAutoQualifiedResult called for non-applying decision");
  }
  return {
    verdict: "qualifies_network_prequalified",
    branch: "auto_qualified",
    program: "ce_30",
    matchPoints: [],
    hasAnchor: false,
    qualifyingPriors: [],
    autoQualificationVia: decision.via,
    autoQualificationFeeApplies: decision.feeApplies,
    confidence: "high",
    confidenceReasons: [decision.reason],
    missingEvidence: [],
    summary:
      decision.via === "visa_data_only"
        ? "Visa pre-qualified this dispute for CE 3.0 via Visa Data Only authentication."
        : decision.via === "merchant_confirmed"
          ? "CE 3.0 auto-qualified via merchant-confirmed 3-D Secure."
          : "Visa pre-qualified this dispute for CE 3.0 via Visa Secure (3DS2).",
  };
}
