import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/admin/auth";
import { getRun } from "@/lib/intelligence/runs";

export const runtime = "nodejs";

/** GET /api/admin/intelligence/runs/[id] — a single run incl. its data-quality report. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAdminSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const run = await getRun(id);
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ run });
}
