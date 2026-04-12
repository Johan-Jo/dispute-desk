import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

/**
 * GET /api/auth/shopify/session-exists?shop=xxx.myshopify.com
 *
 * Lightweight check used by middleware to verify that a valid offline session
 * exists for the given shop domain. Returns { exists: boolean }.
 *
 * This prevents stale `shopify_shop` cookies (left over after an uninstall)
 * from bypassing OAuth on reinstall.
 *
 * Protected by an internal secret header to prevent external abuse.
 */
export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-dd-internal-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const shop = req.nextUrl.searchParams.get("shop");
  if (!shop) {
    return NextResponse.json({ exists: false });
  }

  const db = getServiceClient();

  // Look up the shop's internal ID first, then check for an offline session.
  const { data: shopRow } = await db
    .from("shops")
    .select("id, uninstalled_at")
    .eq("shop_domain", shop)
    .maybeSingle();

  if (!shopRow || shopRow.uninstalled_at) {
    return NextResponse.json({ exists: false });
  }

  const { count } = await db
    .from("shop_sessions")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopRow.id)
    .eq("session_type", "offline");

  return NextResponse.json({ exists: (count ?? 0) > 0 });
}
