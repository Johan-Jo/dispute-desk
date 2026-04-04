import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { getTopUp } from "@/lib/billing/plans";
import { grantCredits } from "@/lib/billing/consumePack";

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

  if (chargeId && topUp) {
    const { data: entitlement } = await sb
      .from("plan_entitlements")
      .select("billing_cycle_ends_at")
      .eq("shop_id", shopId)
      .maybeSingle();

    await grantCredits({
      shopId,
      source: "topup",
      packs: topUp.packs,
      expiresAt: entitlement?.billing_cycle_ends_at ?? null,
      reference: `topup_${sku}_${chargeId}`,
    });

    await sb.from("audit_events").insert({
      shop_id: shopId,
      actor_type: "merchant",
      event_type: "topup_purchased",
      event_payload: { sku, packs: topUp.packs, charge_id: chargeId },
    });
  }

  const appUrl = process.env.SHOPIFY_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";

  const host = sp.get("host") ?? "";
  const shop = sp.get("shop") ?? "";
  const billingUrl = new URL(`${appUrl}/app/billing`);
  if (host) billingUrl.searchParams.set("host", host);
  if (shop) billingUrl.searchParams.set("shop", shop);

  return NextResponse.redirect(billingUrl.toString());
}
