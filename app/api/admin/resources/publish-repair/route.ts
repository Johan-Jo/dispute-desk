import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { repairStuckPublishedWorkflow } from "@/lib/resources/publish";

export const dynamic = "force-dynamic";

/** Fix items shown as Published with no date / not on hub: run publishLocalization for unpublished locals. */
export async function POST() {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await repairStuckPublishedWorkflow();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Repair failed" },
      { status: 500 }
    );
  }
}
