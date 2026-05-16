/**
 * GET /api/admin/defence-package/runs
 *
 * Paginated list of recent LLM runs. Used by the admin dashboard.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { hasAdminSession } from "@/lib/admin/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? "50"), 200);
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("defence_package_runs")
    .select(
      "id, package_id, shop_id, prompt_version, model, package_mode, prompt_tokens, completion_tokens, duration_ms, validation_status, daily_bucket, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ runs: data ?? [] });
}
