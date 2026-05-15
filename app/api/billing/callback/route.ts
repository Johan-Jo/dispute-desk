import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { getPlan, TRIAL_INCLUDED_PACKS, type PlanId } from "@/lib/billing/plans";
import { grantCredits } from "@/lib/billing/consumePack";
import { checkTrialEligibility } from "@/lib/billing/trialEligibility";
import { verifyAppCharge } from "@/lib/shopify/queries/appChargeStatus";
import { sendTrialStartedEmail } from "@/lib/email/billingLifecycle";

export const runtime = "nodejs";

/**
 * GET /api/billing/callback?shop_id=...&plan_id=...&charge_id=...
 *
 * Shopify redirects here after the merchant approves/declines the charge.
 * Updates the shop's plan, grants credits, and sets up entitlements.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const shopId = sp.get("shop_id");
  const planId = sp.get("plan_id") as PlanId | null;
  const chargeId = sp.get("charge_id");

  if (!shopId || !planId) {
    return NextResponse.redirect(new URL("/app/settings", req.url));
  }

  const sb = getServiceClient();
  const plan = getPlan(planId);

  const appUrl = process.env.SHOPIFY_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  const host = sp.get("host") ?? "";
  const shop = sp.get("shop") ?? "";
  const billingUrl = new URL(`${appUrl}/app/billing`);
  if (host) billingUrl.searchParams.set("host", host);
  if (shop) billingUrl.searchParams.set("shop", shop);

  if (!chargeId) {
    await sb.from("audit_events").insert({
      shop_id: shopId,
      actor_type: "merchant",
      event_type: "billing_declined",
      event_payload: { plan_id: planId },
    });
    return NextResponse.redirect(billingUrl.toString());
  }

  // Verify the charge with Shopify before granting anything. Without
  // this gate, the query-string charge_id is forgeable and any visitor
  // could upgrade themselves to Scale for free.
  const verification = await verifyAppCharge({
    shopId,
    chargeId,
    chargeType: "subscription",
    expectedAmountUsd: plan.price,
  });

  if (!verification.verified) {
    await sb.from("audit_events").insert({
      shop_id: shopId,
      actor_type: "system",
      event_type: "billing_verification_failed",
      event_payload: {
        plan_id: planId,
        charge_id: chargeId,
        reason: verification.reason ?? null,
        status: verification.status ?? null,
        shopify_gid: verification.shopifyChargeGid ?? null,
      },
    });
    billingUrl.searchParams.set("verify_failed", verification.reason ?? "unknown");
    return NextResponse.redirect(billingUrl.toString());
  }

  await sb
    .from("shops")
    .update({
      plan: planId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", shopId);

  // Belt-and-suspenders trial eligibility check. The subscribe route
  // already gated `trialDays` to 0 for non-eligible shops; we re-check
  // here so a direct call to /api/billing/callback that bypasses
  // subscribe (e.g. testing, replayed redirect, hand-crafted URL)
  // can't sneak through a second trial grant. The redirect's
  // `?trial_granted=1|0` carries the subscribe-side decision for
  // diagnostic clarity in the audit row.
  const eligibility = await checkTrialEligibility(shopId);
  const subscribeSaidTrialGranted = sp.get("trial_granted") === "1";
  const trialAllowed =
    eligibility.eligible && subscribeSaidTrialGranted && plan.trialDays > 0;

  const now = new Date();
  const trialEndsAt = trialAllowed
    ? new Date(now.getTime() + plan.trialDays * 86400000).toISOString()
    : null;
  const cycleEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()).toISOString();

  await sb.from("plan_entitlements").upsert({
    shop_id: shopId,
    plan_key: planId,
    trial_ends_at: trialEndsAt,
    billing_cycle_started_at: now.toISOString(),
    billing_cycle_ends_at: cycleEnd,
    updated_at: now.toISOString(),
  }, { onConflict: "shop_id" });

  if (trialAllowed && trialEndsAt) {
    await grantCredits({
      shopId,
      source: "trial",
      packs: TRIAL_INCLUDED_PACKS,
      expiresAt: trialEndsAt,
      reference: `trial_${planId}_${chargeId}`,
    });
  }

  if (plan.packsPerMonth > 0) {
    await grantCredits({
      shopId,
      source: "monthly_included",
      packs: plan.packsPerMonth,
      expiresAt: cycleEnd,
      reference: `monthly_${planId}_${chargeId}`,
    });
  }

  await sb.from("audit_events").insert({
    shop_id: shopId,
    actor_type: "system",
    event_type: "billing_activated",
    event_payload: {
      plan_id: planId,
      charge_id: chargeId,
      trial_granted: trialAllowed,
      trial_days_requested: plan.trialDays,
      trial_eligibility_reason: eligibility.reason,
      subscribe_said_trial: subscribeSaidTrialGranted,
      charge_verified: true,
      shopify_gid: verification.shopifyChargeGid ?? null,
      test_charge: verification.test ?? false,
    },
  });

  // Trial-started lifecycle email — fires only when a trial was
  // actually granted on this activation. Idempotent via
  // plan_entitlements.trial_started_at, so even a reloaded callback
  // URL won't re-send.
  if (trialAllowed) {
    void sendTrialStartedEmail(shopId).catch(() => {});
  }

  return NextResponse.redirect(billingUrl.toString());
}
