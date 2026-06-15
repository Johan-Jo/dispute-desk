import { NextRequest, NextResponse } from "next/server";
import { loadSession } from "@/lib/shopify/sessionStorage";
import { findMissingScopes } from "@/lib/shopify/scopes";
import { getServiceClient } from "@/lib/supabase/server";

/**
 * GET /api/shop/scope-status[?shop_id=…|?shop=<domain>]
 *
 * Compares the shop's granted offline-session scopes against the scopes
 * the app currently requires (SHOPIFY_SCOPES) and reports which are
 * missing. Drives the re-auth banner that rolls a new scope out to the
 * installed base without an uninstall/reinstall.
 *
 * No DB writes — purely derived. Returns missingScopes: [] (and
 * needsReauth: false) when the grant is current or no session exists
 * (a missing session is a "reconnect" concern handled by readiness,
 * not a scope-upgrade nag).
 */
export async function GET(req: NextRequest) {
  const url = "nextUrl" in req && req.nextUrl ? req.nextUrl : new URL(req.url);
  let shopId =
    url.searchParams.get("shop_id") ??
    req.headers.get("x-shop-id") ??
    req.cookies?.get?.("dd_active_shop")?.value ??
    req.cookies?.get?.("active_shop_id")?.value;

  // Embedded fallback: resolve by ?shop=<domain> when the CHIPS shop-id
  // cookie didn't ride along (mirrors /api/setup/readiness).
  const shopDomain = url.searchParams.get("shop");
  if ((!shopId || shopId === "demo") && shopDomain) {
    const { data } = await getServiceClient()
      .from("shops")
      .select("id")
      .eq("shop_domain", shopDomain)
      .maybeSingle();
    if (data?.id) shopId = data.id;
  }

  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const session = await loadSession(shopId, "offline");
  if (!session) {
    return NextResponse.json({ needsReauth: false, missingScopes: [] });
  }

  // read_all_orders has its own dedicated nudge with backfill-reset
  // semantics (DashboardScopeUpgradeBanner) — exclude it here so a shop
  // missing it doesn't get two stacked re-auth banners.
  const missingScopes = findMissingScopes(session.scopes).filter(
    (s) => s !== "read_all_orders",
  );
  return NextResponse.json({
    needsReauth: missingScopes.length > 0,
    missingScopes,
  });
}
