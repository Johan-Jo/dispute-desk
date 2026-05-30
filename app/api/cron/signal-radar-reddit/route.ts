import { NextRequest, NextResponse } from "next/server";
import { runTrackedIngest } from "@/lib/signal-radar/run-tracking";
import { getSignalRadarSettings } from "@/lib/signal-radar/settings";
import { cronEnvGate } from "@/lib/cron/envGate";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

  const settings = await getSignalRadarSettings();
  if (!settings.reddit_cron_enabled) {
    return NextResponse.json({ skipped: true, reason: "reddit_cron_disabled" });
  }

  // Tracked so the dashboard status bar reflects automated cron runs, not just
  // manual "Refresh now" clicks. runTrackedIngest records status/errors to
  // signal_radar_ingest_runs and never throws on an adapter outage.
  const { result } = await runTrackedIngest("cron");
  if (!result) {
    return NextResponse.json({ error: "ingest failed" }, { status: 500 });
  }
  return NextResponse.json(result);
}
