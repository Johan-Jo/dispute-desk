/**
 * GET /api/billing/banner?shop_id=...
 *
 * Returns the current billing banner state for the shop. Pure read —
 * the decision logic lives in `lib/billing/bannerState.ts`; this
 * route only assembles the inputs and returns the result.
 *
 * The same endpoint serves the embedded app and the portal. Callers
 * use the returned `variant` to pick a banner component (or render
 * nothing when variant === "none").
 *
 * Read-only access invariant (PRD §5.4): this route deliberately does
 * NOT check `automationAllowed(state)`. Banner data is informational
 * regardless of subscription state — an expired shop still gets a
 * banner saying so, and the rest of the app stays fully readable.
 */

import { NextRequest, NextResponse } from "next/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { getServiceClient } from "@/lib/supabase/server";
import { getPlan, type PlanId } from "@/lib/billing/plans";
import {
  computeBillingBannerState,
  type BillingBannerState,
} from "@/lib/billing/bannerState";
import type { SubscriptionState } from "@/lib/billing/subscriptionState";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const shopId = extractShopId(req);
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const sb = getServiceClient();

  const [
    { data: shop },
    { data: entitlement },
    { data: balance },
  ] = await Promise.all([
    sb.from("shops").select("plan").eq("id", shopId).maybeSingle(),
    sb
      .from("plan_entitlements")
      .select(
        "subscription_state, billing_cycle_ends_at, low_credits_banner_dismissed_cycle, grace_banner_dismissed_cycle",
      )
      .eq("shop_id", shopId)
      .maybeSingle(),
    sb
      .from("pack_balance")
      .select("remaining_packs")
      .eq("shop_id", shopId)
      .maybeSingle(),
  ]);

  const planId = ((shop?.plan as PlanId | null) ?? "free");
  const plan = getPlan(planId);

  const state: BillingBannerState = computeBillingBannerState({
    subscriptionState:
      ((entitlement?.subscription_state as SubscriptionState | null) ??
        "active") as SubscriptionState,
    billingCycleEndsAt:
      (entitlement?.billing_cycle_ends_at as string | null) ?? null,
    lowCreditsBannerDismissedCycle:
      (entitlement?.low_credits_banner_dismissed_cycle as string | null) ??
      null,
    graceBannerDismissedCycle:
      (entitlement?.grace_banner_dismissed_cycle as string | null) ?? null,
    remainingPacks: (balance?.remaining_packs as number | null) ?? null,
    monthlyPackLimit:
      plan.packsPerMonth > 0 ? plan.packsPerMonth : null,
  });

  return NextResponse.json({
    ...state,
    plan: {
      id: plan.id,
      name: plan.name,
      packsPerMonth: plan.packsPerMonth,
    },
  });
}
