/**
 * Mastercard FPT category scoring — Device, Delivery, Identity.
 *
 * Each category scores 0.0–1.0 from the data we can read at qualification
 * time. The v1 thresholds are intentionally conservative because we have
 * no outcome data yet to calibrate Mastercard's AI risk model against.
 * Encoded as named constants in fptThresholds.ts so calibrating later is
 * a config change, not a logic change.
 *
 * Verdict (in qualifyFPT.ts):
 *   - All categories must score > 0   AND   sum ≥ 2.0   → `ready`
 *   - Otherwise → `partial` / `not_ready` depending on shape
 */

import type {
  FPTCategory,
  FPTCategoryScore,
  QualificationOrder,
} from "./types";

export const FPT_READY_TOTAL_THRESHOLD = 2.0;

export interface FPTScoreInput {
  /** Disputed order. */
  disputed: QualificationOrder;
  /** Optional session data (from LSE-4 when available). */
  sessionData?: {
    deviceFingerprint?: string | null;
    behavioralEntropy?: number | null;
    sessionDurationMs?: number | null;
  } | null;
  /** Customer's tenure on the platform, derived from customer.createdAt. */
  customerTenureDays?: number | null;
  /** Number of prior undisputed orders this customer has placed. */
  priorOrderCount?: number;
  /** Whether the order has tracking + delivery confirmation. */
  hasDeliveryConfirmation?: boolean;
}

/* ── Device ── */

export function scoreDeviceEvidence(input: FPTScoreInput): FPTCategoryScore {
  let score = 0;
  const signals: string[] = [];

  if (input.disputed.ipAddress) {
    score += 0.3;
    signals.push("ip_present");
  }
  if (input.disputed.deviceFingerprint) {
    score += 0.4;
    signals.push("device_fingerprint_present");
  } else if (input.sessionData?.deviceFingerprint) {
    score += 0.4;
    signals.push("device_fingerprint_from_session");
  }
  if (input.disputed.threeDSecure?.authenticated) {
    score += 0.2;
    signals.push("3ds_authenticated");
  }
  if (
    input.sessionData?.sessionDurationMs &&
    input.sessionData.sessionDurationMs > 60_000
  ) {
    score += 0.1;
    signals.push("session_duration_ok");
  }

  return {
    category: "device" as FPTCategory,
    score: clamp01(score),
    signals,
  };
}

/* ── Delivery ── */

export function scoreDeliveryEvidence(input: FPTScoreInput): FPTCategoryScore {
  let score = 0;
  const signals: string[] = [];

  // Without LSE-4 device data, we can still grade delivery from the
  // existing fulfillment/tracking sources via the disputed order.
  if (input.disputed.shippingAddress?.address1) {
    score += 0.3;
    signals.push("shipping_address_present");
  }
  if (input.hasDeliveryConfirmation) {
    score += 0.5;
    signals.push("delivery_confirmed");
  }
  // Digital goods (no shipping address) — partial credit if account is solid.
  if (!input.disputed.shippingAddress && input.disputed.customerId) {
    score += 0.3;
    signals.push("digital_goods_with_account");
  }
  // Bonus: address matches billing.
  // (We don't have billing on QualificationOrder yet — a future expansion
  // can correlate. For now, no penalty.)

  return {
    category: "delivery" as FPTCategory,
    score: clamp01(score),
    signals,
  };
}

/* ── Identity ── */

export function scoreIdentityEvidence(input: FPTScoreInput): FPTCategoryScore {
  let score = 0;
  const signals: string[] = [];

  if (input.disputed.customerId) {
    score += 0.3;
    signals.push("customer_account_present");
  }
  if (input.customerTenureDays != null && input.customerTenureDays >= 90) {
    score += 0.3;
    signals.push("customer_tenure_90_plus");
  } else if (input.customerTenureDays != null && input.customerTenureDays >= 30) {
    score += 0.15;
    signals.push("customer_tenure_30_to_89");
  }
  if (input.priorOrderCount && input.priorOrderCount >= 2) {
    score += 0.3;
    signals.push("repeat_customer_2_plus_priors");
  } else if (input.priorOrderCount && input.priorOrderCount >= 1) {
    score += 0.15;
    signals.push("repeat_customer_1_prior");
  }
  if (input.disputed.customerEmail) {
    score += 0.1;
    signals.push("email_present");
  }

  return {
    category: "identity" as FPTCategory,
    score: clamp01(score),
    signals,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
