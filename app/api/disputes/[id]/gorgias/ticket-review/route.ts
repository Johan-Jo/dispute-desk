/**
 * POST /api/disputes/:id/gorgias/ticket-review
 *
 * Ticket-level review — deliberately DISTINCT from message approval:
 * "this ticket belongs to the disputed order" (confirm/reject) is decided
 * before any of its messages become approvable. All mutations run inside
 * the `gorgias_review_ticket` RPC transaction; rejecting a ticket
 * bulk-excludes every message (including previously approved/manual) and
 * invalidates their approval hashes.
 *
 * After a successful confirm, an analysis-only enrichment run is enqueued
 * (the `analyzed_at` gate keeps it cheap) so the newly-confirmed ticket's
 * messages get relevance proposals.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { parseJsonBody } from "@/lib/http/parseJsonBody";
import { enqueueGorgiasEnrichment } from "@/lib/integrations/gorgias/enqueueEnrichment";

export const runtime = "nodejs";

const ACTIONS = ["confirm", "reject", "report_bad_match"] as const;
type TicketAction = (typeof ACTIONS)[number];

interface TicketReviewBody {
  matchedTicketId: string;
  action: TicketAction;
  reason?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: disputeId } = await params;
  const shopId = extractShopId(req);
  if (!shopId || shopId === "demo") {
    return NextResponse.json(
      { error: "Shop context required.", code: "SHOP_CONTEXT_REQUIRED" },
      { status: 401 },
    );
  }

  const parsed = await parseJsonBody<TicketReviewBody>(req);
  if (parsed instanceof NextResponse) return parsed;
  const { matchedTicketId, action } = parsed;
  const reason =
    typeof parsed.reason === "string" ? parsed.reason.slice(0, 500) : null;

  if (!matchedTicketId || typeof matchedTicketId !== "string") {
    return NextResponse.json(
      { error: "matchedTicketId is required" },
      { status: 400 },
    );
  }
  if (!ACTIONS.includes(action)) {
    return NextResponse.json(
      { error: `action must be one of: ${ACTIONS.join(", ")}` },
      { status: 400 },
    );
  }

  const sb = getServiceClient();
  const { data, error } = await sb.rpc("gorgias_review_ticket", {
    p_shop_id: shopId,
    p_dispute_id: disputeId,
    p_matched_ticket_id: matchedTicketId,
    p_action: action,
    p_reason: reason,
    p_actor: "merchant",
  });

  if (error) {
    if (/ticket_not_found/.test(error.message)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (/invalid_transition/.test(error.message)) {
      return NextResponse.json(
        { error: "Action not valid for the ticket's current state.", code: "INVALID_TRANSITION" },
        { status: 409 },
      );
    }
    if (/unknown_action/.test(error.message)) {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    return NextResponse.json({ error: "Review action failed." }, { status: 500 });
  }

  // Newly-confirmed ticket → run analysis over its candidate messages.
  // Fire-and-forget: an enqueue miss (e.g. run already active) is fine —
  // the active run will pick the ticket up via the analyzed_at gate.
  if (action === "confirm") {
    try {
      await enqueueGorgiasEnrichment({
        shopId,
        disputeId,
        trigger: "ticket_confirmed",
      });
    } catch {
      // Never fail the review action over the follow-up analysis.
    }
  }

  return NextResponse.json({ ok: true, result: data });
}
