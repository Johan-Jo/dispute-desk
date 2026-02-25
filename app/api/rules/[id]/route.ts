import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";

export const runtime = "nodejs";

/**
 * GET /api/rules/:id
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sb = getServiceClient();

  const { data, error } = await sb
    .from("rules")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}

/**
 * PATCH /api/rules/:id
 * Update a rule (partial update).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const sb = getServiceClient();

  const allowed = ["name", "match", "action", "enabled", "priority"];
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key];
  }

  const { data, error } = await sb
    .from("rules")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}

/**
 * DELETE /api/rules/:id
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sb = getServiceClient();

  const { data: rule } = await sb
    .from("rules")
    .select("id, shop_id")
    .eq("id", id)
    .single();

  if (!rule) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }

  await sb.from("rules").delete().eq("id", id);

  await logAuditEvent({
    shopId: rule.shop_id,
    actorType: "merchant",
    eventType: "rule_deleted",
    eventPayload: { rule_id: id },
  });

  return NextResponse.json({ deleted: true });
}
