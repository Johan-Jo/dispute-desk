import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import {
  listDisputeNotes,
  createDisputeNote,
  type InternalCaller,
} from "@/lib/disputes/internal/notes";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Verify admin or support role from Supabase auth token.
 * Returns the user if authorized, null otherwise.
 */
async function verifyInternalRole(
  req: NextRequest,
  sb: ReturnType<typeof getServiceClient>,
): Promise<InternalCaller | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  const { data: { user } } = await sb.auth.getUser(token);
  if (!user) return null;

  const role = (user.app_metadata as Record<string, unknown> | undefined)?.role;
  if (role !== "admin" && role !== "support") return null;

  return { role: String(role), email: user.email ?? null };
}

/**
 * GET /api/disputes/:id/notes
 *
 * List notes for a dispute. Internal-only notes require admin/support auth.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id: disputeId } = await params;
  const sb = getServiceClient();
  const caller = await verifyInternalRole(req, sb);
  return listDisputeNotes(req, disputeId, caller);
}

/**
 * POST /api/disputes/:id/notes
 *
 * Create a support note. Requires admin or support role.
 * Body: { noteBody, visibility?, authorRef? }
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id: disputeId } = await params;
  const sb = getServiceClient();
  const caller = await verifyInternalRole(req, sb);
  if (!caller) {
    return NextResponse.json({ error: "Unauthorized — admin or support role required" }, { status: 403 });
  }
  return createDisputeNote(req, disputeId, caller);
}
