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

  // `?force=1` (CRON_SECRET-authed) bypasses the reddit-search Brave hour-gate
  // for this run — lets an operator trigger an immediate off-hour ingest to
  // verify/debug. Bounded with try/finally so a warm Lambda doesn't keep the
  // flag set for the next scheduled (unforced) run.
  const force = new URL(req.url).searchParams.get("force") === "1";
  if (force) process.env.SIGNAL_RADAR_FORCE_FETCH = "1";

  // Tracked so the dashboard status bar reflects automated cron runs, not just
  // manual "Refresh now" clicks. runTrackedIngest records status/errors to
  // signal_radar_ingest_runs and never throws on an adapter outage.
  try {
    const { result } = await runTrackedIngest("cron");
    if (!result) {
      return NextResponse.json({ error: "ingest failed" }, { status: 500 });
    }
    return NextResponse.json(result);
  } finally {
    if (force) delete process.env.SIGNAL_RADAR_FORCE_FETCH;
  }
}
