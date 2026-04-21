/**
 * Weighted, reason-aware case strength engine.
 *
 * Replaces the rigid "weakest claim = overall" model with
 * family-specific evidence weighting. Missing delivery does NOT
 * automatically make a fraud case weak when payment verification
 * is strong.
 *
 * Evidence tiers per family:
 * - Critical: missing usually makes case weak
 * - Strong: heavily improves, often needed for medium+
 * - Supporting: helpful but won't tank the case
 * - Optional: nice to have
 */

import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import type {
  ArgumentMap,
  CaseStrengthResult,
  CaseStrengthLevel,
  ImprovementSignal,
} from "./types";
import { resolveReasonFamily, type ReasonFamily } from "./responseEngine";

/* ── Evidence tier definitions per family ── */

/**
 * Evidence tier values.
 *
 * `supporting_only` is a new (2026-04-21) special tier: contributes to
 * the checklist display but carries **zero weight** in the case-strength
 * aggregator. Fields tagged this way can never elevate a case to Strong
 * — they are purely corroborative. Used today for
 * `device_location_consistency`.
 */
type EvidenceTier = "critical" | "strong" | "supporting" | "optional" | "supporting_only";

interface FamilyWeights {
  [field: string]: EvidenceTier;
}

const FAMILY_WEIGHTS: Record<ReasonFamily, FamilyWeights> = {
  fraud: {
    avs_cvv_match: "critical",
    order_confirmation: "critical",
    billing_address_match: "strong",
    activity_log: "strong",
    customer_communication: "strong",
    shipping_tracking: "supporting",
    delivery_proof: "supporting",
    device_location_consistency: "supporting_only",
    refund_policy: "optional",
    shipping_policy: "optional",
    supporting_documents: "optional",
  },
  delivery: {
    shipping_tracking: "critical",
    delivery_proof: "critical",
    order_confirmation: "strong",
    customer_communication: "strong",
    shipping_policy: "supporting",
    refund_policy: "supporting",
    billing_address_match: "optional",
    avs_cvv_match: "optional",
    activity_log: "optional",
  },
  product: {
    product_description: "critical",
    refund_policy: "critical",
    customer_communication: "strong",
    order_confirmation: "strong",
    supporting_documents: "strong",
    shipping_tracking: "supporting",
    delivery_proof: "supporting",
    avs_cvv_match: "optional",
  },
  refund: {
    order_confirmation: "critical",
    refund_policy: "strong",
    customer_communication: "strong",
    supporting_documents: "supporting",
    avs_cvv_match: "optional",
  },
  subscription: {
    cancellation_policy: "critical",
    customer_communication: "strong",
    activity_log: "strong",
    order_confirmation: "supporting",
    refund_policy: "supporting",
    supporting_documents: "optional",
  },
  billing: {
    order_confirmation: "critical",
    duplicate_explanation: "critical",
    avs_cvv_match: "supporting",
    customer_communication: "supporting",
    supporting_documents: "supporting",
  },
  digital: {
    activity_log: "critical",
    order_confirmation: "strong",
    customer_communication: "strong",
    supporting_documents: "supporting",
    refund_policy: "optional",
  },
  general: {
    order_confirmation: "critical",
    avs_cvv_match: "strong",
    shipping_tracking: "strong",
    customer_communication: "supporting",
    refund_policy: "supporting",
    activity_log: "supporting",
    supporting_documents: "optional",
  },
};

/* ── Tier weights for scoring ── */

const TIER_SCORE: Record<EvidenceTier, number> = {
  critical: 40,
  strong: 25,
  supporting: 10,
  optional: 5,
  // supporting_only fields are excluded from the strength tally so they
  // cannot elevate a case to Strong by themselves. They still appear in
  // the checklist; only their contribution to case-strength is zero.
  supporting_only: 0,
};

/* ── Field labels ── */

const FIELD_LABELS: Record<string, string> = {
  order_confirmation: "order confirmation",
  billing_address_match: "billing address match",
  avs_cvv_match: "AVS/CVV verification",
  shipping_tracking: "shipping tracking",
  delivery_proof: "delivery confirmation",
  customer_communication: "customer communication",
  activity_log: "customer purchase history",
  refund_policy: "refund policy",
  shipping_policy: "shipping policy",
  cancellation_policy: "cancellation policy",
  product_description: "product description",
  duplicate_explanation: "duplicate charge explanation",
  supporting_documents: "supporting documents",
};

/* ── Strength explanation templates ── */

const STRENGTH_REASONS: Record<ReasonFamily, Record<CaseStrengthLevel, string>> = {
  fraud: {
    strong: "Payment verification and purchase behavior strongly support this defense.",
    moderate: "Core authorization evidence is present, but the case could be strengthened.",
    weak: "Key payment verification evidence is missing.",
    insufficient: "No evidence available to support this defense.",
  },
  delivery: {
    strong: "Shipment and delivery are confirmed by carrier records.",
    moderate: "Shipping evidence exists, but full delivery confirmation would strengthen the case.",
    weak: "Delivery evidence is missing — this is critical for this dispute type.",
    insufficient: "No fulfillment evidence available.",
  },
  product: {
    strong: "Product description and policy disclosure are well documented.",
    moderate: "Some product conformity evidence exists, but gaps remain.",
    weak: "Product description evidence is missing — critical for this dispute type.",
    insufficient: "No product conformity evidence available.",
  },
  refund: {
    strong: "Refund processing is documented.",
    moderate: "Some refund evidence exists, but complete documentation would help.",
    weak: "Refund evidence is incomplete.",
    insufficient: "No refund evidence available.",
  },
  subscription: {
    strong: "Subscription terms and cancellation timeline are documented.",
    moderate: "Some subscription evidence exists, but timeline gaps remain.",
    weak: "Cancellation policy or timeline evidence is missing.",
    insufficient: "No subscription-related evidence available.",
  },
  billing: {
    strong: "Transaction records confirm correct billing.",
    moderate: "Some billing evidence exists, but reconciliation could be stronger.",
    weak: "Billing accuracy evidence is incomplete.",
    insufficient: "No billing evidence available.",
  },
  digital: {
    strong: "Digital access and usage are confirmed by logs.",
    moderate: "Some access evidence exists, but logs could be more complete.",
    weak: "Digital access evidence is missing — critical for this dispute type.",
    insufficient: "No digital delivery evidence available.",
  },
  general: {
    strong: "Core evidence strongly supports this defense.",
    moderate: "Evidence supports the defense, but some gaps remain.",
    weak: "Key evidence is missing.",
    insufficient: "No evidence available.",
  },
};

/* ── Main strength calculator ── */

export function calculateCaseStrength(
  argumentMap: ArgumentMap | null,
  checklist: ChecklistItemV2[],
  reason?: string | null,
): CaseStrengthResult {
  const family = resolveReasonFamily(reason ?? argumentMap?.issuerClaim?.reasonCode);
  const weights = FAMILY_WEIGHTS[family] ?? FAMILY_WEIGHTS.general;

  if (!checklist.length) {
    return {
      overall: "insufficient",
      score: 0,
      supportedClaims: 0,
      totalClaims: argumentMap?.counterclaims.length ?? 0,
      improvementHint: null,
      strengthReason: STRENGTH_REASONS[family].insufficient,
    };
  }

  // Score each evidence item by its tier weight
  let maxScore = 0;
  let actualScore = 0;
  let criticalPresent = 0;
  let criticalTotal = 0;
  let strongPresent = 0;
  let strongTotal = 0;
  let highestMissingTier: EvidenceTier | null = null;
  let highestMissingField: string | null = null;

  for (const item of checklist) {
    const tier = weights[item.field];
    if (!tier) continue; // Not relevant to this family

    const tierScore = TIER_SCORE[tier];
    maxScore += tierScore;

    const isPresent = item.status === "available" || item.status === "waived";

    if (isPresent) {
      actualScore += tierScore;
    } else if (item.status === "missing" && (item.collectionType === "manual" || !item.collectionType)) {
      // Track highest-value missing actionable item
      if (!highestMissingTier || TIER_SCORE[tier] > TIER_SCORE[highestMissingTier]) {
        highestMissingTier = tier;
        highestMissingField = item.field;
      }
    }

    if (tier === "critical") {
      criticalTotal++;
      if (isPresent) criticalPresent++;
    }
    if (tier === "strong") {
      strongTotal++;
      if (isPresent) strongPresent++;
    }
  }

  // Determine overall strength
  let overall: CaseStrengthLevel;
  const ratio = maxScore > 0 ? actualScore / maxScore : 0;

  if (criticalTotal > 0 && criticalPresent === 0) {
    // No critical evidence at all → weak
    overall = "weak";
  } else if (criticalPresent >= criticalTotal && ratio >= 0.6) {
    // All critical evidence present + good coverage → strong
    overall = "strong";
  } else if (criticalPresent > 0 && ratio >= 0.35) {
    // Some critical present + decent coverage → moderate
    overall = "moderate";
  } else if (criticalPresent > 0) {
    // Some critical but low coverage → still moderate (not weak if critical exists)
    overall = "moderate";
  } else {
    overall = "weak";
  }

  // Build improvement hint from highest-value missing actionable item
  let improvementHint: string | null = null;
  if (overall !== "strong" && highestMissingField) {
    const label = FIELD_LABELS[highestMissingField] ?? highestMissingField;
    const tierLabel = highestMissingTier === "critical" ? "critical" : "recommended";
    improvementHint = `Add ${label} (${tierLabel}) to strengthen your case.`;
  }

  const strengthReason = STRENGTH_REASONS[family][overall];

  return {
    overall,
    score: Math.round(ratio * 100),
    supportedClaims: argumentMap?.counterclaims.filter(c => c.supporting.length > 0).length ?? 0,
    totalClaims: argumentMap?.counterclaims.length ?? 0,
    improvementHint,
    strengthReason,
  };
}

/**
 * Calculate the single highest-value improvement action.
 */
export function calculateImprovement(
  argumentMap: ArgumentMap | null,
  checklist: ChecklistItemV2[],
  reason: string | null | undefined,
): ImprovementSignal | null {
  const family = resolveReasonFamily(reason ?? argumentMap?.issuerClaim?.reasonCode);
  const weights = FAMILY_WEIGHTS[family] ?? FAMILY_WEIGHTS.general;

  // Find the highest-tier missing actionable item
  let bestField: string | null = null;
  let bestTier: EvidenceTier | null = null;
  let bestScore = 0;

  for (const item of checklist) {
    if (item.status !== "missing") continue;
    if (item.collectionType !== "manual" && item.collectionType) continue;

    const tier = weights[item.field];
    if (!tier) continue;

    const score = TIER_SCORE[tier];
    if (score > bestScore) {
      bestScore = score;
      bestField = item.field;
      bestTier = tier;
    }
  }

  if (!bestField) return null;

  const label = FIELD_LABELS[bestField] ?? bestField;

  // Estimate strength change
  const current = calculateCaseStrength(argumentMap, checklist, reason);
  if (current.overall === "strong") return null;

  const potential: CaseStrengthLevel =
    current.overall === "weak" && bestTier === "critical" ? "moderate" :
    current.overall === "moderate" ? "strong" :
    "moderate";

  return {
    currentStrength: current.overall,
    potentialStrength: potential,
    action: `Add ${label}`,
    field: bestField,
  };
}
