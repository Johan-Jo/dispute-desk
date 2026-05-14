/**
 * CE 3.0 qualification engine — orchestrates the three branches:
 *
 *   1. Auto-qualified  (Visa Secure / Data Only since 2025-10-17)
 *   2. Initial billing (subscription / MIT)
 *   3. Standard        (2 priors in 120–365d + 2 matches incl. IP/Device anchor)
 *
 * Returns a verdict with confidence + machine-readable reasons. Never
 * throws on bad input — unresolvable cases return `not_applicable` or
 * `does_not_qualify`. Pure function: caller is responsible for fetching
 * the input data (priors, initial billing) from Shopify or the DB.
 *
 * See docs/epics/EPIC-LSE-1-qualification-engine.md.
 */

import { isCE30AnchorCode } from "@/lib/disputes/reasonCodeCatalog";
import {
  buildAutoQualifiedResult,
  decideAutoQualified,
} from "./autoQualified";
import { computeMatchPoints, type MatchResult } from "./matching";
import { filterPriorsForCE30 } from "./priors";
import type {
  CE30Input,
  CE30Result,
  Confidence,
  QualificationOrder,
} from "./types";

const NOT_APPLICABLE: CE30Result = {
  verdict: "not_applicable",
  branch: "none",
  program: "none",
  matchPoints: [],
  hasAnchor: false,
  qualifyingPriors: [],
  autoQualificationVia: null,
  autoQualificationFeeApplies: false,
  confidence: null,
  confidenceReasons: [],
  missingEvidence: [],
  summary: "",
};

export function qualifyCE30(input: CE30Input): CE30Result {
  const { disputed, networkReasonCode, priors, initialSubscriptionBilling } = input;

  // Gate 1: must be Visa 10.4. CE 3.0 is Visa-only and reason-code-specific.
  if (disputed.cardNetwork !== "visa") {
    return {
      ...NOT_APPLICABLE,
      confidenceReasons: ["not_applicable:not_visa"],
      summary: "CE 3.0 applies only to Visa disputes.",
    };
  }
  if (!networkReasonCode || !isCE30AnchorCode("visa", networkReasonCode)) {
    return {
      ...NOT_APPLICABLE,
      confidenceReasons: [
        networkReasonCode
          ? `not_applicable:reason_code:${networkReasonCode}`
          : "not_applicable:unknown_reason_code",
      ],
      summary: "CE 3.0 applies only to Visa reason code 10.4.",
    };
  }

  // Branch 1: auto-qualification via Visa Secure / Data Only / merchant-confirmed 3DS.
  const autoDecision = decideAutoQualified(disputed);
  if (autoDecision.applies) {
    return buildAutoQualifiedResult(autoDecision);
  }

  // Branch 2: subscription / MIT — use the initial subscription billing transaction.
  if (disputed.subscriptionMarker) {
    if (!initialSubscriptionBilling) {
      // No prior initial billing found — fall through to standard branch.
      // Surface in confidence reasons that we tried Branch 2.
      const result = standardBranch(disputed, priors);
      return {
        ...result,
        confidenceReasons: [
          ...result.confidenceReasons,
          "subscription:no_initial_billing_found",
        ],
      };
    }
    return initialBillingBranch(disputed, initialSubscriptionBilling);
  }

  // Branch 3: standard CE 3.0.
  return standardBranch(disputed, priors);
}

/* ── Branch 2: initial subscription billing transaction ── */

function initialBillingBranch(
  disputed: QualificationOrder,
  initialBilling: QualificationOrder,
): CE30Result {
  const match: MatchResult = computeMatchPoints(disputed, [initialBilling]);

  if (match.points.length < 2) {
    return {
      verdict: "partial",
      branch: "initial_billing",
      program: "ce_30",
      matchPoints: match.points,
      hasAnchor: match.hasAnchor,
      qualifyingPriors: [initialBilling.shopifyOrderId],
      autoQualificationVia: null,
      autoQualificationFeeApplies: false,
      confidence: "low",
      confidenceReasons: [
        "branch:initial_billing",
        "insufficient_match_points",
        ...match.reasonCodes,
      ],
      missingEvidence: missingForInsufficientMatches(match),
      summary: `Disputed billing matched only ${match.points.length} data point(s) against the initial subscription billing.`,
    };
  }
  if (!match.hasAnchor) {
    return {
      verdict: "partial",
      branch: "initial_billing",
      program: "ce_30",
      matchPoints: match.points,
      hasAnchor: false,
      qualifyingPriors: [initialBilling.shopifyOrderId],
      autoQualificationVia: null,
      autoQualificationFeeApplies: false,
      confidence: "low",
      confidenceReasons: [
        "branch:initial_billing",
        "no_ip_or_device_anchor",
        ...match.reasonCodes,
      ],
      missingEvidence: ["ip_or_device_anchor"],
      summary:
        "Matches against the initial subscription billing exist but neither IP nor device anchors are present.",
    };
  }

  const confidence = computeConfidence(disputed, match, { branch: "initial_billing" });
  return {
    verdict: "qualifies_via_initial_billing",
    branch: "initial_billing",
    program: "ce_30",
    matchPoints: match.points,
    hasAnchor: true,
    qualifyingPriors: [initialBilling.shopifyOrderId],
    autoQualificationVia: null,
    autoQualificationFeeApplies: false,
    confidence: confidence.level,
    confidenceReasons: [
      "branch:initial_billing",
      ...confidence.reasons,
      ...match.reasonCodes,
    ],
    missingEvidence: [],
    summary: `CE 3.0 qualifies via initial subscription billing transaction (${match.points.length} matching points: ${match.points.join(", ")}).`,
  };
}

/* ── Branch 3: standard CE 3.0 (2 priors + 2 matches + anchor) ── */

function standardBranch(
  disputed: QualificationOrder,
  candidates: QualificationOrder[],
): CE30Result {
  const filtered = filterPriorsForCE30(disputed, candidates);

  if (filtered.eligible.length < 2) {
    return {
      verdict: filtered.eligible.length === 0 ? "does_not_qualify" : "partial",
      branch: filtered.eligible.length === 0 ? "none" : "standard",
      program: "ce_30",
      matchPoints: [],
      hasAnchor: false,
      qualifyingPriors: filtered.eligible.map((e) => e.shopifyOrderId),
      autoQualificationVia: null,
      autoQualificationFeeApplies: false,
      confidence: filtered.eligible.length === 0 ? null : "low",
      confidenceReasons: [
        filtered.eligible.length === 0
          ? "no_eligible_priors_in_window"
          : "fewer_than_two_priors",
        ...exclusionReasonsToCodes(filtered.excluded),
      ],
      missingEvidence:
        filtered.eligible.length === 0
          ? ["two_priors_in_120_365_day_window"]
          : ["second_prior_in_120_365_day_window"],
      summary:
        filtered.eligible.length === 0
          ? "No eligible prior transactions in the 120–365 day window."
          : "Only one eligible prior transaction in the 120–365 day window.",
    };
  }

  // Use the two most recent eligible priors as the matching set. Visa's
  // rule requires the match to hold *across all three* (disputed + both
  // priors), so we require matchesInPriors=2.
  const qualifyingPriors = filtered.eligible.slice(0, 2);
  const match = computeMatchPoints(disputed, qualifyingPriors, {
    requireMatchesInPriors: qualifyingPriors.length,
  });

  if (match.points.length < 2) {
    return {
      verdict: "partial",
      branch: "standard",
      program: "ce_30",
      matchPoints: match.points,
      hasAnchor: match.hasAnchor,
      qualifyingPriors: qualifyingPriors.map((p) => p.shopifyOrderId),
      autoQualificationVia: null,
      autoQualificationFeeApplies: false,
      confidence: "low",
      confidenceReasons: [
        "insufficient_match_points",
        ...match.reasonCodes,
      ],
      missingEvidence: missingForInsufficientMatches(match),
      summary: `Disputed transaction matched only ${match.points.length} data point(s) across the two priors.`,
    };
  }
  if (!match.hasAnchor) {
    return {
      verdict: "does_not_qualify",
      branch: "standard",
      program: "ce_30",
      matchPoints: match.points,
      hasAnchor: false,
      qualifyingPriors: qualifyingPriors.map((p) => p.shopifyOrderId),
      autoQualificationVia: null,
      autoQualificationFeeApplies: false,
      confidence: null,
      confidenceReasons: ["no_ip_or_device_anchor", ...match.reasonCodes],
      missingEvidence: ["ip_or_device_anchor"],
      summary:
        "Two matching points were found but neither was IP nor device — CE 3.0 requires at least one as the anchor.",
    };
  }

  const confidence = computeConfidence(disputed, match, { branch: "standard" });
  return {
    verdict: "qualifies",
    branch: "standard",
    program: "ce_30",
    matchPoints: match.points,
    hasAnchor: true,
    qualifyingPriors: qualifyingPriors.map((p) => p.shopifyOrderId),
    autoQualificationVia: null,
    autoQualificationFeeApplies: false,
    confidence: confidence.level,
    confidenceReasons: [...confidence.reasons, ...match.reasonCodes],
    missingEvidence: [],
    summary: `CE 3.0 qualifies via standard branch (${match.points.length} matching points: ${match.points.join(", ")}).`,
  };
}

/* ── Confidence scoring ── */

function computeConfidence(
  disputed: QualificationOrder,
  match: MatchResult,
  ctx: { branch: "initial_billing" | "standard" },
): { level: Confidence; reasons: string[] } {
  const reasons: string[] = [];

  // Guest checkout caps verdict at low.
  if (!disputed.customerId) {
    reasons.push("guest_checkout");
  }

  // Match-strength signals.
  const hasSubnetIp = match.reasonCodes.includes("ip_match:subnet_only");
  const hasNormalizedShipping = match.reasonCodes.includes(
    "shipping_match:normalized_only",
  );

  // Anchor count: 1 anchor (IP only OR device only) is weaker than both.
  const anchorCount = (match.points.includes("ip") ? 1 : 0) + (match.points.includes("device") ? 1 : 0);
  const nonAnchorCount = match.points.length - anchorCount;
  if (anchorCount === 1 && nonAnchorCount === 1) {
    reasons.push("single_anchor");
  }

  // B2B data-quality warning when shipping is normalized-only AND we're using
  // a commercial Visa card. We can't reliably detect "commercial" from the
  // current order shape (Shopify's paymentDetails.company is just "Visa").
  // Surface a generic data-quality warning instead — refined in LSE-1 v1.1.
  if (hasNormalizedShipping) {
    reasons.push("shipping_match:normalized_only_data_quality_warning");
  }

  // Determine level.
  let level: Confidence;
  if (!disputed.customerId) {
    level = "low";
  } else if (hasSubnetIp || hasNormalizedShipping || anchorCount === 1) {
    level = "medium";
  } else {
    level = match.points.length >= 3 ? "high" : "medium";
  }

  if (ctx.branch === "initial_billing") {
    // Initial-billing branch matches against a single transaction; we never
    // claim "high" here without strong signal.
    if (level === "high") level = "medium";
  }

  return { level, reasons };
}

/* ── Helpers ── */

function missingForInsufficientMatches(match: MatchResult): string[] {
  const allPoints = ["ip", "device", "shipping", "account"] as const;
  const missing = allPoints.filter((p) => !match.points.includes(p));
  // Surface the most diagnostic items first.
  return missing.map((m) => `match_point:${m}`).slice(0, 2);
}

function exclusionReasonsToCodes(
  excluded: Array<{ orderId: string; reason: string }>,
): string[] {
  const codes = new Set<string>();
  for (const e of excluded) {
    if (e.reason.startsWith("too_recent")) codes.add("prior_excluded:too_recent");
    else if (e.reason.startsWith("too_old")) codes.add("prior_excluded:too_old");
    else codes.add(`prior_excluded:${e.reason}`);
  }
  return [...codes];
}
