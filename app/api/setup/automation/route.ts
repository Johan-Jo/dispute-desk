import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import {
  listActivePacksOrderedForAutomation,
  listInstalledTemplateIdsForShop,
} from "@/lib/db/packs";
import {
  buildAutomationPayloadFromPackModes,
  parsePackModesFromRules,
  validatePackModes,
  type PackHandlingUiMode,
} from "@/lib/rules/packHandlingAutomation";
import { replacePackBasedAutomationRules } from "@/lib/rules/replacePackAutomationRules";
import {
  replaceSetupAutomationRules,
  type AutomationSetupPayload,
} from "@/lib/rules/setupAutomation";
import { validateAutomationSetupPayload } from "@/lib/rules/validateAutomationSetup";
import type { Rule } from "@/lib/rules/types";
import { checkFeatureAccess } from "@/lib/billing/checkQuota";
import { DISPUTE_REASONS_ORDER } from "@/lib/rules/disputeReasons";

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
  const activePacks = await listActivePacksOrderedForAutomation(shopId);
  const fromRules = parsePackModesFromRules((rules ?? []) as Rule[]);
  const pack_modes: Record<string, PackHandlingUiMode> = {};
  for (const p of activePacks) {
    pack_modes[p.id] = fromRules[p.id] ?? "manual";
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
    reason_rows?: AutomationSetupPayload["reason_rows"];
    safeguards?: AutomationSetupPayload["safeguards"];
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

  if (rec.pack_modes && typeof rec.pack_modes === "object") {
    const packs = await listActivePacksOrderedForAutomation(shopId);
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

  const payload: AutomationSetupPayload = {
    reason_rows: rec.reason_rows ?? [],
    safeguards: rec.safeguards ?? {
      high_value_review_enabled: false,
      high_value_min: 500,
      catch_all_review_enabled: false,
    },
  };

  if (!payload.reason_rows?.length || !payload.safeguards) {
    return NextResponse.json(
      { error: "reason_rows and safeguards are required" },
      { status: 400 }
    );
  }

  const reasonSet = new Set(payload.reason_rows.map((r) => r.reason));
  for (const code of DISPUTE_REASONS_ORDER) {
    if (!reasonSet.has(code)) {
      return NextResponse.json(
        { error: "incomplete_reason_rows" },
        { status: 400 }
      );
    }
  }

  const installedTemplateIds = await listInstalledTemplateIdsForShop(shopId);
  const err = validateAutomationSetupPayload(
    payload,
    new Set(installedTemplateIds)
  );
  if (err) {
    return NextResponse.json({ error: err }, { status: 400 });
  }

  try {
    await replaceSetupAutomationRules(shopId, payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
