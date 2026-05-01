import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { getShopRiskProfile } from "@/lib/admin/shopRisk";

export const runtime = "nodejs";

/**
 * GET /api/admin/shops/[id]/risk
 *
 * Returns the merchant risk profile (PRD §9): 30d/90d chargeback
 * rates, totals, reason mix, outcome mix, weekly dispute trend,
 * inquiry-vs-chargeback ratio, sync freshness.
 *
 * Reads exclusively from `shop_daily_metrics` + local `disputes`.
 * No live Shopify calls.
 */
export async function GET(
  _req: Request,
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

  try {
    const profile = await getShopRiskProfile(id);
    return NextResponse.json(profile);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
