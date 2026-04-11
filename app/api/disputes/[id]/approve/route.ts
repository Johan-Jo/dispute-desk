import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { runAutomationPipeline } from "@/lib/automation/pipeline";
import { logAuditEvent } from "@/lib/audit/logEvent";

export const runtime = "nodejs";

/**
 * POST /api/disputes/:id/approve
 *
 * Merchant approves a dispute from the review queue.
 * Clears needs_review, triggers automation pipeline, and logs the override.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sb = getServiceClient();

  const { data: dispute, error } = await sb
    .from("disputes")
    .select("id, shop_id, reason, phase, needs_review")
    .eq("id", id)
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
