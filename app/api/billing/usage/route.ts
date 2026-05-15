import { NextRequest, NextResponse } from "next/server";
import { checkPackQuota } from "@/lib/billing/checkQuota";
import { getPlan } from "@/lib/billing/plans";
import { checkTrialEligibility } from "@/lib/billing/trialEligibility";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";

export const runtime = "nodejs";

/**
 * GET /api/billing/usage?shop_id=...
 *
 * Returns current plan, usage, and trial eligibility. The billing
 * page uses `trialEligible` to branch CTA labels — first-time
 * customers see "Start 14-Day Trial" while merchants who've trialed
 * before see "Upgrade to <plan>" and an instant plan change.
 */
export async function GET(req: NextRequest) {
  const shopId = extractShopId(req);
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const sb = getServiceClient();
  const { data: shop } = await sb
    .from("shops")
    .select("plan, shop_domain")
    .eq("id", shopId)
    .single();

  const planId = shop?.plan ?? "free";
  const plan = getPlan(planId);
  const [quota, trialEligibility] = await Promise.all([
    checkPackQuota(shopId),
    checkTrialEligibility(shopId),
  ]);

  return NextResponse.json({
    plan: {
      id: plan.id,
      name: plan.name,
      price: plan.price,
      packsPerMonth: plan.packsPerMonth,
      autoPack: plan.autoPack,
      rules: plan.rules,
    },
    usage: {
      packsUsed: quota.used,
      packsLimit: quota.limit,
      packsRemaining: quota.remaining,
    },
    trialEligible: trialEligibility.eligible,
    shop_domain: (shop as { shop_domain?: string } | null)?.shop_domain ?? null,
  });
}
