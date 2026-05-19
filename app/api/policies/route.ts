import { NextRequest, NextResponse } from "next/server";
import { getPortalUser } from "@/lib/supabase/portal";
import { getLinkedShops } from "@/lib/portal/activeShop";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";

/**
 * GET /api/policies?shop_id=...
 *
 * Returns policy snapshots for the shop (for portal Policies page preview).
 */
export async function GET(req: NextRequest) {
  const shopId = extractShopId(req);

  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const sb = getServiceClient();
  // Note: `url` was previously selected here and returned to the
  // browser. It held a 1-year Supabase signed URL — a real
  // signed-URL leak. The proxy route `/api/policies/[id]/file`
  // replaces direct URL exposure; we return only the id + metadata.
  const { data, error } = await sb
    .from("policy_snapshots")
    .select("id, policy_type, captured_at, storage_path")
    .eq("shop_id", shopId)
    .order("captured_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    id: string;
    policy_type: string;
    captured_at: string;
    storage_path: string | null;
  };
  const byType = new Map<string, Row>();
  for (const row of (data ?? []) as Row[]) {
    if (!byType.has(row.policy_type)) {
      byType.set(row.policy_type, row);
    }
  }

  // Surface a stable proxy URL the portal can pass to window.open.
  // The proxy authorizes the request via portal session, so the URL
  // alone is not enough to read the file.
  const policies = Array.from(byType.values()).map((row) => ({
    id: row.id,
    policy_type: row.policy_type,
    captured_at: row.captured_at,
    file_url: row.storage_path ? `/api/policies/${row.id}/file` : null,
  }));

  return NextResponse.json({ policies });
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
