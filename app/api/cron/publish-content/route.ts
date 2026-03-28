import { NextRequest, NextResponse } from "next/server";
import { executePublishQueueTick } from "@/lib/resources/cron/publishQueueTick";

const CRON_SECRET = process.env.CRON_SECRET;

async function runPublish(req: NextRequest) {
  const secret =
    req.headers.get("x-cron-secret") ??
    req.headers.get("authorization")?.replace("Bearer ", "") ??
    req.nextUrl.searchParams.get("secret");
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await executePublishQueueTick();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({
    processed: result.processed,
    results: result.results,
  });
}

/** POST or GET (Vercel Cron uses GET with ?secret=) */
export async function POST(req: NextRequest) {
  return runPublish(req);
}

export async function GET(req: NextRequest) {
  return runPublish(req);
}
