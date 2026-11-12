import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { emitDisputeEvent } from "@/lib/disputeEvents/emitEvent";
import { SUPPORT_NOTE_ADDED } from "@/lib/disputeEvents/eventTypes";

export interface InternalCaller {
  role: string;
  email: string | null;
}

/** List notes. `caller` null = merchant (shop-scoped, merchant-visible only). */
export async function listDisputeNotes(
  req: NextRequest,
  disputeId: string,
  caller: InternalCaller | null,
) {
  const sb = getServiceClient();
  const includeInternal = caller !== null;

  // Merchant calls must be scoped to the requesting shop; internal callers are
  // intentionally cross-shop (tooling / admin panel reads any dispute).
  let disputeQuery = sb
    .from("disputes")
    .select("id, shop_id")
    .eq("id", disputeId);
  if (!caller) {
    const shopId = extractShopId(req);
    if (!shopId || shopId === "demo") {
      return NextResponse.json(
        { error: "Shop context required.", code: "SHOP_CONTEXT_REQUIRED" },
        { status: 401 },
      );
    }
    disputeQuery = disputeQuery.eq("shop_id", shopId);
  }
  const { data: dispute } = await disputeQuery.single();

  if (!dispute) {
    return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
  }

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


/** Create a support note. The caller MUST already be authenticated as internal. */
export async function createDisputeNote(
  req: NextRequest,
  disputeId: string,
  caller: InternalCaller,
) {
  const sb = getServiceClient();

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
