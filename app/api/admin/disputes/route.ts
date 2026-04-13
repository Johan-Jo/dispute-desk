import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/admin/disputes
 *
 * Cross-shop disputes list for admin. Returns all disputes with shop_domain join,
 * note_count, and override indicators.
 *
 * Supports same filters as /api/disputes plus: has_admin_override, has_notes.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sb = getServiceClient();

  let query = sb
    .from("disputes")
    .select("*, shops(shop_domain)", { count: "exact" })
    .order("last_event_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  // Filters
  const shopId = sp.get("shop_id");
  if (shopId) query = query.eq("shop_id", shopId);

  const normalizedStatus = sp.get("normalized_status");
  if (normalizedStatus) query = query.in("normalized_status", normalizedStatus.split(","));

  const finalOutcome = sp.get("final_outcome");
  if (finalOutcome) query = query.in("final_outcome", finalOutcome.split(","));

  const needsAttention = sp.get("needs_attention");
  if (needsAttention === "true") query = query.eq("needs_attention", true);

  const syncHealth = sp.get("sync_health");
  if (syncHealth) query = query.eq("sync_health", syncHealth);

  const hasOverride = sp.get("has_admin_override");
  if (hasOverride === "true") query = query.eq("has_admin_override", true);

  const phase = sp.get("phase");
  if (phase) query = query.eq("phase", phase);

  // Pagination
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const perPage = Math.min(100, Math.max(1, parseInt(sp.get("per_page") ?? "50", 10)));
  const from = (page - 1) * perPage;
  query = query.range(from, from + perPage - 1);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const disputes = (data ?? []).map((row) => {
    const shop = Array.isArray(row.shops) ? row.shops[0] : row.shops;
    const shopDomain = (shop as { shop_domain?: string } | null)?.shop_domain ?? null;
    const { shops: _s, ...dispute } = row as typeof row & { shops?: unknown };
    return { ...dispute, shop_domain: shopDomain };
  });

  // Get note counts for these disputes
  const disputeIds = disputes.map((d) => d.id);
  const noteCounts: Record<string, number> = {};
  if (disputeIds.length > 0) {
    const { data: notes } = await sb
      .from("dispute_notes")
      .select("dispute_id")
      .in("dispute_id", disputeIds);

    for (const n of notes ?? []) {
      noteCounts[n.dispute_id] = (noteCounts[n.dispute_id] ?? 0) + 1;
    }
  }

  const enriched = disputes.map((d) => ({
    ...d,
    note_count: noteCounts[d.id] ?? 0,
  }));

  return NextResponse.json({
    disputes: enriched,
    pagination: {
      page,
      per_page: perPage,
      total: count ?? 0,
      total_pages: count ? Math.ceil(count / perPage) : 0,
    },
  });
}
