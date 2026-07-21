import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/admin/auth";
import { getRecommendationById, logDecision } from "@/lib/intelligence/recommendations";
import { METHODOLOGY_VERSION } from "@/lib/intelligence/config";

export const runtime = "nodejs";

const ACTIONS = new Set(["shown", "accepted", "rejected", "marked_later", "modified", "activated", "overridden"]);

/** POST { recommendationId, action, reason? } — record an admin decision on a
 *  recommendation (foundation for prospective validation, §23). Release 1 only
 *  logs the decision; it never acts on the dispute. */
export async function POST(req: NextRequest) {
  const user = await getAdminSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = typeof body.recommendationId === "string" ? body.recommendationId : "";
  const action = typeof body.action === "string" ? body.action : "";
  if (!id || !ACTIONS.has(action)) {
    return NextResponse.json({ error: "recommendationId and a valid action required" }, { status: 400 });
  }

  const rec = await getRecommendationById(id);
  if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await logDecision({
    shopId: rec.shop_id,
    recommendationId: id,
    analysisRunId: rec.analysis_run_id,
    actor: user.email,
    action: action as "accepted",
    reason: typeof body.reason === "string" ? body.reason : undefined,
    methodologyVersion: METHODOLOGY_VERSION,
  });
  return NextResponse.json({ ok: true });
}
