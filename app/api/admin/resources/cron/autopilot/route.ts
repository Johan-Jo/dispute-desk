import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { executeAutopilotTick } from "@/lib/resources/cron/autopilotTick";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Manual trigger — bypasses daily rate limit so admins can drain the backlog
 * without pressing the button N times. Cron variant never sets bypassRateLimit.
 */
export async function POST() {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await executeAutopilotTick({ bypassRateLimit: true });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Autopilot tick failed" },
      { status: 500 }
    );
  }
}
