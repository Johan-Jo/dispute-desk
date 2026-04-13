import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { emitDisputeEvent } from "@/lib/disputeEvents/emitEvent";
import { SUPPORT_NOTE_ADDED } from "@/lib/disputeEvents/eventTypes";

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
): Promise<{ role: string; email: string | null } | null> {
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

  const { data: dispute } = await sb
    .from("disputes")
    .select("id, shop_id")
    .eq("id", disputeId)
    .single();

  if (!dispute) {
    return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
  }

  const caller = await verifyInternalRole(req, sb);
  const includeInternal = caller !== null;

  let query = sb
    .from("dispute_notes")
    .select("*")
    .eq("dispute_id", disputeId)
    .order("created_at", { ascending: false });

  if (!includeInternal) {
    query = query.eq("visibility", "merchant_and_internal");
  }

  const { data: notes, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ notes: notes ?? [] });
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

  const { data: dispute } = await sb
    .from("disputes")
    .select("id, shop_id")
    .eq("id", disputeId)
    .single();

  if (!dispute) {
    return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
  }

  const body = await req.json();
  const noteBody = body.noteBody;
  if (!noteBody || typeof noteBody !== "string" || noteBody.trim().length === 0) {
    return NextResponse.json({ error: "noteBody is required" }, { status: 400 });
  }

  const visibility = body.visibility === "merchant_and_internal"
    ? "merchant_and_internal"
    : "internal_only";

  const { data: note, error } = await sb
    .from("dispute_notes")
    .insert({
      dispute_id: disputeId,
      shop_id: dispute.shop_id,
      visibility,
      note_body: noteBody.trim(),
      author_type: caller.role,
      author_ref: body.authorRef ?? caller.email,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  void emitDisputeEvent({
    disputeId,
    shopId: dispute.shop_id,
    eventType: SUPPORT_NOTE_ADDED,
    description: `Note added by ${caller.role}`,
    eventAt: new Date().toISOString(),
    actorType: caller.role === "admin" ? "disputedesk_admin" : "disputedesk_system",
    actorRef: caller.email ?? undefined,
    sourceType: "manual_entry",
    visibility: "internal_only",
    dedupeKey: `${disputeId}:${SUPPORT_NOTE_ADDED}:${note.id}`,
  });

  return NextResponse.json({ note }, { status: 201 });
}
