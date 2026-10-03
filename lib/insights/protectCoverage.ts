/**
 * Shopify Protect coverage — the one definition, shared by the daily fraud
 * rollup and the Insights month record.
 *
 *   coverage = value of orders Protect COVERS (PROTECTED / ACTIVE, the
 *              Coverage Gate's set) ÷ value of every order Shopify gave a
 *              Protect status at all (including INACTIVE and NOT_PROTECTED)
 *
 * An earlier denominator counted only PROTECTED / ACTIVE / PENDING. With no
 * PENDING orders left that made the share 100% for every shop — blume-box
 * showed 100% while 2,775 of its 4,515 September orders were INACTIVE
 * (real coverage ~55% of value). INACTIVE (e.g. an order edited after
 * checkout) and NOT_PROTECTED orders are exactly the gap the merchant needs
 * to see, so they belong in the denominator.
 *
 * Orders with no Protect status (shop not enrolled, or a non-Shopify
 * Payments order) are outside both sides. No status anywhere → null.
 * Protect only covers FRAUD chargebacks; the share describes order value
 * covered, not dispute outcomes.
 */

import { COVERED_STATUSES } from "@/lib/packs/sources/coverageSource";

export function protectValue(
  status: string | null | undefined,
  orderTotal: unknown,
): { covered: number; eligible: number } {
  const total = Number(orderTotal ?? 0);
  if (!status || !Number.isFinite(total) || total <= 0) return { covered: 0, eligible: 0 };
  return { covered: COVERED_STATUSES.has(status.toUpperCase()) ? total : 0, eligible: total };
}
