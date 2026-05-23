import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { isDemoRequest } from "@/lib/demo/isDemoMode";

export const runtime = "nodejs";

function shopContextOrUnauthorized(req: NextRequest): { shopId: string } | NextResponse {
  const shopId = extractShopId(req);
  if (!shopId || shopId === "demo") {
    return NextResponse.json(
      { error: "Shop context required.", code: "SHOP_CONTEXT_REQUIRED" },
      { status: 401 },
    );
  }
  return { shopId };
}

/**
 * GET /api/rules/:id
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = shopContextOrUnauthorized(req);
  if (ctx instanceof NextResponse) return ctx;
  const sb = getServiceClient();

  const { data, error } = await sb
    .from("rules")
    .select("*")
    .eq("id", id)
    .eq("shop_id", ctx.shopId)
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
  if (isDemoRequest(req)) {
    return NextResponse.json({ ok: true, demo: true, simulated: true, id });
  }
  const ctx = shopContextOrUnauthorized(req);
  if (ctx instanceof NextResponse) return ctx;
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
    .eq("shop_id", ctx.shopId)
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
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (isDemoRequest(req)) {
    return NextResponse.json({ ok: true, demo: true, simulated: true, deleted: false, id });
  }
  const ctx = shopContextOrUnauthorized(req);
  if (ctx instanceof NextResponse) return ctx;
  const sb = getServiceClient();

  const { data: rule } = await sb
    .from("rules")
    .select("id, shop_id")
    .eq("id", id)
    .eq("shop_id", ctx.shopId)
    .single();

  if (!rule) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }

  await sb.from("rules").delete().eq("id", id).eq("shop_id", ctx.shopId);

  await logAuditEvent({
    shopId: rule.shop_id,
    actorType: "merchant",
    eventType: "rule_deleted",
    eventPayload: { rule_id: id },
  });

  return NextResponse.json({ deleted: true });
}
