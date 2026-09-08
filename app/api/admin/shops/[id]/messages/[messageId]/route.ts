/**
 * PATCH  /api/admin/shops/[id]/messages/[messageId] — publish/archive/edit
 * DELETE /api/admin/shops/[id]/messages/[messageId] — remove
 *
 * Every write is scoped by shop_id as well as message id, so an id
 * from another shop can't be mutated through this path.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { mapMerchantMessageRow } from "@/lib/merchantMessages/types";

export const runtime = "nodejs";

const TONES = new Set(["info", "success", "warning", "critical"]);
const STATUSES = new Set(["draft", "published", "archived"]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id, messageId } = await params;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.title === "string") patch.title = body.title.trim().slice(0, 200);
  if (typeof body.body === "string") patch.body = body.body.trim().slice(0, 4000);
  if (typeof body.askForContact === "boolean") patch.ask_for_contact = body.askForContact;
  if (typeof body.tone === "string" && TONES.has(body.tone)) patch.tone = body.tone;
  if (typeof body.status === "string" && STATUSES.has(body.status)) patch.status = body.status;
  if ("expiresAt" in body) patch.expires_at = body.expiresAt || null;
  // Re-publishing a dismissed message should show it again, otherwise
  // an admin would have to create a duplicate row to re-ask.
  if (body.status === "published") patch.dismissed_at = null;

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("merchant_messages")
    .update(patch)
    .eq("id", messageId)
    .eq("shop_id", id)
    .select("*")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ message: mapMerchantMessageRow(data) });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id, messageId } = await params;
  const sb = getServiceClient();
  const { error } = await sb
    .from("merchant_messages")
    .delete()
    .eq("id", messageId)
    .eq("shop_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
