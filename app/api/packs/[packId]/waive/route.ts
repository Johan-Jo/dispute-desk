import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { parseJsonBody } from "@/lib/http/parseJsonBody";
import { deriveCompletenessMetrics } from "@/lib/automation/completeness";
import type {
  ChecklistItemV2,
  WaiveReason,
  WaivedItemRecord,
} from "@/lib/types/evidenceItem";
import { WAIVE_REASONS } from "@/lib/types/evidenceItem";

export const runtime = "nodejs";

/**
 * POST /api/packs/:packId/waive
 *
 * Waive a missing evidence item — merchant chooses to proceed without it.
 * Updates waived_items, patches the existing checklist_v2 row in place,
 * re-derives metrics, logs audit event.
 *
 * Why an in-place patch (not a full evaluateCompletenessV2 rebuild):
 * the build path feeds evaluateCompletenessV2 the real `collectedFields`,
 * DB-backed `templateItems`, and the live `orderContext`. The waive
 * endpoint has none of those on hand, so re-running the full evaluation
 * would silently strip rows (template items vanish; conditional rows
 * resolve against DEFAULT_ORDER_CONTEXT and flip to `unavailable`),
 * collapsing the entire "Evidence on file" section after a single waive.
 * Mirrors the manual-upload route's pattern.
 */
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
      "id, shop_id, dispute_id, status, waived_items, checklist_v2",
    )
    .eq("id", packId)
    .eq("shop_id", shopId)
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

  const priorChecklist = (pack.checklist_v2 ?? []) as ChecklistItemV2[];

  // Resolve label from the existing checklist — the row we're waiving
  // is the source of truth for the field's display label.
  const targetRow = priorChecklist.find((c) => c.field === field);
  const fieldLabel = targetRow?.label ?? field;

  // Append to waived_items (idempotent: replace if field already waived)
  const existing = (pack.waived_items ?? []) as WaivedItemRecord[];
  const waivedAt = new Date().toISOString();
  const newRecord: WaivedItemRecord = {
    field,
    label: fieldLabel,
    reason,
    note,
    waivedAt,
    waivedBy: "merchant",
  };
  const updatedWaivedItems = [
    ...existing.filter((w) => w.field !== field),
    newRecord,
  ];

  // Patch the existing checklist in place. Only the target row's status
  // flips to "waived"; every other row preserves its prior state so the
  // "Evidence on file" supporting bucket stays intact. If the row doesn't
  // exist yet (rare — manual upload of an off-template field), append it
  // so the waive record has a corresponding checklist row.
  const patchedChecklist: ChecklistItemV2[] = targetRow
    ? priorChecklist.map((c) =>
        c.field === field
          ? {
              ...c,
              status: "waived" as const,
              waiveReason: reason,
              waiveNote: note,
              waivedAt,
              waivedBy: "merchant",
            }
          : c,
      )
    : [
        ...priorChecklist,
        {
          field,
          label: fieldLabel,
          status: "waived" as const,
          priority: "optional",
          blocking: false,
          source: "manual_upload",
          waiveReason: reason,
          waiveNote: note,
          waivedAt,
          waivedBy: "merchant",
        },
      ];

  const metrics = deriveCompletenessMetrics(patchedChecklist);

  await sb
    .from("evidence_packs")
    .update({
      waived_items: updatedWaivedItems,
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
    eventType: "evidence_waived",
    eventPayload: { field, reason, note, label: fieldLabel },
  });

  return NextResponse.json({
    ok: true,
    submissionReadiness: metrics.submissionReadiness,
    completenessScore: metrics.completenessScore,
  });
}

/**
 * DELETE /api/packs/:packId/waive?field=xxx
 *
 * Un-waive a previously waived item — restores it to missing state.
 * Same in-place patch rationale as POST.
 */
export async function DELETE(
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
      "id, shop_id, dispute_id, status, waived_items, checklist_v2",
    )
    .eq("id", packId)
    .eq("shop_id", shopId)
    .single();

  if (error || !pack) {
    return NextResponse.json({ error: "Pack not found" }, { status: 404 });
  }

  const existing = (pack.waived_items ?? []) as WaivedItemRecord[];
  const updatedWaivedItems = existing.filter((w) => w.field !== field);

  if (updatedWaivedItems.length === existing.length) {
    return NextResponse.json({ error: "Field not found in waived items" }, { status: 404 });
  }

  // Patch in place: flip the row from "waived" back to "missing" and
  // strip waive metadata. Everything else stays untouched. The next
  // workspace read will run reconcileChecklistWithCollectedFields, which
  // will flip the row to "available" if the field was actually collected.
  const priorChecklist = (pack.checklist_v2 ?? []) as ChecklistItemV2[];
  const patchedChecklist: ChecklistItemV2[] = priorChecklist.map((c) => {
    if (c.field !== field) return c;
    const {
      waiveReason: _waiveReason,
      waiveNote: _waiveNote,
      waivedAt: _waivedAt,
      waivedBy: _waivedBy,
      ...rest
    } = c;
    return { ...rest, status: "missing" as const };
  });

  const metrics = deriveCompletenessMetrics(patchedChecklist);

  await sb
    .from("evidence_packs")
    .update({
      waived_items: updatedWaivedItems,
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
    eventType: "evidence_unwaived",
    eventPayload: { field },
  });

  return NextResponse.json({
    ok: true,
    submissionReadiness: metrics.submissionReadiness,
    completenessScore: metrics.completenessScore,
  });
}
