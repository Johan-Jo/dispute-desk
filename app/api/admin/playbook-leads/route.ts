import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { NURTURE_SEQUENCE_LENGTH } from "@/lib/marketing/playbook/nurtureSequence";

export const runtime = "nodejs";

/**
 * GET /api/admin/playbook-leads
 *
 * Admin-only (gated by middleware /api/admin/* → Supabase session +
 * internal_admin_grants). Lists inbound Liability-Shift Playbook leads with
 * search + status filter, plus summary stats for the header cards.
 *
 * Query: ?search=<email>&status=<active|unsubscribed|all>
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const search = (sp.get("search") ?? "").trim().toLowerCase();
  const status = sp.get("status") ?? "all";

  const sb = getServiceClient();

  let query = sb
    .from("playbook_leads")
    .select("id, email, source, locale, utm, status, nurture_step, created_at")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (search) query = query.ilike("email", `%${search}%`);
  if (status === "active" || status === "unsubscribed") {
    query = query.eq("status", status);
  }

  const { data: leads, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Summary stats over the full table (independent of the current filter).
  const { count: total } = await sb
    .from("playbook_leads")
    .select("id", { count: "exact", head: true });
  const { count: active } = await sb
    .from("playbook_leads")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");
  const { count: completed } = await sb
    .from("playbook_leads")
    .select("id", { count: "exact", head: true })
    .eq("nurture_step", NURTURE_SEQUENCE_LENGTH);

  // Leads captured in the last 7 days (rough "recent momentum" number).
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { count: last7d } = await sb
    .from("playbook_leads")
    .select("id", { count: "exact", head: true })
    .gte("created_at", sevenDaysAgo);

  return NextResponse.json({
    leads: leads ?? [],
    stats: {
      total: total ?? 0,
      active: active ?? 0,
      unsubscribed: (total ?? 0) - (active ?? 0),
      sequenceComplete: completed ?? 0,
      last7d: last7d ?? 0,
    },
    sequenceLength: NURTURE_SEQUENCE_LENGTH,
  });
}
