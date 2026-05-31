import { getServiceClient } from "@/lib/supabase/server";
import { ingestLoop, type IngestLoopResult } from "./ingest-loop";
import { getEnabledAdapters } from "./sources";

/**
 * Runs a full ingest and records its lifecycle in `signal_radar_ingest_runs`
 * so the admin dashboard's status bar reflects automated cron runs — not just
 * the manual "Refresh now" button.
 *
 * Historically only `/api/admin/signal-radar/refresh` wrote run rows; the
 * hourly cron called `ingestLoop` directly and left the table empty, so the
 * dashboard looked dead even while ingest was healthy. This helper is the
 * single tracked entry point for both callers.
 *
 * `trigger` distinguishes a scheduled run ("cron") from an operator click
 * ("manual"). Failures are recorded as status='error' rather than thrown, so
 * a cron tick never crashes on a transient adapter outage — the row carries
 * the error for the operator to see.
 */
export async function runTrackedIngest(
  trigger: "cron" | "manual"
): Promise<{ runId: string | null; result: IngestLoopResult | null }> {
  const sb = getServiceClient();

  const { data: run, error: runErr } = await sb
    .from("signal_radar_ingest_runs")
    .insert({ status: "running", trigger })
    .select("id")
    .single();

  if (runErr || !run) {
    // Couldn't open a run row — still run the ingest so coverage isn't lost,
    // just without tracking. The caller decides what to surface.
    console.error("[signal-radar] could not open run row:", runErr);
    const result = await ingestLoop(await getEnabledAdapters());
    return { runId: null, result };
  }

  try {
    const result = await ingestLoop(await getEnabledAdapters());
    await sb
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
    return { runId: run.id, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "ingest failed";
    console.error("[signal-radar] tracked ingest error:", err);
    await sb
      .from("signal_radar_ingest_runs")
      .update({
        status: "error",
        finished_at: new Date().toISOString(),
        error_message: message.slice(0, 1000),
      })
      .eq("id", run.id);
    return { runId: run.id, result: null };
  }
}
