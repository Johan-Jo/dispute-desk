import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/admin/auth";
import { createRun, listRuns } from "@/lib/intelligence/runs";
import { enqueueJob } from "@/lib/jobs/claimJobs";

export const runtime = "nodejs";

/** GET /api/admin/intelligence/runs?shop_id=… — list recent analysis runs. */
export async function GET(req: NextRequest) {
  const user = await getAdminSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const shopId = req.nextUrl.searchParams.get("shop_id");
  if (!shopId) return NextResponse.json({ error: "shop_id required" }, { status: 400 });

  const runs = await listRuns(shopId);
  return NextResponse.json({ runs });
}

/** POST /api/admin/intelligence/runs — trigger a new analysis run for a shop. */
export async function POST(req: NextRequest) {
  const user = await getAdminSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const shopId = typeof body.shopId === "string" ? body.shopId.trim() : "";
  if (!shopId) return NextResponse.json({ error: "shopId required" }, { status: 400 });

  const { runId, duplicate } = await createRun(shopId, user.email);
  if (duplicate || !runId) {
    return NextResponse.json({ duplicate: true, message: "A run is already active for this shop." }, { status: 409 });
  }

  // Enqueue the audit job; the worker (every 2 min) runs it. entity_id = runId.
  await enqueueJob({ shopId, jobType: "intel_run", entityId: runId, priority: 80 });
  return NextResponse.json({ runId, duplicate: false });
}
