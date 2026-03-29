import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { backfillMissingReadingTimes } from "@/lib/resources/readingTime";

export const dynamic = "force-dynamic";

/** Backfill reading_time_minutes for localizations missing it. */
export async function POST() {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await backfillMissingReadingTimes();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Backfill failed" },
      { status: 500 }
    );
  }
}
