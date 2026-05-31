import { NextRequest, NextResponse } from "next/server";
import { classifyDrain } from "@/lib/signal-radar/classify-drain";
import { getSignalRadarSettings } from "@/lib/signal-radar/settings";
import { cronEnvGate } from "@/lib/cron/envGate";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

  const settings = await getSignalRadarSettings();
  if (!settings.classify_cron_enabled) {
    return NextResponse.json({ skipped: true, reason: "classify_cron_disabled" });
  }

  try {
    const result = await classifyDrain();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "drain failed";
    console.error("[signal-radar] classify cron error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
