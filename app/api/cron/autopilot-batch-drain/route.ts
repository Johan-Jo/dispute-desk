import { NextRequest, NextResponse } from "next/server";
import { cronEnvGate } from "@/lib/cron/envGate";
import { drainAutopilotBatches } from "@/lib/resources/cron/autopilotBatchDrain";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Ingests + publishes the remaining locales for English-first autopilot articles.
 * The autopilot tick publishes en-US synchronously and submits the other target
 * locales as an async Anthropic batch (recorded on content_items.pending_batch_id);
 * this cron polls those batches and, once ended, ingests the results and publishes
 * each locale. See lib/resources/cron/autopilotBatchDrain.ts. cronEnvGate handles
 * CRON_ENABLED + CRON_SECRET.
 */
async function run(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

  const result = await drainAutopilotBatches();
  return NextResponse.json(result);
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
