import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { parseJsonBody } from "@/lib/http/parseJsonBody";
import { logAuditEvent, type EventType } from "@/lib/audit/logEvent";
import {
  isReviewAction,
  reviewStateForAction,
  REVIEW_STATES,
  type ReviewAction,
} from "@/lib/disputes/reviewState";

export const runtime = "nodejs";

/**
 * POST /api/disputes/:id/review   { action: "hold" | "approve" | "concede" | "clear" }
 *
 * The merchant review lifecycle for a parked-for-review or weak dispute
 * (2026-07-23). One explicit decision per call:
 *
 *   hold     → review_state = 'in_review', review_due_at = due_at snapshot.
 *              Stays actionable but shows the calm "In review" chip +
 *              countdown; the reminder cron resurfaces it near the
 *              deadline if untouched.
 *   approve  → review_state = 'approved', needs_attention cleared. The
 *              existing 08:00-UTC deadline cron auto-submits it per the
 *              shop's automation rule. NOTE: this is deliberately NOT the
 *              same as POST .../approve (that runs the pipeline
 *              immediately from the review queue). Here the merchant is
 *              scheduling, not submitting now.
 *   concede  → review_state = 'conceded', needs_attention cleared. The
 *              deadline cron SKIPS it — never auto-submitted. Billing is
 *              unaffected (the pack credit was consumed at build).
 *   clear    → review_state = NULL. Undoes a prior decision so the
 *              dispute rides the shop's automation rule again.
 *
 * Read-only on billing: nothing here consumes or refunds a pack credit.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const shopId = extractShopId(req);
  if (!shopId || shopId === "demo") {
    return NextResponse.json(
      { error: "Shop context required.", code: "SHOP_CONTEXT_REQUIRED" },
      { status: 401 },
    );
  }

  const parsed = await parseJsonBody<{ action?: string }>(req);
  if (parsed instanceof NextResponse) return parsed;
  const action = parsed.action;
  if (!isReviewAction(action)) {
    return NextResponse.json(
      {
        error: "action must be one of: hold, approve, concede, clear",
        code: "INVALID_REVIEW_ACTION",
      },
      { status: 400 },
    );
  }

  const sb = getServiceClient();

  const { data: dispute, error } = await sb
    .from("disputes")
    .select("id, shop_id, due_at, review_state, needs_attention")
    .eq("id", id)
    .eq("shop_id", shopId)
    .single();

  if (error || !dispute) {
    return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
  }

  const from = dispute.review_state ?? null;
  const to = reviewStateForAction(action as ReviewAction);

  // Build the update. `hold` snapshots the deadline so the countdown chip
  // + reminder cron have a stable target; every other action clears the
  // snapshot. `approve` / `concede` are terminal merchant decisions, so
  // they leave the actionable views by clearing needs_attention (+ its
  // structured reason). `hold` keeps needs_attention as-is (still WIP);
  // `clear` also resets it since the merchant is re-opening the decision.
  const update: Record<string, unknown> = {
    review_state: to,
    updated_at: new Date().toISOString(),
  };
  if (action === "hold") {
    update.review_due_at = dispute.due_at ?? null;
  } else {
    update.review_due_at = null;
  }
  if (action === "approve" || action === "concede") {
    update.needs_attention = false;
    update.attention_reason = null;
    update.attention_payload = {};
  }

  const { error: updateError } = await sb
    .from("disputes")
    .update(update)
    .eq("id", id)
    .eq("shop_id", shopId);

  if (updateError) {
    return NextResponse.json(
      { error: "Failed to record review decision" },
      { status: 500 },
    );
  }

  const eventType: EventType =
    action === "hold"
      ? "review_held"
      : action === "approve"
        ? "review_approved"
        : action === "concede"
          ? "review_conceded"
          : "review_cleared";

  await logAuditEvent({
    shopId: dispute.shop_id,
    disputeId: id,
    actorType: "merchant",
    eventType,
    eventPayload: { action, from, to },
  });

  return NextResponse.json({
    ok: true,
    reviewState: to,
    reviewDueAt: action === "hold" ? (dispute.due_at ?? null) : null,
    conceded: to === REVIEW_STATES.CONCEDED,
  });
}
