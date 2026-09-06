/**
 * POST /api/packs/:packId/cardholder-acknowledgement
 *
 * Records merchant-supplied evidence that the cardholder placed and/or
 * received this order. Inserts a manual `evidence_items` row with
 * `customerConfirmsOrder: true` on the payload — the canonical
 * categorizer (lib/argument/canonicalEvidence.ts) treats this as the
 * decisive signal that elevates `customer_communication` from
 * supporting → strong. Without this UI, the merchant has no way to
 * surface that signal even when they have a clear email/chat from the
 * customer acknowledging the purchase.
 *
 * Inputs:
 *   - text: the customer's message, pasted by the merchant (server-
 *     normalizes whitespace, enforces a 20-character minimum so an
 *     empty submission can't accidentally elevate strength).
 *   - confirmedByMerchant: explicit checkbox value. MUST be `true` —
 *     server defence-in-depth alongside the client requirement.
 *
 * Side effects:
 *   1. Insert evidence_items row (source=manual_upload, type=comms).
 *      Payload carries `customerConfirmsOrder=true`, `kind=
 *      cardholder_acknowledgement` as the discriminator,
 *      `fieldsProvided=["customer_communication"]`, and the text.
 *      `type` must match the DB CHECK constraint allowlist
 *      (order | shipping | tracking | policy | comms | other).
 *   2. Patch checklist_v2.customer_communication → status=available so
 *      the row reflects the new evidence immediately.
 *   3. Log audit events: `item_added` (existing) +
 *      `cardholder_acknowledgement_confirmed` (new, carries no PII —
 *      records the fact of the confirmation, not the text content).
 *   4. Enqueue `build_pack` so the new evidence reaches the defence
 *      package without merchant action.
 *
 * Resubmission window: rejected with 409 WINDOW_CLOSED when the
 * dispute's submission_state === "submitted_confirmed". Mirrors the
 * existing upload-route guard.
 *
 * Response:
 *   - 200 { ok: true, evidenceItemId, promptRebuild: true, packId }
 *     The `promptRebuild: true` signal triggers the existing
 *     RegeneratePromptModal on the client so the merchant can confirm
 *     resubmission to Shopify after the rebuild completes.
 *
 * Hard constraint: this is the ONLY path that writes
 * `customerConfirmsOrder: true` from merchant input. The categorizer
 * trusts this flag; we trust the merchant checkbox + a real text
 * payload. Audit trail records both for compliance review.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { parseJsonBody } from "@/lib/http/parseJsonBody";
import { deriveCompletenessMetrics } from "@/lib/automation/completeness";
import { JOB_PRIORITY_INTERACTIVE } from "@/lib/jobs/priorities";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";

export const runtime = "nodejs";

const FIELD_KEY = "customer_communication";
const MIN_TEXT_LENGTH = 20;
const MAX_TEXT_LENGTH = 8000;

interface AcknowledgementBody {
  text: string;
  confirmedByMerchant: boolean;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ packId: string }> },
) {
  const { packId } = await params;
  const shopId = extractShopId(req);
  if (!shopId || shopId === "demo") {
    return NextResponse.json(
      { error: "Shop context required.", code: "SHOP_CONTEXT_REQUIRED" },
      { status: 401 },
    );
  }
  const sb = getServiceClient();

  const parsed = await parseJsonBody<AcknowledgementBody>(req);
  if (parsed instanceof NextResponse) return parsed;
  const rawText = typeof parsed.text === "string" ? parsed.text : "";
  const confirmedByMerchant = parsed.confirmedByMerchant === true;
  const text = rawText.trim();

  if (!confirmedByMerchant) {
    return NextResponse.json(
      {
        error: "Merchant confirmation checkbox is required.",
        code: "CONFIRMATION_REQUIRED",
      },
      { status: 400 },
    );
  }
  if (text.length < MIN_TEXT_LENGTH) {
    return NextResponse.json(
      {
        error: `Acknowledgement text must be at least ${MIN_TEXT_LENGTH} characters.`,
        code: "TEXT_TOO_SHORT",
      },
      { status: 400 },
    );
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json(
      {
        error: `Acknowledgement text exceeds the ${MAX_TEXT_LENGTH}-character limit.`,
        code: "TEXT_TOO_LONG",
      },
      { status: 400 },
    );
  }

  const { data: pack, error: packErr } = await sb
    .from("evidence_packs")
    .select("id, shop_id, dispute_id, status, checklist_v2")
    .eq("id", packId)
    .eq("shop_id", shopId)
    .single();

  if (packErr || !pack) {
    return NextResponse.json({ error: "Pack not found" }, { status: 404 });
  }

  if (pack.status === "building" || pack.status === "queued") {
    return NextResponse.json(
      { error: "Cannot add evidence while pack is building" },
      { status: 409 },
    );
  }

  // Resubmission window guard — same shape as the upload route. If
  // Shopify has forwarded the evidence to the bank, new files are
  // useless.
  let disputeSubmissionState: string | null = null;
  if (pack.dispute_id) {
    const { data: disputeRow } = await sb
      .from("disputes")
      .select("submission_state, submitted_at")
      .eq("id", pack.dispute_id)
      .single();
    disputeSubmissionState =
      (disputeRow?.submission_state as string | null) ?? null;
    if (disputeSubmissionState === "submitted_confirmed") {
      return NextResponse.json(
        {
          error: "WINDOW_CLOSED",
          message:
            "Shopify has already forwarded this dispute evidence to the bank, so new acknowledgements can no longer be added.",
        },
        { status: 409 },
      );
    }
  }

  const confirmedAt = new Date().toISOString();

  // Insert the evidence_items row. Payload mirrors the upload route's
  // shape so collectedFieldsFromPack (lib/packs/checklistReconcile.ts)
  // flips the customer_communication checklist row to `available` on
  // the next workspace fetch, AND carries `customerConfirmsOrder: true`
  // so the categorizer treats it as the decisive strong signal.
  //
  // `type: "comms"` matches the DB CHECK constraint allowlist
  // (order | shipping | tracking | policy | comms | other); the
  // `payload.kind: "cardholder_acknowledgement"` discriminator
  // distinguishes this row from a regular customer-communication
  // upload for downstream consumers.
  const { data: item, error: itemErr } = await sb
    .from("evidence_items")
    .insert({
      pack_id: packId,
      type: "comms",
      label: "Cardholder acknowledgement",
      source: "manual_upload",
      payload: {
        kind: "cardholder_acknowledgement",
        text,
        textLength: text.length,
        customerConfirmsOrder: true,
        confirmedByMerchant: true,
        confirmedAt,
        confirmedBy: "merchant",
        checklistField: FIELD_KEY,
        fieldsProvided: [FIELD_KEY],
      },
    })
    .select("id")
    .single();

  if (itemErr || !item) {
    return NextResponse.json(
      {
        error: `Failed to record acknowledgement: ${
          itemErr?.message ?? "unknown error"
        }`,
        code: "PERSIST_FAILED",
      },
      { status: 500 },
    );
  }

  // Patch checklist_v2 in place so the customer_communication row
  // flips to available immediately. Mirrors the upload route's
  // in-place patch (deliberate, see the comment in
  // app/api/packs/[packId]/upload/route.ts:273-278).
  const priorChecklist = (pack.checklist_v2 ?? []) as ChecklistItemV2[];
  const patchedChecklist: ChecklistItemV2[] = priorChecklist.map((c) =>
    c.field === FIELD_KEY && c.status !== "waived"
      ? { ...c, status: "available" as const, unavailableReason: undefined }
      : c,
  );
  const metrics = deriveCompletenessMetrics(patchedChecklist);
  await sb
    .from("evidence_packs")
    .update({
      checklist_v2: patchedChecklist,
      checklist: metrics.legacyChecklist,
      completeness_score: metrics.completenessScore,
      blockers: metrics.legacyBlockers,
      recommended_actions: metrics.legacyRecommendedActions,
      submission_readiness: metrics.submissionReadiness,
      updated_at: new Date().toISOString(),
    })
    .eq("id", packId);

  await logAuditEvent({
    shopId: pack.shop_id,
    disputeId: pack.dispute_id,
    packId,
    actorType: "merchant",
    eventType: "item_added",
    eventPayload: {
      type: "comms",
      label: "Cardholder acknowledgement",
      evidenceItemId: item.id,
      checklistField: FIELD_KEY,
      textLength: text.length,
      kind: "cardholder_acknowledgement",
    },
  });

  // Separate audit event for compliance review — captures the FACT of
  // the merchant confirmation without storing PII (the text body is on
  // the evidence_items row, which is the canonical store).
  await logAuditEvent({
    shopId: pack.shop_id,
    disputeId: pack.dispute_id,
    packId,
    actorType: "merchant",
    eventType: "cardholder_acknowledgement_confirmed",
    eventPayload: {
      evidenceItemId: item.id,
      textLength: text.length,
      confirmedAt,
    },
  });

  // Enqueue a fresh build_pack so the new acknowledgement reaches the
  // defence package without merchant intervention. The build job
  // re-classifies facts; `customerConfirmsOrder: true` flips
  // customer_communication to strong, which the LLM cites in the
  // narrative.
  await sb.from("jobs").insert({
    shop_id: pack.shop_id,
    job_type: "build_pack",
    entity_id: packId,
    priority: JOB_PRIORITY_INTERACTIVE,
  });

  // Client signal: when the dispute is in the resubmission window
  // (saved_to_shopify), surface the RegeneratePromptModal so the
  // merchant can push the new pack to Shopify after the build lands.
  // For DRAFT (not yet saved), the merchant clicks Submit normally.
  const responseBody: Record<string, unknown> = {
    ok: true,
    evidenceItemId: item.id,
  };
  if (disputeSubmissionState === "saved_to_shopify") {
    responseBody.promptRebuild = true;
    responseBody.packId = packId;
  }

  return NextResponse.json(responseBody, { status: 201 });
}
