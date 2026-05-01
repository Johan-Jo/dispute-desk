import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { getShopRiskProfile, type RiskPeriod } from "@/lib/admin/shopRisk";

export const runtime = "nodejs";

const VALID_PERIODS: RiskPeriod[] = ["30d", "90d", "180d", "all"];

/**
 * GET /api/admin/shops/[id]/risk?period=30d|90d|180d|all
 *
 * Returns the period-scoped merchant risk profile (PRD §9 / Figma
 * `pages/admin/shop-detail.tsx`): chargeback rate for the period,
 * totals with prior-period deltas, reason mix, outcome mix, win
 * rate, weekly trend (disputes + orders), inquiry-vs-chargeback
 * signal, sync freshness, data completeness, and approximate
 * billing figures.
 *
 * Reads exclusively from `shop_daily_metrics` + local `disputes` +
 * `shops.plan`. No live Shopify calls.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const isAdmin = await hasAdminSession();
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "shop id required" }, { status: 400 });
  }

  const periodParam = req.nextUrl.searchParams.get("period");
  const period = (
    periodParam && VALID_PERIODS.includes(periodParam as RiskPeriod)
      ? periodParam
      : "90d"
  ) as RiskPeriod;

  try {
    const profile = await getShopRiskProfile(id, { period });
    return NextResponse.json(profile);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
