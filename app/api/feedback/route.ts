import { NextRequest, NextResponse } from "next/server";
import { resolveAuditActor } from "@/lib/audit/resolveActor";
import { getServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/feedback
 *
 * Stores merchant feedback (rating + optional comment).
 */
export async function POST(req: NextRequest) {
  const auditActor = await resolveAuditActor(req);
  const shopId = req.headers.get("x-shop-id");
  if (!shopId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (
    !body ||
    typeof body.rating !== "number" ||
    body.rating < 1 ||
    body.rating > 5
  ) {
    return NextResponse.json({ error: "Invalid rating" }, { status: 400 });
  }

  const sb = getServiceClient();
  await sb.from("audit_events").insert({
    shop_id: shopId,
    actor_type: auditActor.actorType,
    actor_id: auditActor.actorId,
    event_type: "app_feedback",
    event_payload: {
      rating: body.rating,
      comment:
        typeof body.comment === "string" ? body.comment.slice(0, 2000) : null,
      submitted_at: new Date().toISOString(),
    },
  });

  return NextResponse.json({ ok: true });
}
