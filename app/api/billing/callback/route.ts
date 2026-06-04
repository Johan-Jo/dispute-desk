import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { getPlan, TRIAL_INCLUDED_PACKS, type PlanId } from "@/lib/billing/plans";
import { grantCredits } from "@/lib/billing/consumePack";
import { checkTrialEligibility } from "@/lib/billing/trialEligibility";
import { verifyAppCharge } from "@/lib/shopify/queries/appChargeStatus";
import { sendTrialStartedEmail } from "@/lib/email/billingLifecycle";
import { buildEmbeddedReturnUrl } from "@/lib/embedded/embeddedAppUrl";

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

  // Post-approval destination. Onboarding's trial flow passes
  // return_to="/app" so a NEW merchant lands on the dashboard, not the plan
  // page. Plan-management upgrades omit it and default to "/app/billing" so an
  // existing merchant sees their updated plan. Validated against an allow-list
  // so the query param can never become an open redirect.
  const ALLOWED_RETURN_PATHS = new Set(["/app", "/app/billing"]);
  const requestedReturn = sp.get("return_to") ?? "";
  const appPath = ALLOWED_RETURN_PATHS.has(requestedReturn)
    ? requestedReturn
    : "/app/billing";

  // Redirect into the embedded Admin URL (admin.shopify.com/store/<handle>/apps/<api_key>/app/...)
  // so App Bridge re-bootstraps and the s-app-nav chrome renders.
  // Without this the post-approval page loads at disputedesk.app/app/...
  // outside the Admin iframe and the embedded layout is lost
  // (2026-05-27 regression). Falls back to the bare app URL when the
  // store handle can't be derived from host/shop.
  const embeddedUrl = buildEmbeddedReturnUrl({
    host: host || null,
    shop: shop || null,
    appPath,
  });
  const billingUrl = embeddedUrl
    ? new URL(embeddedUrl)
    : (() => {
        const u = new URL(`${appUrl}${appPath}`);
        if (host) u.searchParams.set("host", host);
        if (shop) u.searchParams.set("shop", shop);
        return u;
      })();

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

  // subscription_state MUST be reset to active (or trialing) here.
  // Without this, a merchant who was previously expired/cancelled and
  // then subscribes again would stay in their old state, and the
  // sticky red "subscription_expired" banner (lib/billing/bannerState.ts)
  // would keep showing even though the new charge is active. Also
  // clear the per-cycle dismissals so the new cycle starts clean — a
  // dismissal recorded against the OLD billing_cycle_ends_at would
  // not match the new one anyway, but explicit is better here.
  const subscriptionState = trialAllowed ? "trialing" : "active";

  await sb.from("plan_entitlements").upsert({
    shop_id: shopId,
    plan_key: planId,
    subscription_state: subscriptionState,
    trial_ends_at: trialEndsAt,
    billing_cycle_started_at: now.toISOString(),
    billing_cycle_ends_at: cycleEnd,
    low_credits_banner_dismissed_cycle: null,
    grace_banner_dismissed_cycle: null,
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
      subscription_state: subscriptionState,
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
