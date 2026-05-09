import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { ingestLoop } from "@/lib/signal-radar/ingest-loop";
import { redditAdapter } from "@/lib/signal-radar/sources/reddit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { source?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const source = body.source ?? "reddit";
  if (source !== "reddit") {
    return NextResponse.json(
      { error: `Unknown source: ${source}` },
      { status: 400 }
    );
  }

  try {
    const result = await ingestLoop(redditAdapter);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "ingest failed";
    console.error("[signal-radar] manual refresh error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
