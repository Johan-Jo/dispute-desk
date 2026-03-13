import { NextRequest, NextResponse } from "next/server";
import { checkPackQuota } from "@/lib/billing/checkQuota";
import { getPlan } from "@/lib/billing/plans";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/billing/usage?shop_id=...
 *
 * Returns current plan, usage, and quota info.
 */
export async function GET(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get("shop_id");
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
  const quota = await checkPackQuota(shopId);

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
    shop_domain: (shop as { shop_domain?: string } | null)?.shop_domain ?? null,
  });
}
