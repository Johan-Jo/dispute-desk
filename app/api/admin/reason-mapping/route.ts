import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { listReasonMappings, getReasonMappingStats } from "@/lib/db/reasonMappings";
import type { DisputePhase } from "@/lib/rules/disputeReasons";

export const runtime = "nodejs";

/** GET /api/admin/reason-mapping — list all reason mappings */
export async function GET(req: NextRequest) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const phase = (sp.get("phase") as DisputePhase) || undefined;
  const includeStats = sp.get("stats") === "true";

  const mappings = await listReasonMappings(phase);

  if (includeStats) {
    const stats = await getReasonMappingStats(phase);
    return NextResponse.json({ mappings, stats });
  }

  return NextResponse.json(mappings);
}
