import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { DISPUTE_REASON_FAMILIES, type AllDisputeReasonCode } from "@/lib/rules/disputeReasons";
import { normalizeMode } from "@/lib/rules/normalizeMode";
import { loadEffectivePackView } from "@/lib/packs/effectivePackView";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/disputes/:id
 *
 * Returns a single dispute with all columns + linked evidence packs.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const shopId = extractShopId(req);
  if (!shopId || shopId === "demo") {
    return NextResponse.json(
      { error: "Shop context required.", code: "SHOP_CONTEXT_REQUIRED" },
      { status: 401 },
    );
  }
  const sb = getServiceClient();

  const { data: row, error } = await sb
    .from("disputes")
    .select("*, shops(shop_domain)")
    .eq("id", id)
    .eq("shop_id", shopId)
    .single();

  if (error || !row) {
    return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
  }

  const shop = Array.isArray(row.shops) ? row.shops[0] : row.shops;
  const shop_domain = (shop as { shop_domain?: string } | null)?.shop_domain ?? null;
  const { shops: _s, ...dispute } = row as typeof row & { shops?: unknown };

  const { data: packRows } = await sb
    .from("evidence_packs")
    .select(
      "id, status, completeness_score, blockers, recommended_actions, saved_to_shopify_at, created_at, updated_at, checklist_v2, pack_json, response_cycle"
    )
    .eq("dispute_id", id)
    .order("created_at", { ascending: false });

  // PR 5: ADD `merchant_completeness` (the embedded app's single percentage,
  // over the effective rows) beside the stored `completeness_score`, which stays
  // as is. Null when there is no stored v2 checklist: the page falls back to the
  // stored score. The heavy columns used to compute it are not returned.
  const packIds = (packRows ?? []).map((p) => p.id as string);
  const { data: itemRows } = packIds.length
    ? await sb.from("evidence_items").select("pack_id, source, payload").in("pack_id", packIds)
    : { data: [] as Array<{ pack_id: string; source: string; payload: unknown }> };
  const packs = await Promise.all(
    (packRows ?? []).map(async (row) => {
      const { checklist_v2, pack_json, response_cycle, ...stored } = row as typeof row & {
        checklist_v2?: unknown;
        pack_json?: { sections?: unknown } | null;
        response_cycle?: number | null;
      };
      const effective = await loadEffectivePackView(sb, {
        shopId,
        disputeId: id,
        packCycle: response_cycle ?? 1,
        checklistV2: checklist_v2 ?? null,
        packSections: pack_json?.sections,
        evidenceItems: (itemRows ?? []).filter((i) => i.pack_id === row.id) as never,
      });
      return {
        ...stored,
        merchant_completeness: effective ? effective.merchantCompleteness : null,
      };
    }),
  );

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
    packs,
    shop_domain,
    matchedRule,
  });
}
