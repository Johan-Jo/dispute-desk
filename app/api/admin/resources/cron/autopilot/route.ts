import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { executeAutopilotTick } from "@/lib/resources/cron/autopilotTick";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Manual trigger — same behavior as Vercel cron `/api/cron/autopilot-generate`. */
export async function POST() {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await executeAutopilotTick();
  return NextResponse.json(result);
}
