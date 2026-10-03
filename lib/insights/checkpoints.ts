/**
 * Operational Checkpoints — rule engine.
 *
 * Pure functions only. Given a `CheckpointInput`, returns a sorted +
 * capped list of observations citing either network rules or the
 * merchant's own prior baseline.
 *
 * ─── Sources (verified 2026-05-11) ─────────────────────────────────
 *
 *   - Visa Acquirer Monitoring Program (VAMP), effective April 1 2026:
 *     merchant Excessive ratio is 1.5% (count-based: TC40 fraud + TC15
 *     disputes ÷ TC05 settled, CNP). Exclusion floor: <1,500 combined
 *     disputes+fraud per month. Fine: $8 per disputed/fraudulent txn
 *     at Excessive.
 *     • Visa fact sheet (2025): https://corporate.visa.com/content/dam/VCOM/corporate/visa-perspectives/security-and-trust/documents/visa-acquirer-monitoring-program-fact-sheet-2025.pdf
 *
 *   - Mastercard Excessive Chargeback Merchant (ECM): 1.5% CTR AND
 *     100+ chargebacks per calendar month. HECM: 3.0% CTR AND 300+
 *     chargebacks per month. Exit: 3 consecutive months under
 *     thresholds. Lagged denominator (current-month chargebacks vs
 *     prior-month sales).
 *     • Mastercard rules guide (J.P. Morgan reseller copy):
 *       https://www.jpmorgan.com/content/dam/jpm/merchant-services/payment-network-updates/documents/mastercard-excessive-chargeback-program-guide.pdf
 *
 *   - Visa 3-D Secure liability shift: authenticated CNP card
 *     payments shift fraud-chargeback liability from the merchant to
 *     the card issuer. (Established Visa rule, predates CE3.0.)
 *
 *   - Visa Compelling Evidence 3.0 (CE3.0): NOT cited here. CE3.0 is
 *     about historical-footprint matching (2 prior transactions 120–
 *     365 days old, 2 matching data points incl. IP or device ID),
 *     not signature confirmation. Signature is general delivery
 *     evidence under traditional CNP dispute rules.
 *
 * ─── RECHECK_RULES ─────────────────────────────────────────────────
 *
 * Card networks refresh these thresholds periodically. The numbers
 * live in `programmeThresholds.ts` (the only threshold table); a
 * recheck is tracked as FU-1 of docs/plans/insights-single-source.plan.md.
 *
 * Last verified: 2026-05-11.
 */

import type {
  Checkpoint,
  CheckpointInput,
  CheckpointSeverity,
  CheckpointValue,
} from "./checkpoints.types";
import {
  MC_ECM_COUNT_FLOOR,
  MC_ECM_RATIO,
  VAMP_COUNT_FLOOR,
  VAMP_EARLY_WARNING,
  VAMP_EXCESSIVE,
  ecmSeverity,
  vampSeverity,
} from "./programmeThresholds";

// ─── Operational-attention thresholds (DisputeDesk heuristics) ────

const HIGH_RISK_FULFILLED_AMBER_PCT = 50;
const SIGNATURE_LOW_AMBER_PCT = 30;
const PROTECT_LOW_INFO_PCT = 20;
const THREEDS_HEALTHY_PCT = 25;
const THREEDS_LOW_AMBER_PCT = 10;
const FULFILLMENT_DEGRADATION_AMBER_HOURS = 12;
const FULFILLMENT_IMPROVEMENT_GREEN_HOURS = 6;

// Visible cap — too many observations and the card stops being
// scannable. Empirically 5 is the right ceiling.
const TOP_VISIBLE = 5;

/** Severity sort order (most urgent first). */
const SEVERITY_RANK: Record<CheckpointSeverity, number> = {
  breach: 0,
  consider: 1,
  info: 2,
  healthy: 3,
};

const SOURCES = {
  vamp: {
    label: "Visa VAMP fact sheet (2025)",
    url: "https://corporate.visa.com/content/dam/VCOM/corporate/visa-perspectives/security-and-trust/documents/visa-acquirer-monitoring-program-fact-sheet-2025.pdf",
  },
  mastercardEcm: {
    label: "Mastercard ECP merchant guide",
    url: "https://www.jpmorgan.com/content/dam/jpm/merchant-services/payment-network-updates/documents/mastercard-excessive-chargeback-program-guide.pdf",
  },
  shopifyFlow: {
    label: "Shopify Flow — set up a hold-fulfillment rule",
    url: "https://apps.shopify.com/flow",
  },
} as const;

/** A percent (in percent units, 0.15 = 0.15%) to be formatted by the
 *  renderer with `digits` decimals. Never pre-formatted here. */
function pct(v: number | null, digits: 0 | 1 | 2 = 1): CheckpointValue {
  return v === null ? "—" : { value: v, format: `pct${digits}` as "pct0" | "pct1" | "pct2" };
}

function hours(v: number | null): CheckpointValue {
  return v === null ? "—" : { value: v, format: "hours" };
}

// ─── Rules ────────────────────────────────────────────────────────

/** `info` = above the ratio, below the enforcement floor. Its copy lives in
 *  `_below_floor_` keys; the other severities keep their own families. */
function severityKey(severity: CheckpointSeverity): string {
  return severity === "info" ? "below_floor" : severity;
}

/**
 * Visa VAMP, judged on ONE calendar month (`input.programme`, computed by
 * `computeProgrammeBlock`). No programme block → no verdict: a VAMP verdict
 * from a rolling 90-day window, or from disputes counted by when we inserted
 * them, is what told blume-box "5.31%, breach" in October 2026.
 */
function ruleChargebackRateVamp(input: CheckpointInput): Checkpoint | null {
  const p = input.programme;
  if (!p) return null;
  // Too few card orders this month to measure: no verdict (the page shows "—").
  if (!p.cardFramingApplies) return null;
  if (p.cardDisputeRatio === null) return null;
  const severity = vampSeverity(p.cardDisputeRatio, p.visaChargebackCount);
  const key = severityKey(severity);
  return {
    id: "chargeback_rate_vs_vamp",
    severity,
    titleKey: `fraudIntel.checkpoint_chargeback_rate_vs_vamp_${key}_title`,
    bodyKey: `fraudIntel.checkpoint_chargeback_rate_vs_vamp_${key}_body`,
    values: {
      month: { value: p.periodMonth, format: "month" },
      current: pct(p.cardDisputeRatio * 100, 2),
      vampExcessive: pct(VAMP_EXCESSIVE * 100, 1),
      vampApproaching: pct(VAMP_EARLY_WARNING * 100, 1),
      visaCount: p.visaChargebackCount,
      vampFloor: VAMP_COUNT_FLOOR,
    },
    source: SOURCES.vamp,
  };
}

/** Mastercard ECM for the same month: this month's Mastercard chargebacks
 *  against last month's card settled orders (a lower bound until card-brand
 *  denominators land), with the real monthly count — never a 90-day count
 *  divided by three. */
function ruleChargebackRateEcm(input: CheckpointInput): Checkpoint | null {
  const p = input.programme;
  if (!p) return null;
  // Too few card orders this month to measure: no verdict (the page shows "—").
  if (!p.cardFramingApplies) return null;
  if (p.ecmRatio === null) return null;
  const severity = ecmSeverity(p.ecmRatio, p.mcChargebackCount, p.ecmIsLowerBound);
  const key = severityKey(severity);
  return {
    id: "chargeback_rate_vs_ecm",
    severity,
    titleKey: `fraudIntel.checkpoint_chargeback_rate_vs_ecm_${key}_title`,
    bodyKey: `fraudIntel.checkpoint_chargeback_rate_vs_ecm_${key}_body`,
    values: {
      month: { value: p.periodMonth, format: "month" },
      current: pct(p.ecmRatio * 100, 2),
      ecmRatio: pct(MC_ECM_RATIO * 100, 1),
      ecmCount: MC_ECM_COUNT_FLOOR,
      mcCount: p.mcChargebackCount,
    },
    source: SOURCES.mastercardEcm,
  };
}

function ruleHighRiskFulfilled(input: CheckpointInput): Checkpoint | null {
  const v = input.fulfilledHighRiskPct;
  if (v === null) return null;
  if (v < HIGH_RISK_FULFILLED_AMBER_PCT) return null;
  return {
    id: "high_risk_fulfilled",
    severity: "consider",
    titleKey: "fraudIntel.checkpoint_high_risk_fulfilled_consider_title",
    bodyKey: "fraudIntel.checkpoint_high_risk_fulfilled_consider_body",
    values: { current: pct(v, 0) },
    source: SOURCES.shopifyFlow,
  };
}

function ruleSignatureCapture(input: CheckpointInput): Checkpoint | null {
  const v = input.signedForRatePct;
  if (v === null) return null;
  if (v >= SIGNATURE_LOW_AMBER_PCT) return null;
  return {
    id: "signature_capture_low",
    severity: "consider",
    titleKey: "fraudIntel.checkpoint_signature_capture_low_consider_title",
    bodyKey: "fraudIntel.checkpoint_signature_capture_low_consider_body",
    values: { current: pct(v, 0) },
  };
}

function ruleThreeDsAuth(input: CheckpointInput): Checkpoint | null {
  const v = input.threeDsAuthRatePct;
  if (v === null) return null;
  let severity: CheckpointSeverity;
  if (v >= THREEDS_HEALTHY_PCT) severity = "healthy";
  else if (v < THREEDS_LOW_AMBER_PCT) severity = "consider";
  else severity = "info";
  return {
    id: "threeds_auth",
    severity,
    titleKey: `fraudIntel.checkpoint_threeds_auth_${severity}_title`,
    bodyKey: `fraudIntel.checkpoint_threeds_auth_${severity}_body`,
    // One decimal: blume-box is at 0.07%, which "0%" would misstate.
    values: { current: pct(v, 1) },
  };
}

function ruleProtectCoverage(input: CheckpointInput): Checkpoint | null {
  const v = input.shopifyProtectCoveragePct;
  if (v === null) return null;
  if (v >= PROTECT_LOW_INFO_PCT) return null;
  return {
    id: "protect_coverage_low",
    severity: "info",
    titleKey: "fraudIntel.checkpoint_protect_coverage_low_info_title",
    bodyKey: "fraudIntel.checkpoint_protect_coverage_low_info_body",
    values: { current: pct(v, 0) },
  };
}

function ruleFulfillmentBaseline(
  input: CheckpointInput,
): Checkpoint | null {
  const cur = input.medianFulfillmentHoursCurrent;
  const prior = input.medianFulfillmentHoursPrior;
  if (cur === null || prior === null) return null;
  const delta = cur - prior;
  if (delta >= FULFILLMENT_DEGRADATION_AMBER_HOURS) {
    return {
      id: "fulfillment_baseline_degraded",
      severity: "consider",
      titleKey:
        "fraudIntel.checkpoint_fulfillment_baseline_degraded_consider_title",
      bodyKey:
        "fraudIntel.checkpoint_fulfillment_baseline_degraded_consider_body",
      values: {
        current: hours(cur),
        prior: hours(prior),
        delta: hours(Math.abs(delta)),
      },
    };
  }
  if (-delta >= FULFILLMENT_IMPROVEMENT_GREEN_HOURS) {
    return {
      id: "fulfillment_baseline_improved",
      severity: "healthy",
      titleKey:
        "fraudIntel.checkpoint_fulfillment_baseline_improved_healthy_title",
      bodyKey:
        "fraudIntel.checkpoint_fulfillment_baseline_improved_healthy_body",
      values: {
        current: hours(cur),
        prior: hours(prior),
        delta: hours(Math.abs(delta)),
      },
    };
  }
  return null;
}

const RULES = [
  ruleChargebackRateVamp,
  ruleChargebackRateEcm,
  ruleHighRiskFulfilled,
  ruleSignatureCapture,
  ruleThreeDsAuth,
  ruleProtectCoverage,
  ruleFulfillmentBaseline,
];

/**
 * Evaluate every rule and return the top N by severity. Ties resolve
 * by stable declaration order — so the VAMP/ECM rules surface above
 * heuristic observations when severities are equal.
 */
export function evaluateCheckpoints(
  input: CheckpointInput,
  limit = TOP_VISIBLE,
): Checkpoint[] {
  const all = RULES.map((r) => r(input)).filter(
    (c): c is Checkpoint => c !== null,
  );
  // Stable sort by severity rank; declaration order preserved on ties.
  all.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return all.slice(0, limit);
}
