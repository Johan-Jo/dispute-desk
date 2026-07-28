import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import {
  listLibraryPacksForAutomationRules,
  listInstalledTemplateIdsForShop,
} from "@/lib/db/packs";
import { checkFeatureAccess } from "@/lib/billing/checkQuota";

export const runtime = "nodejs";

function getShopId(req: NextRequest): string | null {
  return (
    req.nextUrl.searchParams.get("shop_id") ??
    req.headers.get("x-shop-id") ??
    req.cookies?.get?.("dd_active_shop")?.value ??
    req.cookies?.get?.("active_shop_id")?.value ??
    null
  );
}

/**
 * GET /api/setup/automation?shop_id=
 *
 * READ-ONLY. Returns the shop's installed templates + active packs for the
 * wizard's handling step and the activate summary.
 *
 * The POST was DELETED 2026-07-28. It called
 * `replacePackBasedAutomationRules`, whose `LIKE '__dd_setup__%'` delete
 * destroys the canonical `__dd_setup__:fallback:default` and
 * `__dd_setup__:safeguard:high_value` rows — so a stale client could
 * silently turn off a merchant's auto-pilot and delete their safeguard.
 * The store-wide switch is written ONLY via PUT /api/automation/store.
 */
export async function GET(req: NextRequest) {
  const shopId = getShopId(req);
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const sb = getServiceClient();

  // Plan gate flag for merchant-authored custom rules. The store-wide
  // handling switch is NOT gated — see app/api/automation/store/route.ts.
  const { data: shop } = await sb
    .from("shops")
    .select("plan")
    .eq("id", shopId)
    .single();
  const rulesAccess = checkFeatureAccess(shop?.plan ?? "free", "rules");

  const installedTemplateIds = await listInstalledTemplateIdsForShop(shopId);
  const activePacks = await listLibraryPacksForAutomationRules(shopId);

  return NextResponse.json({
    installedTemplateIds,
    activePacks,
    rulesAccess: {
      allowed: rulesAccess.allowed,
      reason: rulesAccess.reason ?? null,
    },
  });
}
