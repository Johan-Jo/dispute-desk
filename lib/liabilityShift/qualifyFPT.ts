/**
 * Mastercard First-Party Trust readiness engine.
 *
 * Unlike CE 3.0, FPT does NOT require prior transactions. The check is
 * whether the merchant has sufficient evidence across Device, Delivery,
 * and Identity to support a Mastercard-issuer-side first-party-fraud
 * defense.
 *
 * Gates (in order):
 *   1. Card network must be Mastercard
 *   2. Reason code must be on the FPT-eligible list (4837, 4863)
 *   3. Merchant region must be FPT-available (US since 2024-10, LATAM
 *      + CA + APAC since 2025-06; EU not yet)
 *   4. All three categories must score > 0 AND sum ≥ 2.0 → `ready`
 *
 * See docs/epics/EPIC-LSE-3-fpt-readiness.md.
 */

import { isFPTEligibleCode } from "@/lib/disputes/reasonCodeCatalog";
import {
  FPT_READY_TOTAL_THRESHOLD,
  scoreDeliveryEvidence,
  scoreDeviceEvidence,
  scoreIdentityEvidence,
  type FPTScoreInput,
} from "./fptCategories";
import { isFPTRegion } from "./fptRegions";
import type {
  Confidence,
  FPTCategory,
  FPTCategoryScore,
  FPTResult,
  QualificationOrder,
} from "./types";

export interface FPTInput {
  disputed: QualificationOrder;
  /** Resolved Mastercard network reason code from LSE-0. */
  networkReasonCode: string | null;
  /** Merchant's shop country code (ISO 3166-1 alpha-2). */
  shopCountryCode: string | null;
  customerTenureDays?: number | null;
  priorOrderCount?: number;
  hasDeliveryConfirmation?: boolean;
  sessionData?: FPTScoreInput["sessionData"];
}

const NOT_APPLICABLE: FPTResult = {
  verdict: "not_applicable",
  program: "none",
  categories: {
    device: { category: "device", score: 0, signals: [] },
    delivery: { category: "delivery", score: 0, signals: [] },
    identity: { category: "identity", score: 0, signals: [] },
  },
  totalScore: 0,
  reasonCode: null,
  regionEligible: false,
  confidence: null,
  confidenceReasons: [],
  missingEvidence: [],
  summary: "",
};

export function qualifyFPT(input: FPTInput): FPTResult {
  const { disputed, networkReasonCode, shopCountryCode } = input;

  // Gate 1: Mastercard only.
  if (disputed.cardNetwork !== "mastercard") {
    return {
      ...NOT_APPLICABLE,
      confidenceReasons: ["not_applicable:not_mastercard"],
      summary: "FPT applies only to Mastercard disputes.",
    };
  }

  // Gate 2: reason code must be FPT-eligible.
  if (!networkReasonCode || !isFPTEligibleCode("mastercard", networkReasonCode)) {
    return {
      ...NOT_APPLICABLE,
      confidenceReasons: [
        networkReasonCode
          ? `not_applicable:reason_code:${networkReasonCode}`
          : "not_applicable:unknown_reason_code",
      ],
      summary: "FPT applies only to Mastercard reason codes 4837 and 4863.",
    };
  }

  // Gate 3: region.
  const regionCheck = isFPTRegion(shopCountryCode, disputed.createdAt);
  if (!regionCheck.eligible) {
    return {
      ...NOT_APPLICABLE,
      reasonCode: networkReasonCode,
      regionEligible: false,
      confidenceReasons: [`not_applicable:${regionCheck.reason}`],
      summary: `FPT is not yet available in this region (${shopCountryCode ?? "unknown"}).`,
    };
  }

  // Score categories.
  const scoreInput: FPTScoreInput = {
    disputed,
    sessionData: input.sessionData ?? null,
    customerTenureDays: input.customerTenureDays ?? null,
    priorOrderCount: input.priorOrderCount ?? 0,
    hasDeliveryConfirmation: input.hasDeliveryConfirmation ?? false,
  };
  const device = scoreDeviceEvidence(scoreInput);
  const delivery = scoreDeliveryEvidence(scoreInput);
  const identity = scoreIdentityEvidence(scoreInput);

  const total = device.score + delivery.score + identity.score;
  const allPositive = device.score > 0 && delivery.score > 0 && identity.score > 0;

  let verdict: FPTResult["verdict"];
  let confidence: Confidence | null = null;
  const missing: string[] = [];
  const reasons: string[] = [];

  if (allPositive && total >= FPT_READY_TOTAL_THRESHOLD) {
    verdict = "ready";
    confidence = total >= 2.5 ? "high" : "medium";
  } else if (allPositive && total >= 1.2) {
    verdict = "partial";
    confidence = "low";
    reasons.push("overall_too_weak");
    if (device.score < 0.3) missing.push("device_signals_too_weak");
    if (delivery.score < 0.3) missing.push("delivery_signals_too_weak");
    if (identity.score < 0.3) missing.push("identity_signals_too_weak");
  } else if (!allPositive) {
    verdict = "partial";
    reasons.push("category_empty");
    if (device.score === 0) missing.push("device_category_empty");
    if (delivery.score === 0) missing.push("delivery_category_empty");
    if (identity.score === 0) missing.push("identity_category_empty");
  } else {
    verdict = "not_ready";
    reasons.push("overall_below_partial_threshold");
  }

  return {
    verdict,
    program: "fpt",
    categories: {
      device,
      delivery,
      identity,
    } as Record<FPTCategory, FPTCategoryScore>,
    totalScore: total,
    reasonCode: networkReasonCode,
    regionEligible: true,
    confidence,
    confidenceReasons: reasons,
    missingEvidence: missing,
    summary: summarize(verdict, networkReasonCode, total),
  };
}

function summarize(
  verdict: FPTResult["verdict"],
  reason: string,
  total: number,
): string {
  if (verdict === "ready") {
    return `Ready for Mastercard FPT (reason ${reason}, total score ${total.toFixed(2)} / 3.0).`;
  }
  if (verdict === "partial") {
    return `Partial Mastercard FPT readiness (reason ${reason}, total ${total.toFixed(2)} / 3.0).`;
  }
  if (verdict === "not_ready") {
    return `Mastercard FPT evidence is too weak (total ${total.toFixed(2)} / 3.0).`;
  }
  return "FPT not applicable.";
}
