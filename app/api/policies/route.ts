import { NextRequest, NextResponse } from "next/server";
import { getPortalUser } from "@/lib/supabase/portal";
import { getLinkedShops } from "@/lib/portal/activeShop";
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

/**
 * DELETE /api/policies
 *
 * Body: { shop_id: string }. Clears all policy snapshots for the shop.
 * Requires portal user with access to the shop.
 */
export async function DELETE(req: NextRequest) {
  const user = await getPortalUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { shop_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const shopId = body.shop_id;
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const shops = await getLinkedShops(user.id);
  const hasAccess = shops.some((s) => s.shop_id === shopId);
  if (!hasAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sb = getServiceClient();
  const { error } = await sb.from("policy_snapshots").delete().eq("shop_id", shopId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
