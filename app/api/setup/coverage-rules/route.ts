import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { DISPUTE_FAMILIES } from "@/lib/coverage/deriveCoverage";
import { SETUP_RULE_PREFIX } from "@/lib/rules/setupAutomation";
import { normalizeMode, type AutomationMode } from "@/lib/rules/normalizeMode";

export const runtime = "nodejs";

const COVERAGE_RULE_PREFIX = `${SETUP_RULE_PREFIX}coverage:`;
const HIGH_VALUE_SAFEGUARD_NAME = `${SETUP_RULE_PREFIX}safeguard:high_value`;

/**
 * Accept both the new canonical wizard vocabulary (auto/review) and the
 * pre-migration values (automated/notify) so in-flight wizards don't break.
 * Every incoming value is collapsed to the two-mode canonical set.
 */
function mapWizardMode(mode: string): AutomationMode {
  if (mode === "automated") return "auto";
  return normalizeMode(mode);
}

interface HighValueReviewPayload {
  enabled: boolean;
  threshold: number;
}

interface RequestBody {
  coverageSettings?: Record<string, string>;
  highValueReview?: HighValueReviewPayload;
}

/**
 * POST /api/setup/coverage-rules
 *
 * Two independent writes — caller can supply either or both:
 *   - `coverageSettings` → family-level rules at priority 10
 *   - `highValueReview`  → tier-0 amount safeguard at priority 5
 *
 * Each key replaces only the rules it owns (delete-then-insert keyed by
 * the rule `name`), so the Coverage and Automation wizard steps can hit
 * this route independently without clobbering each other's rules.
 *
 * Body: { coverageSettings?: { fraud: "automated", pnr: "review", ... },
 *         highValueReview?: { enabled: boolean, threshold: number } }
 */
export async function POST(req: NextRequest) {
  const shopId =
    req.headers.get("x-shop-id") ??
    req.cookies?.get?.("dd_active_shop")?.value ??
    req.cookies?.get?.("active_shop_id")?.value;

  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.coverageSettings && !body.highValueReview) {
    return NextResponse.json(
      { error: "coverageSettings or highValueReview required" },
      { status: 400 }
    );
  }

  const sb = getServiceClient();
  let coverageRulesCreated = 0;
  let safeguardWritten = false;

  // 1) Coverage settings (family-level rules)
  if (body.coverageSettings && typeof body.coverageSettings === "object") {
    const settings = body.coverageSettings;

    await sb
      .from("rules")
      .delete()
      .eq("shop_id", shopId)
      .like("name", `${COVERAGE_RULE_PREFIX}%`);

    const familyMap = new Map(DISPUTE_FAMILIES.map((f) => [f.id, f]));
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
      if (familyId === "digital" && settings.general) continue;

      rows.push({
        shop_id: shopId,
        enabled: true,
        name: `${COVERAGE_RULE_PREFIX}${familyId}`,
        match: { reason: family.reasons },
        action: { mode: mapWizardMode(mode) },
        priority: 10,
      });
    }

    if (rows.length > 0) {
      const { error } = await sb.from("rules").insert(rows);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      coverageRulesCreated = rows.length;
    }
  }

  // 2) High-value review safeguard (tier-0 amount rule)
  if (body.highValueReview) {
    const { enabled, threshold } = body.highValueReview;

    // Always delete the existing safeguard row first so the route is
    // idempotent and toggling off cleanly removes the rule.
    await sb
      .from("rules")
      .delete()
      .eq("shop_id", shopId)
      .eq("name", HIGH_VALUE_SAFEGUARD_NAME);

    if (enabled && typeof threshold === "number" && threshold > 0) {
      const { error } = await sb.from("rules").insert([
        {
          shop_id: shopId,
          enabled: true,
          name: HIGH_VALUE_SAFEGUARD_NAME,
          match: { amount_range: { min: threshold } },
          // pack_template_id is intentionally omitted — tier-0 amount
          // safeguards only force review mode; the actual pack template
          // is resolved by the lower-priority per-reason rule's template,
          // or by reason_template_mappings as fallback.
          action: { mode: "review" },
          priority: 5,
        },
      ]);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      safeguardWritten = true;
    }
  }

  return NextResponse.json({
    ok: true,
    coverageRulesCreated,
    safeguardWritten,
  });
}
