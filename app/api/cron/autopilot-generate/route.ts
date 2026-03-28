import { NextRequest, NextResponse } from "next/server";
import { executeAutopilotTick } from "@/lib/resources/cron/autopilotTick";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CRON_SECRET = process.env.CRON_SECRET;

async function runAutopilot(req: NextRequest) {
  const secret =
    req.headers.get("x-cron-secret") ??
    req.headers.get("authorization")?.replace("Bearer ", "") ??
    req.nextUrl.searchParams.get("secret");

  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await executeAutopilotTick();
  return NextResponse.json(result);
}

export async function GET(req: NextRequest) {
  return runAutopilot(req);
}

export async function POST(req: NextRequest) {
  return runAutopilot(req);
}
