import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

/**
 * GET /api/disputes
 *
 * Query params:
 *   shop_id (required) — filter by shop
 *   status — comma-separated: open,won,lost,pending,needs_response,under_review
 *   due_before — ISO date, show disputes due before this date
 *   page — page number (1-indexed, default 1)
 *   per_page — results per page (default 25, max 100)
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const shopId = sp.get("shop_id") ?? req.headers.get("x-shop-id");

  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const sb = getServiceClient();
  let query = sb
    .from("disputes")
    .select("*", { count: "exact" })
    .eq("shop_id", shopId)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  const phaseFilter = sp.get("phase");
  if (phaseFilter) {
    query = query.eq("phase", phaseFilter);
  }

  const statusFilter = sp.get("status");
  if (statusFilter) {
    const statuses = statusFilter.split(",").map((s) => s.trim());
    query = query.in("status", statuses);
  }

  const needsReview = sp.get("needs_review");
  if (needsReview === "true") {
    query = query.eq("needs_review", true);
  } else if (needsReview === "false") {
    query = query.eq("needs_review", false);
  }

  const dueBefore = sp.get("due_before");
  if (dueBefore) {
    query = query.lte("due_at", dueBefore);
  }

  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const perPage = Math.min(100, Math.max(1, parseInt(sp.get("per_page") ?? "25", 10)));
  const from = (page - 1) * perPage;
  query = query.range(from, from + perPage - 1);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Join the latest evidence_packs row per dispute so the list can render
  // pack-state — the merchant needs to know whether DisputeDesk has built a
  // pack, whether it's ready to review, whether it's saved to Shopify, etc.
  // The list page uses this to label the per-row CTA (Review & Save, View in
  // Shopify, Build Evidence, …).
  const disputeIds = (data ?? [])
    .map((d) => (d as { id?: string }).id)
    .filter((id): id is string => Boolean(id));

  const packStatusByDispute = new Map<string, string>();
  if (disputeIds.length > 0) {
    const { data: packRows } = await sb
      .from("evidence_packs")
      .select("dispute_id, status, updated_at")
      .in("dispute_id", disputeIds)
      .order("updated_at", { ascending: false });
    for (const row of (packRows ?? []) as Array<{
      dispute_id: string | null;
      status: string | null;
    }>) {
      if (row.dispute_id && !packStatusByDispute.has(row.dispute_id)) {
        packStatusByDispute.set(row.dispute_id, row.status ?? "");
      }
    }
  }

  const disputes = (data ?? []).map((d) => {
    const id = (d as { id?: string }).id;
    return {
      ...d,
      pack_status: id ? packStatusByDispute.get(id) ?? null : null,
    };
  });

  return NextResponse.json({
    disputes,
    pagination: {
      page,
      per_page: perPage,
      total: count ?? 0,
      total_pages: count ? Math.ceil(count / perPage) : 0,
    },
  });
}
