/**
 * Admin revenue truth: who has ACTUALLY paid.
 *
 * `shops.plan` is a label — it says what a merchant selected, not that money
 * moved. MRR built from it overstated revenue (2026-11-12 prod measurement:
 * label-based MRR counted 4 × Growth; only 2 shops had a recorded first paid
 * cycle). Payment evidence lives in `plan_entitlements`:
 *   - `subscription_state` (trialing | active | grace | expired | cancelled)
 *   - `first_paid_cycle_started_at` — stamped when the trial→paid cycle starts
 *     (`sendFirstPaidCycleEmail`), i.e. Shopify billed the first real charge.
 *
 * Classification (installed shops only; uninstalled → "uninstalled"):
 *   paid        state=active AND first_paid_cycle_started_at set AND plan_key≠free
 *   trialing    state=trialing (trial window open or not yet reconciled)
 *   grace       state=grace
 *   unconfirmed paid-tier plan label with NO payment evidence (no entitlement
 *               row, or active without a first paid cycle). Shown to the
 *               operator, never counted as revenue.
 *   free        free plan / expired / cancelled
 */

import { getPlan } from "@/lib/billing/plans";

export type AdminBillingState =
  | "paid"
  | "trialing"
  | "grace"
  | "unconfirmed"
  | "free"
  | "uninstalled";

export interface EntitlementEvidence {
  shop_id: string;
  plan_key: string | null;
  subscription_state: string | null;
  first_paid_cycle_started_at: string | null;
}

export interface ShopBillingInput {
  plan: string | null;
  uninstalled_at: string | null;
}

export function classifyBillingState(
  shop: ShopBillingInput,
  ent: EntitlementEvidence | null | undefined,
): AdminBillingState {
  if (shop.uninstalled_at) return "uninstalled";
  const labelPlan = shop.plan ?? "free";
  const entPlan = ent?.plan_key ?? null;

  if (ent) {
    if (ent.subscription_state === "trialing") return "trialing";
    if (ent.subscription_state === "grace") return "grace";
    if (
      ent.subscription_state === "active" &&
      entPlan &&
      entPlan !== "free" &&
      ent.first_paid_cycle_started_at
    ) {
      return "paid";
    }
  }
  // A paid-tier label (on the shop or the entitlement) with no payment proof.
  const paidLabel = labelPlan !== "free" || (!!entPlan && entPlan !== "free");
  if (paidLabel && ent?.subscription_state !== "expired" && ent?.subscription_state !== "cancelled") {
    return "unconfirmed";
  }
  return "free";
}

/** Monthly revenue that is actually being paid: only `paid` shops count. */
export function paidMonthlyUsd(
  state: AdminBillingState,
  ent: EntitlementEvidence | null | undefined,
  shopPlan: string | null,
): number {
  if (state !== "paid") return 0;
  return getPlan(ent?.plan_key ?? shopPlan ?? "free").price;
}

export interface BillingSummary {
  paid: number;
  trialing: number;
  grace: number;
  unconfirmed: number;
  free: number;
  /** Sum of plan price over `paid` shops only. */
  mrr: number;
  /** What the old label-based formula would have shown (for the delta note). */
  labelMrr: number;
}

export function summarizeBilling(
  shops: (ShopBillingInput & { id: string })[],
  entitlements: EntitlementEvidence[],
): BillingSummary {
  const byShop = new Map(entitlements.map((e) => [e.shop_id, e]));
  const out: BillingSummary = { paid: 0, trialing: 0, grace: 0, unconfirmed: 0, free: 0, mrr: 0, labelMrr: 0 };
  for (const s of shops) {
    const ent = byShop.get(s.id);
    const state = classifyBillingState(s, ent);
    if (state === "uninstalled") continue;
    out[state]++;
    out.mrr += paidMonthlyUsd(state, ent, s.plan);
    out.labelMrr += getPlan(s.plan ?? "free").price;
  }
  return out;
}
