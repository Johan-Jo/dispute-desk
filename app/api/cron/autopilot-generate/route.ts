import { NextRequest, NextResponse } from "next/server";
import { executeAutopilotTick } from "@/lib/resources/cron/autopilotTick";
import { cronEnvGate } from "@/lib/cron/envGate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function runAutopilot(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

  const result = await executeAutopilotTick();
  return NextResponse.json(result);
}

export async function GET(req: NextRequest) {
  return runAutopilot(req);
}

export async function POST(req: NextRequest) {
  return runAutopilot(req);
}
