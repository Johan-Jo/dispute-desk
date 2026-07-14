/**
 * POST /api/disputes/:id/gorgias/message-review
 *
 * Merchant review action on a single Gorgias evidence message. The whole
 * mutation is one transaction inside the `gorgias_review_message` RPC:
 * review_status + approved_at/by + approved_excerpt + approved_content_hash
 * + audit event + funnel event + pack-snapshot invalidation + attention
 * recompute. The route only validates input, resolves shop context and
 * maps RPC errors to HTTP.
 *
 * Ownership is verified inside the RPC across the full chain
 * (shop → dispute → matched ticket → message); a cross-shop id probe
 * gets the same 404 as a nonexistent id.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { parseJsonBody } from "@/lib/http/parseJsonBody";

export const runtime = "nodejs";

const ACTIONS = [
  "approve",
  "exclude",
  "reset",
  "edit_explanation",
  "manual_add",
] as const;
type MessageAction = (typeof ACTIONS)[number];

interface MessageReviewBody {
  messageId: string;
  action: MessageAction;
  explanation?: string;
  excerpt?: string;
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

  const parsed = await parseJsonBody<MessageReviewBody>(req);
  if (parsed instanceof NextResponse) return parsed;
  const { messageId, action, explanation, excerpt } = parsed;

  if (!messageId || typeof messageId !== "string") {
    return NextResponse.json({ error: "messageId is required" }, { status: 400 });
  }
  if (!ACTIONS.includes(action)) {
    return NextResponse.json(
      { error: `action must be one of: ${ACTIONS.join(", ")}` },
      { status: 400 },
    );
  }

  const sb = getServiceClient();
  const { data, error } = await sb.rpc("gorgias_review_message", {
    p_shop_id: shopId,
    p_dispute_id: disputeId,
    p_message_id: messageId,
    p_action: action,
    p_explanation: explanation ?? null,
    p_excerpt: excerpt ?? null,
    p_actor: "merchant",
  });

  if (error) {
    return mapRpcError(error.message);
  }

  return NextResponse.json({ ok: true, message: data });
}

function mapRpcError(message: string): NextResponse {
  if (/message_not_found|ticket_not_found/.test(message)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (/ticket_not_confirmed/.test(message)) {
    return NextResponse.json(
      {
        error: "Confirm the ticket match before approving its messages.",
        code: "TICKET_NOT_CONFIRMED",
      },
      { status: 409 },
    );
  }
  if (/invalid_transition/.test(message)) {
    return NextResponse.json(
      { error: "Action not valid for the message's current state.", code: "INVALID_TRANSITION" },
      { status: 409 },
    );
  }
  if (/excerpt_not_verbatim/.test(message)) {
    return NextResponse.json(
      {
        error: "The approved excerpt must be an exact passage from the message.",
        code: "EXCERPT_NOT_VERBATIM",
      },
      { status: 400 },
    );
  }
  if (/explanation_required/.test(message)) {
    return NextResponse.json(
      { error: "Explanation text is required.", code: "EXPLANATION_REQUIRED" },
      { status: 400 },
    );
  }
  if (/unknown_action/.test(message)) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  return NextResponse.json(
    { error: "Review action failed." },
    { status: 500 },
  );
}
