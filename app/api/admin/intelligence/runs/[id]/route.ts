import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/admin/auth";
import { getRun } from "@/lib/intelligence/runs";
import { listRecommendations } from "@/lib/intelligence/recommendations";

export const runtime = "nodejs";

/** GET /api/admin/intelligence/runs/[id] — a single run incl. data-quality,
 *  baseline report, and its recommendations. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAdminSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const run = await getRun(id);
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const recommendations = await listRecommendations(id, run.shop_id);
  return NextResponse.json({ run, recommendations });
}
