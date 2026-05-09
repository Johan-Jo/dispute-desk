import { NextRequest, NextResponse } from "next/server";
import { ingestLoop } from "@/lib/signal-radar/ingest-loop";
import { redditAdapter } from "@/lib/signal-radar/sources/reddit";

export const runtime = "nodejs";
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  const secret =
    req.headers.get("authorization")?.replace("Bearer ", "") ??
    req.nextUrl.searchParams.get("secret");

  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await ingestLoop(redditAdapter);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "ingest failed";
    console.error("[signal-radar] reddit cron error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
