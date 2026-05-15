import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { getTopUp, TOPUP_EXPIRY_DAYS } from "@/lib/billing/plans";
import { grantCredits } from "@/lib/billing/consumePack";
import { verifyAppCharge } from "@/lib/shopify/queries/appChargeStatus";

export const runtime = "nodejs";

/**
 * GET /api/billing/topup-callback?shop_id=...&sku=...&charge_id=...
 *
 * Shopify redirects here after merchant approves/declines the one-time charge.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const shopId = sp.get("shop_id");
  const sku = sp.get("sku");
  const chargeId = sp.get("charge_id");

  if (!shopId || !sku) {
    return NextResponse.redirect(new URL("/app/billing", req.url));
  }

  const topUp = getTopUp(sku);
  const sb = getServiceClient();

  const appUrl = process.env.SHOPIFY_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  const host = sp.get("host") ?? "";
  const shop = sp.get("shop") ?? "";
  const billingUrl = new URL(`${appUrl}/app/billing`);
  if (host) billingUrl.searchParams.set("host", host);
  if (shop) billingUrl.searchParams.set("shop", shop);

  if (!chargeId || !topUp) {
    return NextResponse.redirect(billingUrl.toString());
  }

  // Verify the one-time charge with Shopify before granting credits.
  // Without this, /api/billing/topup-callback?charge_id=anything would
  // grant free packs.
  const verification = await verifyAppCharge({
    shopId,
    chargeId,
    chargeType: "one_time",
    expectedAmountUsd: topUp.priceUsd,
  });

  if (!verification.verified) {
    await sb.from("audit_events").insert({
      shop_id: shopId,
      actor_type: "system",
      event_type: "topup_verification_failed",
      event_payload: {
        sku,
        charge_id: chargeId,
        reason: verification.reason ?? null,
        status: verification.status ?? null,
        shopify_gid: verification.shopifyChargeGid ?? null,
      },
    });
    billingUrl.searchParams.set("verify_failed", verification.reason ?? "unknown");
    return NextResponse.redirect(billingUrl.toString());
  }

  // Top-up packs are decoupled from the billing cycle — they expire
  // 30 days from purchase. A merchant who buys 100 packs an hour
  // before cycle-end gets 100 usable packs for the next 30 days, not
  // one hour.
  const expiresAt = new Date(
    Date.now() + TOPUP_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  await grantCredits({
    shopId,
    source: "topup",
    packs: topUp.packs,
    expiresAt,
    reference: `topup_${sku}_${chargeId}`,
  });

  await sb.from("audit_events").insert({
    shop_id: shopId,
    actor_type: "merchant",
    event_type: "topup_purchased",
    event_payload: {
      sku,
      packs: topUp.packs,
      charge_id: chargeId,
      charge_verified: true,
      shopify_gid: verification.shopifyChargeGid ?? null,
      test_charge: verification.test ?? false,
    },
  });

  return NextResponse.redirect(billingUrl.toString());
}
