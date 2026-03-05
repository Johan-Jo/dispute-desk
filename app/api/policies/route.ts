import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

/**
 * GET /api/policies?shop_id=...
 *
 * Returns policy snapshots for the shop (for portal Policies page preview).
 */
export async function GET(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get("shop_id") ?? req.headers.get("x-shop-id");

  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("policy_snapshots")
    .select("id, policy_type, url, captured_at")
    .eq("shop_id", shopId)
    .order("captured_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // One row per policy_type (most recent)
  const byType = new Map<string, (typeof data)[0]>();
  for (const row of data ?? []) {
    if (!byType.has(row.policy_type)) {
      byType.set(row.policy_type, row);
    }
  }

  return NextResponse.json({
    policies: Array.from(byType.values()),
  });
}
