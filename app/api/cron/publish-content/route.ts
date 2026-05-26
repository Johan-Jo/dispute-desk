import { NextRequest, NextResponse } from "next/server";
import { executePublishQueueTick } from "@/lib/resources/cron/publishQueueTick";
import { cronEnvGate } from "@/lib/cron/envGate";

async function runPublish(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

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
