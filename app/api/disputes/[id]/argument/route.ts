import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { parseJsonBody } from "@/lib/http/parseJsonBody";
import { generateArgumentMap } from "@/lib/argument/generateArgument";
import { generateRebuttalDraft } from "@/lib/argument/generateRebuttal";
import { selectRebuttalReason } from "@/lib/argument/rebuttalReason";
import { extractEvidenceDataFromPack } from "@/lib/argument/evidenceDataFromPack";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";

export const runtime = "nodejs";

/**
 * POST /api/disputes/:id/argument
 *
 * Generate (or regenerate) the argument map + rebuttal draft
 * from the dispute reason and pack evidence.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: disputeId } = await params;
  const sb = getServiceClient();

  const parsed = await parseJsonBody<{
    packId: string;
    regenerate?: boolean;
  }>(req);
  if (parsed instanceof NextResponse) return parsed;
  const { packId, regenerate } = parsed;

  if (!packId) {
    return NextResponse.json(
      { error: "packId is required" },
      { status: 400 },
    );
  }

  // Check for existing argument map (skip if not regenerating)
  if (!regenerate) {
    const { data: existing } = await sb
      .from("argument_maps")
      .select("id")
      .eq("dispute_id", disputeId)
      .eq("pack_id", packId)
      .maybeSingle();

    if (existing) {
      // Return existing
      const { data: map } = await sb
        .from("argument_maps")
        .select("*")
        .eq("id", existing.id)
        .single();
      const { data: rebuttal } = await sb
        .from("rebuttal_drafts")
        .select("*")
        .eq("pack_id", packId)
        .eq("locale", "en-US")
        .maybeSingle();

      return NextResponse.json({
        argumentMap: map
          ? {
              issuerClaim: map.issuer_claim,
              counterclaims: map.counterclaims,
              overallStrength: map.overall_strength,
            }
          : null,
        rebuttalDraft: rebuttal
          ? { sections: rebuttal.sections, source: rebuttal.source }
          : null,
      });
    }
  }

  // Load dispute reason
  const { data: dispute, error: disputeErr } = await sb
    .from("disputes")
    .select("id, reason, shop_id, customer_email")
    .eq("id", disputeId)
    .single();

  if (disputeErr) {
    if (disputeErr.code === "PGRST116") {
      return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Failed to load dispute", detail: disputeErr.message },
      { status: 500 },
    );
  }

  // Load pack checklist + raw sections (sections feed the bank-grade
  // rebuttal extractor so AVS/CVV codes and IP narrative cite real
  // pack data instead of generic placeholders).
  const { data: pack, error: packErr } = await sb
    .from("evidence_packs")
    .select("id, checklist_v2, checklist, shop_id, pack_json")
    .eq("id", packId)
    .single();

  if (packErr) {
    if (packErr.code === "PGRST116") {
      return NextResponse.json({ error: "Pack not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Failed to load evidence pack", detail: packErr.message },
      { status: 500 },
    );
  }

  // Derive v2 checklist
  const checklist: ChecklistItemV2[] =
    (pack.checklist_v2 as ChecklistItemV2[] | null) ??
    ((pack.checklist as Array<{ field: string; label: string; required: boolean; present: boolean }>) ?? []).map(
      (c): ChecklistItemV2 => ({
        field: c.field,
        label: c.label,
        status: c.present ? "available" : "missing",
        priority: c.required ? "critical" : "recommended",
        blocking: false,
        source: "auto_shopify",
      }),
    );

  // Generate argument map
  const argumentMap = generateArgumentMap(dispute.reason, checklist);

  // Auto-select rebuttal reason
  const rebuttalReason = selectRebuttalReason(dispute.reason, checklist);

  // Extract bank-grade evidence (AVS/CVV codes, auth/capture, IP
  // narrative) from the persisted pack so the new template can cite
  // real signals rather than fall back to generic wording.
  const packJson = (pack.pack_json ?? null) as { sections?: unknown[] } | null;
  const rawSections = Array.isArray(packJson?.sections)
    ? (packJson.sections as Array<Record<string, unknown>>)
    : [];
  const evidenceData = extractEvidenceDataFromPack(rawSections, {
    id: dispute.id,
    reason: dispute.reason,
    shop_id: dispute.shop_id,
    customer_email: dispute.customer_email,
  });

  // Generate rebuttal
  const rebuttalDraft = generateRebuttalDraft(argumentMap, rebuttalReason, evidenceData);

  // Upsert argument map
  if (regenerate) {
    const { error: delErr } = await sb
      .from("argument_maps")
      .delete()
      .eq("dispute_id", disputeId)
      .eq("pack_id", packId);
    if (delErr) {
      return NextResponse.json(
        { error: "Failed to clear prior argument map", detail: delErr.message },
        { status: 500 },
      );
    }
  }

  const { error: mapErr } = await sb.from("argument_maps").insert({
    dispute_id: disputeId,
    pack_id: packId,
    issuer_claim: argumentMap.issuerClaim,
    counterclaims: argumentMap.counterclaims,
    overall_strength: argumentMap.overallStrength,
  });
  if (mapErr) {
    return NextResponse.json(
      { error: "Failed to save argument map", detail: mapErr.message },
      { status: 500 },
    );
  }

  // Upsert rebuttal draft
  const { error: draftErr } = await sb.from("rebuttal_drafts").upsert(
    {
      pack_id: packId,
      locale: "en-US",
      sections: rebuttalDraft.sections,
      source: "GENERATED",
      version: 1,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "pack_id,locale" },
  );
  if (draftErr) {
    return NextResponse.json(
      { error: "Failed to save defense letter", detail: draftErr.message },
      { status: 500 },
    );
  }

  await logAuditEvent({
    shopId: dispute.shop_id,
    disputeId,
    packId,
    actorType: "system",
    eventType: "pack_created",
    eventPayload: {
      action: regenerate ? "argument_regenerated" : "argument_generated",
      overallStrength: argumentMap.overallStrength,
      claimCount: argumentMap.counterclaims.length,
    },
  });

  return NextResponse.json({
    argumentMap: {
      issuerClaim: argumentMap.issuerClaim,
      counterclaims: argumentMap.counterclaims,
      overallStrength: argumentMap.overallStrength,
    },
    rebuttalReason,
    rebuttalDraft: {
      sections: rebuttalDraft.sections,
      source: rebuttalDraft.source,
    },
  });
}
