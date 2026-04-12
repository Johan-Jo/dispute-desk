import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { DISPUTE_FAMILIES } from "@/lib/coverage/deriveCoverage";
import { SETUP_RULE_PREFIX } from "@/lib/rules/setupAutomation";

export const runtime = "nodejs";

const COVERAGE_RULE_PREFIX = `${SETUP_RULE_PREFIX}coverage:`;

type WizardMode = "automated" | "review" | "notify";

function mapWizardMode(mode: WizardMode): string {
  switch (mode) {
    case "automated": return "auto_pack";
    case "review": return "review";
    case "notify": return "notify";
    default: return "manual";
  }
}

/**
 * POST /api/setup/coverage-rules
 *
 * Creates family-level automation rules from the wizard's coverage settings.
 * These run at priority 10 (below pack-specific rules at 20+) so they serve
 * as defaults that the automation step can override per-pack.
 *
 * Body: { coverageSettings: { fraud: "automated", pnr: "review", ... } }
 */
export async function POST(req: NextRequest) {
  const shopId =
    req.headers.get("x-shop-id") ??
    req.cookies?.get?.("dd_active_shop")?.value ??
    req.cookies?.get?.("active_shop_id")?.value;

  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  let body: { coverageSettings?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const settings = body.coverageSettings;
  if (!settings || typeof settings !== "object") {
    return NextResponse.json({ error: "coverageSettings required" }, { status: 400 });
  }

  const sb = getServiceClient();

  // Delete existing coverage-level rules (idempotent)
  await sb
    .from("rules")
    .delete()
    .eq("shop_id", shopId)
    .like("name", `${COVERAGE_RULE_PREFIX}%`);

  // Build family-level rules
  const familyMap = new Map(DISPUTE_FAMILIES.map((f) => [f.id, f]));
  // Also map "digital" to general family
  const digitalFamily = familyMap.get("general");

  const rows: Array<{
    shop_id: string;
    enabled: boolean;
    name: string;
    match: Record<string, unknown>;
    action: Record<string, unknown>;
    priority: number;
  }> = [];

  for (const [familyId, mode] of Object.entries(settings)) {
    const family = familyId === "digital" ? digitalFamily : familyMap.get(familyId);
    if (!family) continue;

    // Skip if we'd be creating a duplicate for "general" when "digital" and "general" both exist
    if (familyId === "digital" && settings.general) continue;

    rows.push({
      shop_id: shopId,
      enabled: true,
      name: `${COVERAGE_RULE_PREFIX}${familyId}`,
      match: { reason: family.reasons },
      action: { mode: mapWizardMode(mode as WizardMode) },
      priority: 10,
    });
  }

  if (rows.length > 0) {
    const { error } = await sb.from("rules").insert(rows);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, rulesCreated: rows.length });
}
