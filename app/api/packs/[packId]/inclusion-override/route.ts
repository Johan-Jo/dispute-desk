import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { parseJsonBody } from "@/lib/http/parseJsonBody";
import { INTERNAL_ONLY_FIELDS } from "@/lib/defence/factClassifier";
import { CANONICAL_EVIDENCE } from "@/lib/argument/canonicalEvidence";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";

export const runtime = "nodejs";

type OverrideValue = "force_include" | "force_exclude" | null;

interface OverrideRequestBody {
  field: string;
  /** Use `null` (or omit) to clear an existing override. */
  value?: OverrideValue;
  /** Phase 2 (2026-05-20): when `true`, the merchant has acknowledged
   *  the bank-facing risk of force-including an internal-only signal
   *  via the warning modal. Lifts the OVERRIDE_NEEDS_CONFIRMATION 409
   *  gate. Must be `true` to bypass — anything else (false, undefined)
   *  routes through the Phase 1 guard. Audited as a distinct event
   *  type so the override is traceable. */
  acknowledgedRisk?: boolean;
}

/**
 * POST /api/packs/:packId/inclusion-override
 *
 * Records a merchant inclusion override for a single evidence field on
 * an evidence pack. Persists to `pack_json.inclusionOverrides` (keyed
 * by field) and logs an audit event.
 *
 * **Phase 1 + Phase 2 gate:** `force_include` for fields in
 * `INTERNAL_ONLY_FIELDS` returns 409 `OVERRIDE_NEEDS_CONFIRMATION`
 * UNLESS the request body includes `acknowledgedRisk: true` (Phase 2,
 * 2026-05-20). When acknowledged, the override is persisted AND a
 * distinct `evidence_inclusion_overridden_with_warning` audit event is
 * logged carrying `{ riskAcknowledged: true, modalShown: "phase2_v1" }`
 * so the merchant's explicit choice is permanently recorded.
 *
 * **Override semantics are enforced at the derivation layer**
 * (lib/argument/evidenceLineItem.ts). The route only persists the
 * intent — the derivation refuses to elevate the row to bank_argument
 * even when force_include lands on an internal-only field. The
 * acknowledgement gate is about traceability, not about silently
 * promoting risk to a positive signal.
 *
 * Plan: C:\Users\johan\.claude\plans\do-a-plan-for-scalable-parrot.md §10
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

  const parsed = await parseJsonBody<OverrideRequestBody>(req);
  if (parsed instanceof NextResponse) return parsed;
  const { field } = parsed;
  const value: OverrideValue = parsed.value ?? null;
  const acknowledgedRisk = parsed.acknowledgedRisk === true;

  if (!field || typeof field !== "string") {
    return NextResponse.json(
      { error: "field is required" },
      { status: 400 },
    );
  }
  if (value !== null && value !== "force_include" && value !== "force_exclude") {
    return NextResponse.json(
      { error: "value must be 'force_include', 'force_exclude', or null" },
      { status: 400 },
    );
  }
  if (!CANONICAL_EVIDENCE[field]) {
    return NextResponse.json(
      { error: "Unknown evidence field", code: "UNKNOWN_FIELD" },
      { status: 400 },
    );
  }

  // Phase 1 + 2 safety guard — internal-only fields require explicit
  // risk acknowledgement (Phase 2, 2026-05-20). Without it the request
  // is rejected with the same 409 the frontend already handles.
  const isInternalOnlyForceInclude =
    value === "force_include" && INTERNAL_ONLY_FIELDS.has(field);
  if (isInternalOnlyForceInclude && !acknowledgedRisk) {
    return NextResponse.json(
      {
        error: "Force-including an internal-only signal requires explicit risk acknowledgement.",
        code: "OVERRIDE_NEEDS_CONFIRMATION",
      },
      { status: 409 },
    );
  }

  const { data: pack, error } = await sb
    .from("evidence_packs")
    .select("id, shop_id, dispute_id, status, pack_json, checklist_v2")
    .eq("id", packId)
    .eq("shop_id", shopId)
    .single();

  if (error || !pack) {
    return NextResponse.json({ error: "Pack not found" }, { status: 404 });
  }

  if (pack.status === "building" || pack.status === "queued") {
    return NextResponse.json(
      { error: "Cannot override while pack is building" },
      { status: 409 },
    );
  }

  // Validate the field actually exists in this pack's checklist —
  // a defensive belt-and-suspenders check on top of the registry
  // lookup above.
  const checklist = (pack.checklist_v2 ?? []) as ChecklistItemV2[];
  const targetRow = checklist.find((c) => c.field === field);
  if (!targetRow) {
    return NextResponse.json(
      {
        error: "Field is not part of this pack's checklist",
        code: "FIELD_NOT_IN_CHECKLIST",
      },
      { status: 400 },
    );
  }

  // Patch pack_json.inclusionOverrides in place. Clearing an override
  // (value === null) removes the key entirely so the absence is canonical.
  const packJson = (pack.pack_json ?? {}) as {
    inclusionOverrides?: Record<string, "force_include" | "force_exclude">;
    [k: string]: unknown;
  };
  const priorOverrides = packJson.inclusionOverrides ?? {};
  const priorValue: OverrideValue = priorOverrides[field] ?? null;
  const nextOverrides: Record<string, "force_include" | "force_exclude"> = {
    ...priorOverrides,
  };
  if (value === null) delete nextOverrides[field];
  else nextOverrides[field] = value;

  const nextPackJson = {
    ...packJson,
    inclusionOverrides: nextOverrides,
  };

  const { error: updateErr } = await sb
    .from("evidence_packs")
    .update({
      pack_json: nextPackJson,
      updated_at: new Date().toISOString(),
    })
    .eq("id", packId);

  if (updateErr) {
    return NextResponse.json(
      { error: `Failed to persist override: ${updateErr.message}` },
      { status: 500 },
    );
  }

  // Audit. When the merchant explicitly acknowledged the bank-facing
  // risk on an internal-only signal, log a distinct event type so the
  // override is permanently traceable. Reviewing the case later, ops
  // can grep `evidence_inclusion_overridden_with_warning` to see every
  // explicit risk acknowledgement.
  const eventType: "evidence_inclusion_overridden" | "evidence_inclusion_overridden_with_warning" =
    isInternalOnlyForceInclude && acknowledgedRisk
      ? "evidence_inclusion_overridden_with_warning"
      : "evidence_inclusion_overridden";

  await logAuditEvent({
    shopId: pack.shop_id,
    disputeId: pack.dispute_id,
    packId,
    actorType: "merchant",
    eventType,
    eventPayload: {
      field,
      label: targetRow.label,
      action: value === null ? "clear" : value,
      priorState: priorValue,
      ...(isInternalOnlyForceInclude && acknowledgedRisk
        ? {
            riskAcknowledged: true,
            modalShown: "phase2_v1",
            confirmedAt: new Date().toISOString(),
          }
        : {}),
    },
  });

  return NextResponse.json({
    ok: true,
    field,
    value,
    priorValue,
    acknowledgedRisk: isInternalOnlyForceInclude && acknowledgedRisk,
  });
}
