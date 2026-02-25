import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = getServiceClient();

  const [shop, disputeCount, packCount] = await Promise.all([
    sb.from("shops").select("*").eq("id", id).single(),
    sb.from("disputes").select("id", { count: "exact", head: true }).eq("shop_id", id),
    sb.from("evidence_packs").select("id", { count: "exact", head: true }).eq("shop_id", id),
  ]);

  if (!shop.data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    shop: shop.data,
    disputes: disputeCount.count ?? 0,
    packs: packCount.count ?? 0,
  });
}

/** PATCH — admin overrides (plan, pack_limit_override, admin_notes) */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const sb = getServiceClient();

  const updates: Record<string, unknown> = {};
  if (body.plan) updates.plan = body.plan;
  if (body.pack_limit_override !== undefined) updates.pack_limit_override = body.pack_limit_override;
  if (body.admin_notes !== undefined) updates.admin_notes = body.admin_notes;
  if (body.auto_pack_enabled !== undefined) updates.auto_pack_enabled = body.auto_pack_enabled;
  updates.updated_at = new Date().toISOString();

  const { error } = await sb.from("shops").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAuditEvent({
    shopId: id,
    actorType: "system",
    eventType: "admin_override",
    eventPayload: { updates: body, admin: true },
  });

  return NextResponse.json({ ok: true });
}
