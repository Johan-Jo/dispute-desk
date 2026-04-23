import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { DISPUTE_REASON_FAMILIES, type AllDisputeReasonCode } from "@/lib/rules/disputeReasons";
import { normalizeMode } from "@/lib/rules/normalizeMode";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/disputes/:id
 *
 * Returns a single dispute with all columns + linked evidence packs.
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const sb = getServiceClient();

  const { data: row, error } = await sb
    .from("disputes")
    .select("*, shops(shop_domain)")
    .eq("id", id)
    .single();

  if (error || !row) {
    return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
  }

  const shop = Array.isArray(row.shops) ? row.shops[0] : row.shops;
  const shop_domain = (shop as { shop_domain?: string } | null)?.shop_domain ?? null;
  const { shops: _s, ...dispute } = row as typeof row & { shops?: unknown };

  const { data: packs } = await sb
    .from("evidence_packs")
    .select(
      "id, status, completeness_score, blockers, recommended_actions, saved_to_shopify_at, created_at, updated_at"
    )
    .eq("dispute_id", id)
    .order("created_at", { ascending: false });

  // Fetch the first enabled automation rule for this shop (powers "Managed by DisputeDesk" card)
  let matchedRule: { name: string; mode: string } | null = null;
  if (dispute.shop_id) {
    const { data: rules } = await sb
      .from("rules")
      .select("name, action")
      .eq("shop_id", dispute.shop_id)
      .eq("enabled", true)
      .order("priority", { ascending: true })
      .limit(1);
    if (rules && rules.length > 0) {
      const action = rules[0].action as { mode?: string } | null;
      matchedRule = { name: rules[0].name, mode: normalizeMode(action?.mode) };
    }
  }

  const family =
    DISPUTE_REASON_FAMILIES[dispute.reason as AllDisputeReasonCode] ?? "General";
  const handling_mode = normalizeMode(matchedRule?.mode);

  return NextResponse.json({
    dispute: { ...dispute, family, handling_mode },
    packs: packs ?? [],
    shop_domain,
    matchedRule,
  });
}
