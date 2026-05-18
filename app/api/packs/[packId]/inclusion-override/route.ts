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
}

/**
 * POST /api/packs/:packId/inclusion-override
 *
 * Records a merchant inclusion override for a single evidence field on
 * an evidence pack. Persists to `pack_json.inclusionOverrides` (keyed
 * by field) and logs an `evidence_inclusion_overridden` audit event.
 *
 * **Phase 1 guard:** `force_include` is REJECTED with 409
 * `OVERRIDE_NEEDS_CONFIRMATION` for fields in `INTERNAL_ONLY_FIELDS` —
 * promoting a negative/ambiguous signal to bank-facing requires a
 * warning + confirmation flow that's out of scope for Phase 1.
 *
 * **Override semantics are enforced at the derivation layer**
 * (lib/argument/evidenceLineItem.ts). The route only persists the
 * intent — the derivation respects safety rules even if a malicious
 * override slipped through (defence in depth).
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

  // Phase 1 safety guard — internal-only fields cannot be force-included.
  if (value === "force_include" && INTERNAL_ONLY_FIELDS.has(field)) {
    return NextResponse.json(
      {
        error: "Force-including an internal-only signal requires a confirmation flow not available in Phase 1.",
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

  await logAuditEvent({
    shopId: pack.shop_id,
    disputeId: pack.dispute_id,
    packId,
    actorType: "merchant",
    eventType: "evidence_inclusion_overridden",
    eventPayload: {
      field,
      label: targetRow.label,
      action: value === null ? "clear" : value,
      priorState: priorValue,
    },
  });

  return NextResponse.json({
    ok: true,
    field,
    value,
    priorValue,
  });
}
