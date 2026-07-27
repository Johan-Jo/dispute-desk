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
  const [quota, trialEligibility, topupRows] = await Promise.all([
    checkPackQuota(shopId),
    checkTrialEligibility(shopId),
    // Extra credit grants beyond the monthly allowance — currently
    // unexpired, positive packs. Includes both merchant top-ups
    // (source='topup') AND admin/support grants (source='admin_adjustment')
    // so an admin-granted bundle is VISIBLE in the billing UI instead of
    // silently missing (blume-box's 200 admin packs read as invisible,
    // 2026-07-27). Without this, granted credits appear nowhere beyond the
    // ledger.
    sb
      .from("pack_credits_ledger")
      .select("packs, expires_at, created_at, reference, source")
      .eq("shop_id", shopId)
      .in("source", ["topup", "admin_adjustment"])
      .gt("packs", 0)
      .or("expires_at.is.null,expires_at.gt." + new Date().toISOString())
      .order("expires_at", { ascending: true })
      .then((res) => res.data ?? []),
  ]);

  const topups = (topupRows as Array<{
    packs: number;
    expires_at: string | null;
    created_at: string;
    reference: string | null;
    source: string;
  }>).map((row) => ({
    packs: row.packs,
    expiresAt: row.expires_at,
    purchasedAt: row.created_at,
    reference: row.reference,
    source: row.source,
  }));

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
    topups,
    trialEligible: trialEligibility.eligible,
    shop_domain: (shop as { shop_domain?: string } | null)?.shop_domain ?? null,
  });
}
