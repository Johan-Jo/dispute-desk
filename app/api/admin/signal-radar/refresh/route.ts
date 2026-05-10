import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { ingestLoop } from "@/lib/signal-radar/ingest-loop";
import { getEnabledAdapters } from "@/lib/signal-radar/sources";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Background-fires the ingest. The full Reddit + Shopify Community + App
 * Store loop takes 100-150 seconds (Reddit alone needs ~30s of inter-call
 * spacing to dodge 429s). That blows past Vercel's edge-proxy first-byte
 * timeout (~60s for browser-facing routes), so the synchronous response
 * returned 504 even when the function itself completed cleanly.
 *
 * The fix: insert a `signal_radar_ingest_runs` row with status=running,
 * return 202 immediately, then run the actual ingest inside `after()`.
 * The UI polls /api/admin/signal-radar/refresh-status?run_id=… until the
 * row flips to done/error.
 */
export async function POST(req: NextRequest) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Body is currently ignored; kept as POST for forward-compat.
  try {
    await req.json();
  } catch {
    // empty body is fine
  }

  const sb = getServiceClient();
  const { data: run, error: runErr } = await sb
    .from("signal_radar_ingest_runs")
    .insert({ status: "running", trigger: "manual" })
    .select("id, started_at")
    .single();

  if (runErr || !run) {
    return NextResponse.json(
      { error: runErr?.message ?? "could not create run row" },
      { status: 500 }
    );
  }

  after(async () => {
    const sbAfter = getServiceClient();
    try {
      const result = await ingestLoop(await getEnabledAdapters());
      await sbAfter
        .from("signal_radar_ingest_runs")
        .update({
          status: "done",
          finished_at: new Date().toISOString(),
          fetched: result.fetched,
          inserted: result.inserted,
          errors: result.errors,
          by_platform: result.by_platform,
        })
        .eq("id", run.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "ingest failed";
      console.error("[signal-radar] manual refresh error:", err);
      await sbAfter
        .from("signal_radar_ingest_runs")
        .update({
          status: "error",
          finished_at: new Date().toISOString(),
          error_message: message.slice(0, 1000),
        })
        .eq("id", run.id);
    }
  });

  return NextResponse.json(
    { run_id: run.id, started_at: run.started_at, status: "running" },
    { status: 202 }
  );
}
