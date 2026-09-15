import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/admin/shops/:id/activity — what people did on this shop.
 *
 * HUMAN ACTORS ONLY by default (`merchant`, `admin`). The `system` actor is
 * excluded because it is almost entirely automation heartbeat: on shop
 * ea035a1b a single day carried ~14 `disputes_synced` rows and 5 job-lock
 * reclaims against 3 real merchant actions, so including it buries the thing
 * the page is asked to show. `?actors=all` returns everything.
 *
 * `script` is grouped with automation rather than with people: it is a human
 * operator's doing, but it is OUR tooling acting on the shop, not the
 * merchant working in the app.
 *
 * Attribution only became trustworthy on 2026-09-15 (migration
 * 20260915120000 + resolveAuditActor). Rows written before then record
 * `merchant` for every request-scoped write, including ours under
 * impersonation — the UI says so rather than implying the history is clean.
 */
const ATTRIBUTION_TRUSTWORTHY_FROM = "2026-09-15T00:00:00Z";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const all = req.nextUrl.searchParams.get("actors") === "all";
  const limit = Math.min(
    Number(req.nextUrl.searchParams.get("limit") ?? 50) || 50,
    200,
  );

  const sb = getServiceClient();
  let q = sb
    .from("audit_events")
    .select(
      "id, created_at, actor_type, actor_id, event_type, event_payload, dispute_id",
    )
    .eq("shop_id", id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!all) q = q.in("actor_type", ["merchant", "admin"]);

  const { data, error } = await q;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    events: data ?? [],
    attributionTrustworthyFrom: ATTRIBUTION_TRUSTWORTHY_FROM,
  });
}
