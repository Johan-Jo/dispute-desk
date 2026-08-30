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
 * Card networks refresh these thresholds periodically. Schedule
 * a quarterly source-recheck (next due 2026-08-11). If a threshold
 * changes, update the constant block below + the dates in this
 * header.
 *
 * Last verified: 2026-05-11.
 */

import type {
  Checkpoint,
  CheckpointInput,
  CheckpointSeverity,
} from "./checkpoints.types";

// ─── Network thresholds (last verified 2026-05-11) ────────────────

/** Visa VAMP merchant Excessive ratio, effective April 1 2026. */
export const VAMP_EXCESSIVE_PCT = 1.5;
/** "Approaching" cutoff — VAMP doesn't publish an Above-Standard
 *  band for merchants, but operationally a rate north of 0.9% is
 *  the common industry "approaching VAMP" trigger. */
export const VAMP_APPROACHING_PCT = 0.9;

/** Mastercard ECM ratio threshold. ECM additionally requires
 *  100+ chargebacks per month. */
export const MC_ECM_PCT = 1.5;
export const MC_ECM_MIN_DISPUTES_PER_MONTH = 100;

/** Mastercard HECM (High ECM) ratio + count. */
export const MC_HECM_PCT = 3.0;
export const MC_HECM_MIN_DISPUTES_PER_MONTH = 300;

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

/** Format a percent value compactly. */
function pct(v: number | null, digits = 1): string {
  return v === null ? "—" : `${v.toFixed(digits)}%`;
}

function hours(v: number | null): string {
  if (v === null) return "—";
  return v < 24 ? `${v.toFixed(1)} h` : `${(v / 24).toFixed(1)} d`;
}

// ─── Rules ────────────────────────────────────────────────────────

function ruleChargebackRateVamp(input: CheckpointInput): Checkpoint | null {
  const rate = input.chargebackRate90d;
  if (rate === null) return null;
  let severity: CheckpointSeverity;
  if (rate >= VAMP_EXCESSIVE_PCT) severity = "breach";
  else if (rate >= VAMP_APPROACHING_PCT) severity = "consider";
  else severity = "healthy";
  return {
    id: "chargeback_rate_vs_vamp",
    severity,
    titleKey: `fraudIntel.checkpoint_chargeback_rate_vs_vamp_${severity}_title`,
    bodyKey: `fraudIntel.checkpoint_chargeback_rate_vs_vamp_${severity}_body`,
    values: {
      current: pct(rate, 2),
      vampExcessive: pct(VAMP_EXCESSIVE_PCT, 1),
      vampApproaching: pct(VAMP_APPROACHING_PCT, 1),
    },
    source: SOURCES.vamp,
  };
}

function ruleChargebackRateEcm(input: CheckpointInput): Checkpoint | null {
  const rate = input.chargebackRate90d;
  const count = input.chargebackCount90d;
  if (rate === null) return null;
  // ECM requires BOTH ratio AND ≥100 disputes/month. We have a 90-day
  // count so we approximate monthly as count/3. If monthly is below
  // the count floor, this rule emits a healthy/info observation that
  // the count safety harbor is in play — never a breach.
  const monthly = count / 3;
  const ratioBreached = rate >= MC_ECM_PCT;
  const countBreached = monthly >= MC_ECM_MIN_DISPUTES_PER_MONTH;
  let severity: CheckpointSeverity;
  if (ratioBreached && countBreached) severity = "breach";
  else if (ratioBreached) severity = "consider"; // count harbor
  else if (rate >= VAMP_APPROACHING_PCT) severity = "consider";
  else severity = "healthy";
  return {
    id: "chargeback_rate_vs_ecm",
    severity,
    titleKey: `fraudIntel.checkpoint_chargeback_rate_vs_ecm_${severity}_title`,
    bodyKey: `fraudIntel.checkpoint_chargeback_rate_vs_ecm_${severity}_body`,
    values: {
      current: pct(rate, 2),
      ecmRatio: pct(MC_ECM_PCT, 1),
      ecmCount: MC_ECM_MIN_DISPUTES_PER_MONTH,
      monthlyEstimate: Math.round(monthly),
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
    values: { current: pct(v, 0) },
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
