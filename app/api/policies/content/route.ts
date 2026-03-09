import { NextRequest, NextResponse } from "next/server";
import { getPortalUser } from "@/lib/supabase/portal";
import { getLinkedShops } from "@/lib/portal/activeShop";
import { getServiceClient } from "@/lib/supabase/server";

/**
 * GET /api/policies/content?shop_id=...&policy_type=...
 *
 * Returns the editable text for the latest policy snapshot of that type, if any.
 * Used to pre-fill the Edit policy modal. Returns { content: string | null }.
 * Requires portal user with access to the shop.
 */
export async function GET(req: NextRequest) {
  const user = await getPortalUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shopId = req.nextUrl.searchParams.get("shop_id");
  const policyType = req.nextUrl.searchParams.get("policy_type");

  if (!shopId || !policyType) {
    return NextResponse.json(
      { error: "shop_id and policy_type are required" },
      { status: 400 }
    );
  }

  const shops = await getLinkedShops(user.id);
  const hasAccess = shops.some((s) => s.shop_id === shopId);
  if (!hasAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("policy_snapshots")
    .select("extracted_text")
    .eq("shop_id", shopId)
    .eq("policy_type", policyType)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const content =
    data?.extracted_text != null && typeof data.extracted_text === "string"
      ? data.extracted_text
      : null;

  return NextResponse.json({ content });
}
