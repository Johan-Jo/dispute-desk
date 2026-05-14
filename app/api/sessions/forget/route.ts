import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";

export const runtime = "nodejs";

/**
 * POST /api/sessions/forget
 *
 * LGPD / GDPR / CCPA subject-deletion endpoint. Deletes all
 * checkout_sessions rows for a given customer_id or cart_token within
 * the requesting shop. Authenticated against the shop's session — the
 * merchant is acting on behalf of their data subject.
 *
 * Body: { customer_id?: string, cart_token?: string }
 *   - At least one required.
 *
 * Returns the count of deleted rows. Idempotent.
 */
export async function POST(req: NextRequest) {
  const shopId = extractShopId(req);
  if (!shopId || shopId === "demo") {
    return NextResponse.json(
      { error: "Shop context required.", code: "SHOP_CONTEXT_REQUIRED" },
      { status: 401 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    customer_id?: string;
    cart_token?: string;
  };

  if (!body.customer_id && !body.cart_token) {
    return NextResponse.json(
      { error: "Either customer_id or cart_token is required." },
      { status: 400 },
    );
  }

  const sb = getServiceClient();
  let q = sb.from("checkout_sessions").delete({ count: "exact" }).eq("shop_id", shopId);
  if (body.customer_id) q = q.eq("customer_id", body.customer_id);
  if (body.cart_token) q = q.eq("cart_token", body.cart_token);

  const { error, count } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted: count ?? 0 });
}
