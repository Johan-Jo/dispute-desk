import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/admin/auth";
import { listDisputeNotes, createDisputeNote } from "@/lib/disputes/internal/notes";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/admin/disputes/:id/notes — all notes, internal included. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const admin = await getAdminSessionUser();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return listDisputeNotes(req, id, { role: "admin", email: admin.email });
}

/** POST /api/admin/disputes/:id/notes — body: { noteBody, visibility? }. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const admin = await getAdminSessionUser();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return createDisputeNote(req, id, { role: "admin", email: admin.email });
}
