import { NextRequest, NextResponse } from "next/server";
import { ingestLoop } from "@/lib/signal-radar/ingest-loop";
import { getEnabledAdapters } from "@/lib/signal-radar/sources";
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

  try {
    const result = await ingestLoop(await getEnabledAdapters());
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "ingest failed";
    console.error("[signal-radar] reddit cron error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
