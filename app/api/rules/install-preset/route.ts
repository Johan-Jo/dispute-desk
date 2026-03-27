import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { checkFeatureAccess } from "@/lib/billing/checkQuota";
import { RULE_PRESETS } from "@/lib/rules/presets";

export const runtime = "nodejs";

/**
 * POST /api/rules/install-preset
 *
 * Body: { shop_id: string, preset_ids?: string[] }
 * If preset_ids omitted, installs all presets.
 * Skips presets whose name already exists for this shop (idempotency).
 * Requires Starter or Pro plan (same as POST /api/rules).
 */
export async function POST(req: NextRequest) {
  let body: { shop_id?: string; preset_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const shopId = body.shop_id ?? req.headers?.get("x-shop-id") ?? null;
  if (!shopId) {
    return NextResponse.json({ error: "shop_id is required" }, { status: 400 });
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

  const presetIds = body.preset_ids?.length
    ? body.preset_ids
    : RULE_PRESETS.map((p) => p.id);
  const toInstall = RULE_PRESETS.filter((p) => presetIds.includes(p.id));

  const { data: existingRules } = await sb
    .from("rules")
    .select("name")
    .eq("shop_id", shopId);

  const existingNames = new Set((existingRules ?? []).map((r) => r.name).filter(Boolean));

  const created: unknown[] = [];
  for (const preset of toInstall) {
    if (existingNames.has(preset.name)) continue;

    const { data: row, error } = await sb
      .from("rules")
      .insert({
        shop_id: shopId,
        name: preset.name,
        match: preset.match,
        action: preset.action,
        enabled: true,
        priority: preset.priority,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: `Failed to create rule: ${error.message}` },
        { status: 500 }
      );
    }
    created.push(row);
    existingNames.add(preset.name);
  }

  return NextResponse.json(created, { status: 201 });
}
