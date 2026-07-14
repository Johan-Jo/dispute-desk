/**
 * GET /api/disputes/:id/gorgias/tickets/:matchedTicketId
 *
 * Lazy transcript endpoint — the ONLY place full Gorgias message text is
 * served to the merchant UI. The workspace payload deliberately carries
 * ticket summaries + counts only (latency, payload size, and no
 * unnecessary customer-data exposure on a 4s poll); the UI fetches this
 * when the merchant opens a conversation.
 *
 * Ownership chain enforced query-side: shop → dispute → matched ticket;
 * messages are selected by matched_ticket_id after the chain resolves.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; matchedTicketId: string }> },
) {
  const { id: disputeId, matchedTicketId } = await params;
  const shopId = extractShopId(req);
  if (!shopId || shopId === "demo") {
    return NextResponse.json(
      { error: "Shop context required.", code: "SHOP_CONTEXT_REQUIRED" },
      { status: 401 },
    );
  }

  const sb = getServiceClient();
  const { data: ticket } = await sb
    .from("gorgias_matched_tickets")
    .select(
      "id, gorgias_ticket_id, match_score, confidence, match_reasons, match_status, ticket_snapshot, analyzed_at",
    )
    .eq("id", matchedTicketId)
    .eq("dispute_id", disputeId)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!ticket) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: messages } = await sb
    .from("gorgias_evidence_messages")
    .select(
      "id, gorgias_message_id, sender_type, sender_name, channel, sent_at, message_text, content_truncated, original_character_count, content_hash, evidence_category, confidence_score, relevance_explanation, explanation_edited, review_status, approved_at, approved_by, approved_excerpt, approved_content_hash",
    )
    .eq("matched_ticket_id", matchedTicketId)
    .order("sent_at", { ascending: true });

  return NextResponse.json({
    ticket,
    messages: (messages ?? []).map((m) => ({
      id: m.id,
      gorgiasMessageId: m.gorgias_message_id,
      senderType: m.sender_type,
      senderName: m.sender_name,
      channel: m.channel,
      sentAt: m.sent_at,
      text: m.message_text,
      contentTruncated: m.content_truncated,
      originalCharacterCount: m.original_character_count,
      evidenceCategory: m.evidence_category,
      confidenceScore: m.confidence_score,
      relevanceExplanation: m.relevance_explanation,
      explanationEdited: m.explanation_edited,
      reviewStatus: m.review_status,
      approvedAt: m.approved_at,
      approvedBy: m.approved_by,
      approvedExcerpt: m.approved_excerpt,
      /** Source drifted since approval → requires re-review before it
       *  can enter a newly generated pack. */
      needsReapproval:
        (m.review_status === "approved" || m.review_status === "manual")
          ? m.approved_content_hash !== null &&
            m.approved_content_hash !== m.content_hash
          : false,
    })),
  });
}
