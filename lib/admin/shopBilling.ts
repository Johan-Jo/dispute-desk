/**
 * Admin-side billing helpers — turn `shops.plan` into the dollar
 * figures the admin Risk profile and Quick Stats footer surface.
 *
 * Source of truth for monthly pricing is `lib/billing/plans.ts`
 * (`PLANS[plan].price`). The Shopify Managed Pricing callback at
 * `app/api/billing/callback/route.ts` keeps `shops.plan` in lockstep
 * with the merchant's active subscription, so the column is the
 * authoritative subscription state we have today.
 *
 * "Total invoiced" approximation: we don't store invoice records, so
 * `monthlyPrice × monthsInPeriod` is the best we can do without
 * standing up a new `billing_invoices` table. Acceptable for a risk-
 * profile snapshot — flagged as approximate via `isApproximate: true`
 * on the return so the UI can decide whether to footnote it.
 */

import { getPlan } from "@/lib/billing/plans";

export interface MonthlyRevenue {
  /** Plan name, e.g. "Growth". */
  planName: string;
  /** Plan ID slug, e.g. "growth". */
  planId: string;
  /** Monthly price in USD. */
  monthlyUsd: number;
}

export function monthlyRevenueForPlan(plan: string | null | undefined): MonthlyRevenue {
  const def = getPlan(plan ?? "free");
  return {
    planName: def.name,
    planId: def.id,
    monthlyUsd: def.price,
  };
}

export interface InvoicedAmount {
  /** Approximate total invoiced over the window in USD. */
  totalUsd: number;
  /** Window length in days. */
  windowDays: number;
  /** Months equivalent (windowDays / 30, floored to 1 dp). */
  monthsInPeriod: number;
  /** Always true — this figure is computed from the current plan
   *  rate × time-in-window, NOT from real invoice records. The UI
   *  should footnote or icon-hint as appropriate. */
  isApproximate: true;
  planName: string;
  planId: string;
  monthlyUsd: number;
}

/**
 * Approximate the dollars invoiced to a shop over a window.
 *
 * Method: `monthlyUsd × (windowDays / 30)`. Months are not whole, so
 * we report a fractional value (e.g. 30 days = 1.0, 90 days = 3.0,
 * 180 days = 6.0).
 *
 * Caveats baked into `isApproximate: true`:
 *   - Doesn't account for plan changes mid-window (treats the current
 *     plan as if it's been the plan all along).
 *   - Doesn't account for the trial period (TRIAL_DAYS) where
 *     monthly_included packs are free.
 *   - Doesn't account for partial first/last months — Shopify
 *     typically prorates first month, we don't model that.
 *   - Top-ups (`pack_credits_ledger.source = 'topup'`) aren't included.
 *
 * Good enough as a snapshot stat; replace with real invoice history
 * if/when we build that table.
 */
export function totalInvoicedForPeriod(
  plan: string | null | undefined,
  windowDays: number,
): InvoicedAmount {
  if (windowDays < 0) {
    throw new Error(`totalInvoicedForPeriod: windowDays must be >= 0, got ${windowDays}`);
  }
  const def = getPlan(plan ?? "free");
  const monthsInPeriod = Math.round((windowDays / 30) * 10) / 10;
  return {
    totalUsd: Math.round(def.price * (windowDays / 30)),
    windowDays,
    monthsInPeriod,
    isApproximate: true,
    planName: def.name,
    planId: def.id,
    monthlyUsd: def.price,
  };
}
