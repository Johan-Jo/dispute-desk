import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { reconcileParkedAutoDisputes } from "@/lib/automation/reconcileParkedAutoDisputes";

export const runtime = "nodejs";

/**
 * Any custom-rule write can make an already-built Strong draft newly eligible
 * to auto-save (a new auto rule now matches it, or a review rule that was
 * parking it was edited/removed). Fire the reconcile pass so those don't sit
 * as drafts until the next rebuild. Non-blocking and non-fatal — the write
 * succeeds regardless. The pass re-applies every auto gate itself, so only
 * genuinely eligible cases are promoted.
 */
function reconcileAfterRuleWrite(shopId: string): void {
  void reconcileParkedAutoDisputes(shopId).catch((err) => {
    console.error("[api/rules] reconcileParkedAutoDisputes failed", err);
  });
}

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

  reconcileAfterRuleWrite(ctx.shopId);

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

  reconcileAfterRuleWrite(ctx.shopId);

  return NextResponse.json({ deleted: true });
}
