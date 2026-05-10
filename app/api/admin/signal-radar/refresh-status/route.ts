import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Polled by the manual-refresh-button UI while a background-fired ingest
 * is in flight. Returns the row's current status (running | done | error)
 * plus its counts/errors once it completes.
 *
 * Falls back to the most recent run if no run_id is given.
 */
export async function GET(req: NextRequest) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runId = req.nextUrl.searchParams.get("run_id");
  const sb = getServiceClient();

  let query = sb
    .from("signal_radar_ingest_runs")
    .select(
      "id, started_at, finished_at, status, trigger, by_platform, fetched, inserted, errors, error_message"
    );
  if (runId) {
    query = query.eq("id", runId);
  } else {
    query = query.order("started_at", { ascending: false }).limit(1);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ run: null });
  }
  return NextResponse.json({ run: data });
}
