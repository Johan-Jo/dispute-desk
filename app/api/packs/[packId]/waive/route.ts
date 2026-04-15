import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { parseJsonBody } from "@/lib/http/parseJsonBody";
import {
  evaluateCompletenessV2,
} from "@/lib/automation/completeness";
import type {
  WaiveReason,
  WaivedItemRecord,
} from "@/lib/types/evidenceItem";
import { WAIVE_REASONS } from "@/lib/types/evidenceItem";

export const runtime = "nodejs";

/**
 * POST /api/packs/:packId/waive
 *
 * Waive a missing evidence item — merchant chooses to proceed without it.
 * Updates waived_items, re-evaluates completeness, logs audit event.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ packId: string }> },
) {
  const { packId } = await params;
  const sb = getServiceClient();

  const parsed = await parseJsonBody<{
    field: string;
    reason: WaiveReason;
    note?: string;
  }>(req);
  if (parsed instanceof NextResponse) return parsed;
  const { field, reason, note } = parsed;

  if (!field || !reason) {
    return NextResponse.json(
      { error: "field and reason are required" },
      { status: 400 },
    );
  }
  if (!WAIVE_REASONS.includes(reason)) {
    return NextResponse.json(
      { error: "Invalid waive reason" },
      { status: 400 },
    );
  }
  if (reason === "other" && !note) {
    return NextResponse.json(
      { error: "A note is required when reason is 'other'" },
      { status: 400 },
    );
  }

  const { data: pack, error } = await sb
    .from("evidence_packs")
    .select(
      "id, shop_id, dispute_id, status, waived_items, checklist, checklist_v2",
    )
    .eq("id", packId)
    .single();

  if (error || !pack) {
    return NextResponse.json({ error: "Pack not found" }, { status: 404 });
  }

  if (pack.status === "building" || pack.status === "queued") {
    return NextResponse.json(
      { error: "Cannot waive while pack is building" },
      { status: 409 },
    );
  }

  // Append to waived_items (idempotent: replace if field already waived)
  const existing = (pack.waived_items ?? []) as WaivedItemRecord[];
  const fieldLabel =
    (pack.checklist_v2 as { field: string; label: string }[] | null)?.find(
      (c) => c.field === field,
    )?.label ??
    (pack.checklist as { field: string; label: string }[] | null)?.find(
      (c) => c.field === field,
    )?.label ??
    field;

  const newRecord: WaivedItemRecord = {
    field,
    label: fieldLabel,
    reason,
    note,
    waivedAt: new Date().toISOString(),
    waivedBy: "merchant",
  };
  const updated = [
    ...existing.filter((w) => w.field !== field),
    newRecord,
  ];

  // Re-evaluate completeness with the waive applied
  const { data: dispute } = pack.dispute_id
    ? await sb
        .from("disputes")
        .select("reason")
        .eq("id", pack.dispute_id)
        .single()
    : { data: null };

  // Collect present fields from v1 checklist
  const presentFields = new Set<string>();
  for (const c of (pack.checklist ?? []) as { field: string; present: boolean }[]) {
    if (c.present) presentFields.add(c.field);
  }

  const result = evaluateCompletenessV2(
    dispute?.reason ?? null,
    presentFields,
    updated,
    null,
  );

  await sb
    .from("evidence_packs")
    .update({
      waived_items: updated,
      checklist_v2: result.checklist,
      checklist: result.legacyChecklist,
      completeness_score: result.completenessScore,
      blockers: result.legacyBlockers,
      recommended_actions: result.legacyRecommendedActions,
      submission_readiness: result.submissionReadiness,
      updated_at: new Date().toISOString(),
    })
    .eq("id", packId);

  await logAuditEvent({
    shopId: pack.shop_id,
    disputeId: pack.dispute_id,
    packId,
    actorType: "merchant",
    eventType: "evidence_waived",
    eventPayload: { field, reason, note, label: fieldLabel },
  });

  return NextResponse.json({
    ok: true,
    submissionReadiness: result.submissionReadiness,
    completenessScore: result.completenessScore,
  });
}

/**
 * DELETE /api/packs/:packId/waive?field=xxx
 *
 * Un-waive a previously waived item — restores it to missing state.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ packId: string }> },
) {
  const { packId } = await params;
  const sb = getServiceClient();
  const field = req.nextUrl.searchParams.get("field");

  if (!field) {
    return NextResponse.json(
      { error: "field query parameter is required" },
      { status: 400 },
    );
  }

  const { data: pack, error } = await sb
    .from("evidence_packs")
    .select(
      "id, shop_id, dispute_id, status, waived_items, checklist",
    )
    .eq("id", packId)
    .single();

  if (error || !pack) {
    return NextResponse.json({ error: "Pack not found" }, { status: 404 });
  }

  const existing = (pack.waived_items ?? []) as WaivedItemRecord[];
  const updated = existing.filter((w) => w.field !== field);

  if (updated.length === existing.length) {
    return NextResponse.json({ error: "Field not found in waived items" }, { status: 404 });
  }

  // Re-evaluate
  const { data: dispute } = pack.dispute_id
    ? await sb
        .from("disputes")
        .select("reason")
        .eq("id", pack.dispute_id)
        .single()
    : { data: null };

  const presentFields = new Set<string>();
  for (const c of (pack.checklist ?? []) as { field: string; present: boolean }[]) {
    if (c.present) presentFields.add(c.field);
  }

  const result = evaluateCompletenessV2(
    dispute?.reason ?? null,
    presentFields,
    updated,
    null,
  );

  await sb
    .from("evidence_packs")
    .update({
      waived_items: updated,
      checklist_v2: result.checklist,
      checklist: result.legacyChecklist,
      completeness_score: result.completenessScore,
      blockers: result.legacyBlockers,
      recommended_actions: result.legacyRecommendedActions,
      submission_readiness: result.submissionReadiness,
      updated_at: new Date().toISOString(),
    })
    .eq("id", packId);

  await logAuditEvent({
    shopId: pack.shop_id,
    disputeId: pack.dispute_id,
    packId,
    actorType: "merchant",
    eventType: "evidence_unwaived",
    eventPayload: { field },
  });

  return NextResponse.json({
    ok: true,
    submissionReadiness: result.submissionReadiness,
    completenessScore: result.completenessScore,
  });
}
