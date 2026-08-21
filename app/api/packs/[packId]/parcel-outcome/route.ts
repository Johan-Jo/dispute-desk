/**
 * POST /api/packs/:packId/parcel-outcome
 *
 * Records the merchant's answer to the one question about a returned
 * parcel that no system can answer for them: **why did it come back, and
 * what happened to it since?**
 *
 * ── Why this exists ──────────────────────────────────────────────────
 *
 * When a carrier returns a parcel to the merchant, the case cannot carry
 * a proof of delivery — one can never exist — so the returned-to-sender
 * gate (`lib/automation/returnedToSender.ts`) caps strength at weak and
 * blocks every automated filing. That is honest but not yet useful. The
 * one thing that could still help is a fact only the merchant holds.
 *
 * Klarna's merchant documentation is explicit about it: a parcel refused
 * or left uncollected and sent back "is not a valid use of the right of
 * withdrawal (in the EU) nor is it considered a valid return", and — "If
 * a customer has not accepted the delivery make sure this information is
 * included either in the POD or in the response to Klarna." That is a
 * real, narrow argument, and until this route existed we had no way to
 * supply it.
 *
 * ── Two fields, two audiences ────────────────────────────────────────
 *
 *   `reason`      — WHY it came back. BANK-FACING when it is
 *                   `refused_delivery` or `not_collected`.
 *                   `undeliverable_address` is recorded and never cited:
 *                   "we shipped to an address that does not work" is not
 *                   an argument, and offering it to an adjudicator only
 *                   answers a question nobody asked.
 *
 *   `disposition` — what the merchant DID with the returned goods.
 *                   NEVER bank-facing, under any value. "Restocked, not
 *                   refunded" is a confession, and it is the answer most
 *                   likely to be true. It exists so the merchant's own
 *                   view of the case is complete, and so we can tell them
 *                   plainly when conceding is the right call.
 *
 * The split is enforced downstream in `lib/defence/factClassifier.ts`,
 * which hands the writer a `citableReason` and never the disposition —
 * the same two-layer non-disclosure rule the fatal-loss message follows.
 *
 * ── Shape ────────────────────────────────────────────────────────────
 *
 * Mirrors `cardholder-acknowledgement/route.ts` end to end: insert a
 * manual `evidence_items` row with a `kind` discriminator, patch
 * `checklist_v2` so the row flips to available immediately, audit, then
 * enqueue `build_pack` so the answer reaches the defence package with no
 * further merchant action.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { parseJsonBody } from "@/lib/http/parseJsonBody";
import { deriveCompletenessMetrics } from "@/lib/automation/completeness";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";

export const runtime = "nodejs";

const FIELD_KEY = "returned_parcel_outcome";
const MAX_NOTE_LENGTH = 2000;

/** Why the carrier brought the parcel back. */
const REASONS = [
  "refused_delivery",
  "not_collected",
  "undeliverable_address",
] as const;
type ParcelReason = (typeof REASONS)[number];

/** What the merchant did with the goods once they were back. */
const DISPOSITIONS = [
  "restocked_not_refunded",
  "refunded",
  "reshipped",
  "still_held",
] as const;
type ParcelDisposition = (typeof DISPOSITIONS)[number];

interface ParcelOutcomeBody {
  reason: string;
  disposition: string;
  note?: string | null;
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

  const parsed = await parseJsonBody<ParcelOutcomeBody>(req);
  if (parsed instanceof NextResponse) return parsed;

  const reason = REASONS.includes(parsed.reason as ParcelReason)
    ? (parsed.reason as ParcelReason)
    : null;
  const disposition = DISPOSITIONS.includes(parsed.disposition as ParcelDisposition)
    ? (parsed.disposition as ParcelDisposition)
    : null;
  const note =
    typeof parsed.note === "string" ? parsed.note.trim().replace(/\s+/g, " ") : "";

  if (!reason) {
    return NextResponse.json(
      {
        error: `reason must be one of: ${REASONS.join(", ")}`,
        code: "REASON_REQUIRED",
      },
      { status: 400 },
    );
  }
  if (!disposition) {
    return NextResponse.json(
      {
        error: `disposition must be one of: ${DISPOSITIONS.join(", ")}`,
        code: "DISPOSITION_REQUIRED",
      },
      { status: 400 },
    );
  }
  if (note.length > MAX_NOTE_LENGTH) {
    return NextResponse.json(
      {
        error: `Note exceeds the ${MAX_NOTE_LENGTH}-character limit.`,
        code: "NOTE_TOO_LONG",
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

  // Resubmission window guard — identical to the acknowledgement and
  // upload routes. Once Shopify has forwarded the evidence, an answer
  // added here can no longer reach anybody.
  let disputeSubmissionState: string | null = null;
  if (pack.dispute_id) {
    const { data: disputeRow } = await sb
      .from("disputes")
      .select("submission_state, submitted_at")
      .eq("id", pack.dispute_id)
      .single();
    disputeSubmissionState = (disputeRow?.submission_state as string | null) ?? null;
    if (disputeSubmissionState === "submitted_confirmed") {
      return NextResponse.json(
        {
          error: "WINDOW_CLOSED",
          message:
            "Shopify has already forwarded this dispute evidence to the bank, so this answer can no longer be added.",
        },
        { status: 409 },
      );
    }
  }

  const answeredAt = new Date().toISOString();

  // `type: "shipping"` matches the DB CHECK allowlist
  // (order | shipping | tracking | policy | comms | other); the
  // `payload.kind` discriminator is what distinguishes this row.
  const { data: item, error: itemErr } = await sb
    .from("evidence_items")
    .insert({
      pack_id: packId,
      type: "shipping",
      label: "Returned parcel outcome",
      source: "manual_upload",
      payload: {
        kind: "returned_parcel_outcome",
        reason,
        disposition,
        note: note || null,
        answeredAt,
        answeredBy: "merchant",
        checklistField: FIELD_KEY,
        fieldsProvided: [FIELD_KEY],
      },
    })
    .select("id")
    .single();

  if (itemErr || !item) {
    return NextResponse.json(
      {
        error: `Failed to record parcel outcome: ${itemErr?.message ?? "unknown error"}`,
        code: "PERSIST_FAILED",
      },
      { status: 500 },
    );
  }

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
      type: "shipping",
      label: "Returned parcel outcome",
      evidenceItemId: item.id,
      checklistField: FIELD_KEY,
      kind: "returned_parcel_outcome",
    },
  });

  // Separate audit event: the disposition is a statement about the
  // merchant's own conduct with the goods and the money, and it is the
  // record anyone reviewing a lost dispute will want. Recorded without
  // the free-text note, which lives on the evidence_items row.
  await logAuditEvent({
    shopId: pack.shop_id,
    disputeId: pack.dispute_id,
    packId,
    actorType: "merchant",
    eventType: "parcel_outcome_recorded",
    eventPayload: { evidenceItemId: item.id, reason, disposition, answeredAt },
  });

  await sb.from("jobs").insert({
    shop_id: pack.shop_id,
    job_type: "build_pack",
    entity_id: packId,
  });

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
