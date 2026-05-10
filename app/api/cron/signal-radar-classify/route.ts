import { NextRequest, NextResponse } from "next/server";
import { classifyDrain } from "@/lib/signal-radar/classify-drain";
import { getSignalRadarSettings } from "@/lib/signal-radar/settings";

export const runtime = "nodejs";
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  const secret =
    req.headers.get("authorization")?.replace("Bearer ", "") ??
    req.nextUrl.searchParams.get("secret");

  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
