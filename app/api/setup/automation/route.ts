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
 * READ-ONLY. Returns installed templates + active packs for the wizard's
 * handling step and the activate summary.
 *
 * The POST was DELETED (2026-07-28). It called
 * `replacePackBasedAutomationRules`, whose `LIKE '__dd_setup__%'` delete
 * removes the canonical `__dd_setup__:fallback:default` and
 * `__dd_setup__:safeguard:high_value` rows — so calling it silently turned
 * off a merchant's auto-pilot and wiped their high-value threshold.
 *
 * It also stopped returning `pack_modes`: per-pack rules were removed by
 * migration 20260727120000, so that field was derived entirely from a
 * `?? "review"` fallback and made callers display "Require my approval" on
 * a store genuinely set to auto. The store-wide mode lives at
 * GET|PUT /api/automation/store.
 */
export async function GET(req: NextRequest) {
  const shopId = getShopId(req);
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const sb = getServiceClient();

  // Plan-gate flag for merchant-authored custom rules.
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
