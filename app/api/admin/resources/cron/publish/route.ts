import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { executePublishQueueTick } from "@/lib/resources/cron/publishQueueTick";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Manual trigger — same behavior as Vercel cron `/api/cron/publish-content`. */
export async function POST() {
  if (!(await hasAdminSession())) {
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
