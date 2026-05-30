/**
 * POST /api/billing/plan-recommendation/dismiss?shop_id=...
 *
 * Dismisses the dashboard plan-recommendation banner. The server reads the
 * shop's CURRENT recommended plan and records it in `dismissed_plan` — so
 * the banner stays hidden only while the recommendation is unchanged. If
 * the shop's chargeback volume later grows and the recommendation escalates
 * to a different tier, the dismissal no longer matches and the banner
 * re-surfaces (see `shouldShowRecommendationBanner`).
 *
 * Reading the plan server-side (rather than trusting a client-supplied
 * value) avoids a race where the recommendation changed between the page
 * load and the dismiss click.
 */

import { NextRequest, NextResponse } from "next/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const shopId = extractShopId(req);
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const sb = getServiceClient();

  const { data: row } = await sb
    .from("plan_recommendations")
    .select("recommended_plan")
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ error: "no_recommendation" }, { status: 404 });
  }

  const recommendedPlan = row.recommended_plan as string;
  const now = new Date().toISOString();

  const { error } = await sb
    .from("plan_recommendations")
    .update({
      dismissed_plan: recommendedPlan,
      dismissed_at: now,
      updated_at: now,
    })
    .eq("shop_id", shopId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await sb.from("audit_events").insert({
    shop_id: shopId,
    actor_type: "merchant",
    event_type: "plan_recommendation_dismissed",
    event_payload: { dismissed_plan: recommendedPlan },
  });

  return NextResponse.json({ ok: true });
}
