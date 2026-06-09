import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/admin/winnability-leads
 *
 * Admin-only (gated by middleware /api/admin/* → Supabase session +
 * internal_admin_grants). Lists 5-Minute Winnability Test leads with search +
 * verdict filter, plus summary stats for the header cards. Every row is a
 * fully-qualified lead (verdict + ratio band + volume); a "win" + "red" lead is
 * a hot prospect.
 *
 * Query: ?search=<email>&verdict=<win|borderline|no|other|all>
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const search = (sp.get("search") ?? "").trim().toLowerCase();
  const verdict = sp.get("verdict") ?? "all";

  const sb = getServiceClient();

  let query = sb
    .from("winnability_leads")
    .select(
      "id, email, store, verdict, lane, ratio_pct, ratio_band, disputes_per_month, orders_per_month, status, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(1000);

  if (search) query = query.ilike("email", `%${search}%`);
  if (["win", "borderline", "no", "other"].includes(verdict)) {
    query = query.eq("verdict", verdict);
  }

  const { data: leads, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Summary stats over the full table (independent of the current filter).
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [{ count: total }, { count: last7d }, { count: winnable }, { count: hot }] =
    await Promise.all([
      sb.from("winnability_leads").select("id", { count: "exact", head: true }),
      sb
        .from("winnability_leads")
        .select("id", { count: "exact", head: true })
        .gte("created_at", sevenDaysAgo),
      sb
        .from("winnability_leads")
        .select("id", { count: "exact", head: true })
        .eq("verdict", "win"),
      sb
        .from("winnability_leads")
        .select("id", { count: "exact", head: true })
        .eq("verdict", "win")
        .eq("ratio_band", "red"),
    ]);

  return NextResponse.json({
    leads: leads ?? [],
    stats: {
      total: total ?? 0,
      last7d: last7d ?? 0,
      winnable: winnable ?? 0,
      hot: hot ?? 0,
    },
  });
}
