import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import {
  listLibraryPacksForAutomationRules,
  listInstalledTemplateIdsForShop,
} from "@/lib/db/packs";
import {
  buildAutomationPayloadFromPackModes,
  parsePackModesFromRules,
  parseCoverageModesFromRules,
  validatePackModes,
  disputeTypeToPrimaryReason,
  type PackHandlingUiMode,
} from "@/lib/rules/packHandlingAutomation";
import { replacePackBasedAutomationRules } from "@/lib/rules/replacePackAutomationRules";
import type { Rule } from "@/lib/rules/types";
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
 * Returns reason rows, safeguards, and installed template IDs for dropdowns.
 */
export async function GET(req: NextRequest) {
  const shopId = getShopId(req);
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const sb = getServiceClient();
  const { data: rules, error } = await sb
    .from("rules")
    .select("*")
    .eq("shop_id", shopId)
    .order("priority", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const installedTemplateIds = await listInstalledTemplateIdsForShop(shopId);
  const activePacks = await listLibraryPacksForAutomationRules(shopId);
  const allRules = (rules ?? []) as Rule[];
  const fromRules = parsePackModesFromRules(allRules);
  const coverageModes = parseCoverageModesFromRules(allRules);
  const pack_modes: Record<string, PackHandlingUiMode> = {};
  for (const p of activePacks) {
    if (fromRules[p.id]) {
      pack_modes[p.id] = fromRules[p.id];
    } else {
      // Fall back to coverage-level rules from the wizard. When no coverage
      // rule is configured we default to "review" — the safest outcome under
      // the two-mode model (build pack, hold for merchant approval).
      const reason = disputeTypeToPrimaryReason(p.dispute_type);
      pack_modes[p.id] = coverageModes.get(reason) ?? "review";
    }
  }

  const payloadFromPacks = buildAutomationPayloadFromPackModes(
    activePacks,
    pack_modes,
    new Set(installedTemplateIds)
  );

  return NextResponse.json({
    ...payloadFromPacks,
    installedTemplateIds,
    activePacks,
    pack_modes,
    packAutomation: true,
  });
}

/**
 * POST /api/setup/automation
 * Replaces setup-managed rules (and legacy preset rows) with the payload.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rec = body as {
    shop_id?: string;
    pack_modes?: Record<string, PackHandlingUiMode>;
  };

  const shopId = rec.shop_id ?? getShopId(req) ?? null;
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const sb = getServiceClient();
  const { data: shop } = await sb.from("shops").select("plan").eq("id", shopId).single();
  const access = checkFeatureAccess(shop?.plan ?? "free", "rules");
  if (!access.allowed) {
    return NextResponse.json(
      { error: access.reason, upgrade_required: true },
      { status: 403 }
    );
  }

  if (!rec.pack_modes || typeof rec.pack_modes !== "object") {
    return NextResponse.json(
      { error: "pack_modes is required" },
      { status: 400 },
    );
  }

  const packs = await listLibraryPacksForAutomationRules(shopId);
  const packModes = rec.pack_modes;
  const validIds = new Set(packs.map((p) => p.id));
  for (const key of Object.keys(packModes)) {
    if (!validIds.has(key)) {
      return NextResponse.json({ error: "unknown_pack_id" }, { status: 400 });
    }
  }
  const installedTemplateIds = await listInstalledTemplateIdsForShop(shopId);
  const vErr = validatePackModes(
    packs,
    packModes,
    new Set(installedTemplateIds)
  );
  if (vErr) {
    return NextResponse.json({ error: vErr }, { status: 400 });
  }
  try {
    await replacePackBasedAutomationRules(shopId, packs, packModes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
