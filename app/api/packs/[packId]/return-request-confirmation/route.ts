/**
 * POST /api/packs/:packId/return-request-confirmation
 *
 * Fix C4b (docs/plans/mein-maison-status-and-no-return.plan.md): for a shop
 * that takes return requests outside Shopify, the merchant answers, per
 * dispute, "Did this customer ask for a return or refund before the
 * dispute?". Only the merchant can see their own inbox.
 *
 *   no_request_received — restores the no-return fact's scoring weight and
 *                         licenses ONE attributed sentence in the letter
 *   request_received    — the no-return fact is dropped from score and
 *                         letter; NEVER bank-facing (it would be a confession)
 *   not_sure            — recorded, treated as unanswered
 *
 * Stored in `dispute_return_request_confirmations` (one row per dispute and
 * response cycle), not evidence_items — a pack rebuild re-creates those.
 * Then a rebuild is queued so the answer reaches the package with no further
 * merchant action. Same window guard as the parcel-outcome route.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveAuditActor } from "@/lib/audit/resolveActor";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { parseJsonBody } from "@/lib/http/parseJsonBody";
import { isReturnRequestAnswer, packShowsReturnOrRefund, RETURN_REQUEST_ANSWERS } from "@/lib/disputes/returnRequestConfirmation";

export const runtime = "nodejs";

const MAX_NOTE_LENGTH = 2000;

interface Body {
  answer: string;
  note?: string | null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ packId: string }> },
) {
  const auditActor = await resolveAuditActor(req);
  const { packId } = await params;
  const shopId = extractShopId(req);
  if (!shopId || shopId === "demo") {
    return NextResponse.json(
      { error: "Shop context required.", code: "SHOP_CONTEXT_REQUIRED" },
      { status: 401 },
    );
  }
  const sb = getServiceClient();

  const parsed = await parseJsonBody<Body>(req);
  if (parsed instanceof NextResponse) return parsed;

  if (!isReturnRequestAnswer(parsed.answer)) {
    return NextResponse.json(
      { error: `answer must be one of: ${RETURN_REQUEST_ANSWERS.join(", ")}`, code: "ANSWER_REQUIRED" },
      { status: 400 },
    );
  }
  const answer = parsed.answer;
  const note = typeof parsed.note === "string" ? parsed.note.trim().replace(/\s+/g, " ") : "";
  if (note.length > MAX_NOTE_LENGTH) {
    return NextResponse.json(
      { error: `Note exceeds the ${MAX_NOTE_LENGTH}-character limit.`, code: "NOTE_TOO_LONG" },
      { status: 400 },
    );
  }

  const { data: pack, error: packErr } = await sb
    .from("evidence_packs")
    .select("id, shop_id, dispute_id, status, pack_json")
    .eq("id", packId)
    .eq("shop_id", shopId)
    .single();
  if (packErr || !pack || !pack.dispute_id) {
    return NextResponse.json({ error: "Pack not found" }, { status: 404 });
  }
  if (pack.status === "building" || pack.status === "queued") {
    return NextResponse.json(
      { error: "Cannot add evidence while pack is building", code: "PACK_BUILDING" },
      { status: 409 },
    );
  }

  // Shopify already records a refund or return on the order: the question
  // is not asked, and an answer could only contradict that record.
  if (packShowsReturnOrRefund((pack.pack_json as { sections?: unknown } | null)?.sections)) {
    return NextResponse.json(
      {
        error: "Shopify already records a refund or return on this order.",
        code: "SHOPIFY_RECORDS_RETURN_OR_REFUND",
      },
      { status: 409 },
    );
  }

  const { data: dispute } = await sb
    .from("disputes")
    .select("submission_state, response_cycle")
    .eq("id", pack.dispute_id)
    .single();
  if (dispute?.submission_state === "submitted_confirmed") {
    return NextResponse.json(
      {
        error: "WINDOW_CLOSED",
        code: "WINDOW_CLOSED",
        message: "Shopify has already forwarded this dispute evidence to the bank, so this answer can no longer be added.",
      },
      { status: 409 },
    );
  }
  const cycle = Number(dispute?.response_cycle ?? 1);
  const answeredAt = new Date().toISOString();

  const { error: upErr } = await sb.from("dispute_return_request_confirmations").upsert(
    {
      dispute_id: pack.dispute_id,
      shop_id: pack.shop_id,
      response_cycle: cycle,
      answer,
      note: note || null,
      answered_at: answeredAt,
      answered_by: auditActor.actorType === "merchant" ? "merchant" : "admin",
    },
    { onConflict: "dispute_id,response_cycle" },
  );
  if (upErr) {
    return NextResponse.json(
      { error: `Failed to record the answer: ${upErr.message}`, code: "PERSIST_FAILED" },
      { status: 500 },
    );
  }

  // The note is the merchant's own words and may describe a request; it
  // stays on the row, never in the audit payload.
  await logAuditEvent({
    shopId: pack.shop_id,
    disputeId: pack.dispute_id,
    packId,
    actorType: auditActor.actorType,
    actorId: auditActor.actorId,
    eventType: "return_request_confirmation_recorded",
    eventPayload: { answer, cycle, answeredAt },
  });

  await sb.from("jobs").insert({
    shop_id: pack.shop_id,
    job_type: "build_pack",
    entity_id: packId,
  });

  return NextResponse.json({ ok: true, answer, cycle }, { status: 201 });
}
