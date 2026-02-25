import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import type { PlanId } from "@/lib/billing/plans";

export const runtime = "nodejs";

/**
 * GET /api/billing/callback?shop_id=...&plan_id=...&charge_id=...
 *
 * Shopify redirects here after the merchant approves/declines the charge.
 * Updates the shop's plan and redirects back to the app.
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

  // Shopify includes charge_id when approved, omits when declined
  if (chargeId) {
    await sb
      .from("shops")
      .update({
        plan: planId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", shopId);

    await sb.from("audit_events").insert({
      shop_id: shopId,
      actor_type: "system",
      event_type: "billing_plan_activated",
      event_payload: { plan_id: planId, charge_id: chargeId },
    });
  } else {
    await sb.from("audit_events").insert({
      shop_id: shopId,
      actor_type: "merchant",
      event_type: "billing_subscription_declined",
      event_payload: { plan_id: planId },
    });
  }

  const appUrl = process.env.SHOPIFY_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  return NextResponse.redirect(`${appUrl}/app/settings`);
}
