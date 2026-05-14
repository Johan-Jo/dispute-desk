/**
 * Pure logic for filtering a candidate set of prior orders down to
 * CE 3.0–eligible priors. Visa requires:
 *   - Same cardholder (matched by customer or, for guest checkout, by email)
 *   - 120 to 365 days before the disputed transaction
 *   - Undisputed (no chargeback / inquiry against the prior)
 *   - Not refunded
 *   - Not a validation charge ($0 / $1)
 *
 * The Shopify GraphQL fetch that produces the candidate set lives
 * alongside the qualification orchestrator — this module is pure so
 * tests can pump fixtures through it.
 */

import {
  CE30_PRIOR_MAX_DAYS,
  CE30_PRIOR_MIN_DAYS,
  type QualificationOrder,
} from "./types";

export interface FilterPriorsResult {
  eligible: QualificationOrder[];
  excluded: Array<{ orderId: string; reason: string }>;
}

export function daysBetween(laterIso: string, earlierIso: string): number {
  const later = new Date(laterIso).getTime();
  const earlier = new Date(earlierIso).getTime();
  if (!Number.isFinite(later) || !Number.isFinite(earlier)) return NaN;
  return Math.floor((later - earlier) / (24 * 60 * 60 * 1000));
}

export function filterPriorsForCE30(
  disputed: QualificationOrder,
  candidates: QualificationOrder[],
): FilterPriorsResult {
  const eligible: QualificationOrder[] = [];
  const excluded: Array<{ orderId: string; reason: string }> = [];

  for (const p of candidates) {
    if (p.shopifyOrderId === disputed.shopifyOrderId) {
      excluded.push({ orderId: p.shopifyOrderId, reason: "same_as_disputed" });
      continue;
    }
    if (p.disputed) {
      excluded.push({ orderId: p.shopifyOrderId, reason: "prior_disputed" });
      continue;
    }
    if (p.totalRefunded > 0) {
      excluded.push({ orderId: p.shopifyOrderId, reason: "prior_refunded" });
      continue;
    }
    if (p.isValidationCharge) {
      excluded.push({ orderId: p.shopifyOrderId, reason: "validation_charge" });
      continue;
    }
    const age = daysBetween(disputed.createdAt, p.createdAt);
    if (!Number.isFinite(age)) {
      excluded.push({ orderId: p.shopifyOrderId, reason: "invalid_date" });
      continue;
    }
    if (age < CE30_PRIOR_MIN_DAYS) {
      excluded.push({
        orderId: p.shopifyOrderId,
        reason: `too_recent:${age}d`,
      });
      continue;
    }
    if (age > CE30_PRIOR_MAX_DAYS) {
      excluded.push({
        orderId: p.shopifyOrderId,
        reason: `too_old:${age}d`,
      });
      continue;
    }
    // Same-customer check.
    if (
      disputed.customerId &&
      p.customerId &&
      disputed.customerId !== p.customerId
    ) {
      excluded.push({
        orderId: p.shopifyOrderId,
        reason: "different_customer",
      });
      continue;
    }
    // For guest checkout (no customer ID), fall back to email match.
    if (!disputed.customerId && !p.customerId) {
      const ea = (disputed.customerEmail ?? "").trim().toLowerCase();
      const eb = (p.customerEmail ?? "").trim().toLowerCase();
      if (ea && eb && ea !== eb) {
        excluded.push({
          orderId: p.shopifyOrderId,
          reason: "different_guest_email",
        });
        continue;
      }
    }
    eligible.push(p);
  }

  // Most-recent first — the orchestrator typically takes the top 2.
  eligible.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return { eligible, excluded };
}

/**
 * For the subscription / MIT branch — pick the initial subscription
 * billing transaction from a candidate set. Strategy:
 *   - Must share the same subscriptionMarker as the disputed order
 *   - Must be the earliest non-disputed, non-refunded billing
 *   - Visa allows the initial billing to be < 120 days old; the
 *     window only constrains the standard branch
 */
export function pickInitialSubscriptionBilling(
  disputed: QualificationOrder,
  candidates: QualificationOrder[],
): QualificationOrder | null {
  if (!disputed.subscriptionMarker) return null;
  const matching = candidates
    .filter(
      (c) =>
        c.subscriptionMarker === disputed.subscriptionMarker &&
        c.shopifyOrderId !== disputed.shopifyOrderId &&
        !c.disputed &&
        c.totalRefunded === 0 &&
        !c.isValidationCharge,
    )
    .sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  return matching[0] ?? null;
}
