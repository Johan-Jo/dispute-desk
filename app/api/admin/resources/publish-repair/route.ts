import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { repairPublishedItemsWithUnpublishedLocales } from "@/lib/resources/cron/publishQueueTick";
import { repairStuckPublishedWorkflow } from "@/lib/resources/publish";

export const dynamic = "force-dynamic";

/** Fix false publishes: no `published_at`, or workflow published but locales still `is_published = false`. */
export async function POST() {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const stuckPublishedAt = await repairStuckPublishedWorkflow();
    const unpublishedLocales = await repairPublishedItemsWithUnpublishedLocales();
    return NextResponse.json({ stuckPublishedAt, unpublishedLocales });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Repair failed" },
      { status: 500 }
    );
  }
}
