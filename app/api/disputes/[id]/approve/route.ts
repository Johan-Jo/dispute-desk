import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { runAutomationPipeline } from "@/lib/automation/pipeline";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { emitDisputeEvent } from "@/lib/disputeEvents/emitEvent";
import { updateNormalizedStatus } from "@/lib/disputeEvents/updateNormalizedStatus";
import { MERCHANT_APPROVED_FOR_SAVE } from "@/lib/disputeEvents/eventTypes";

export const runtime = "nodejs";

/**
 * POST /api/disputes/:id/approve
 *
 * Merchant approves a dispute from the review queue.
 * Clears needs_review, triggers automation pipeline, and logs the override.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const shopId = extractShopId(req);
  if (!shopId || shopId === "demo") {
    return NextResponse.json(
      { error: "Shop context required.", code: "SHOP_CONTEXT_REQUIRED" },
      { status: 401 },
    );
  }
  const sb = getServiceClient();

  const { data: dispute, error } = await sb
    .from("disputes")
    .select("id, shop_id, reason, phase, needs_review")
    .eq("id", id)
    .eq("shop_id", shopId)
    .single();

  if (error || !dispute) {
    return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
  }

  if (!dispute.needs_review) {
    return NextResponse.json(
      { error: "Dispute is not in the review queue" },
      { status: 400 }
    );
  }

  await sb
    .from("disputes")
    .update({ needs_review: false, updated_at: new Date().toISOString() })
    .eq("id", id);

  await logAuditEvent({
    shopId: dispute.shop_id,
    disputeId: id,
    actorType: "merchant",
    eventType: "rule_overridden",
    eventPayload: { action: "approved_from_review_queue" },
  });

  void emitDisputeEvent({
    disputeId: id,
    shopId: dispute.shop_id,
    eventType: MERCHANT_APPROVED_FOR_SAVE,
    eventAt: new Date().toISOString(),
    actorType: "merchant_user",
    sourceType: "user_action",
    dedupeKey: `${id}:${MERCHANT_APPROVED_FOR_SAVE}:${new Date().toISOString()}`,
  });
  void updateNormalizedStatus(id);

  const phase =
    dispute.phase === "inquiry" || dispute.phase === "chargeback"
      ? dispute.phase
      : null;

  const result = await runAutomationPipeline({
    id: dispute.id,
    shop_id: dispute.shop_id,
    reason: dispute.reason,
    phase,
  });

  return NextResponse.json({ approved: true, automation: result });
}
