import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import {
  buildEvidenceInputFromRaw,
  FIELD_MAPPINGS,
  type RawPackSection,
} from "@/lib/shopify/fieldMapping";

export const runtime = "nodejs";

/**
 * GET /api/packs/:packId/submission-preview
 *
 * Returns a human-readable preview of exactly what will be sent
 * to Shopify. Uses the same serialization as the actual submission
 * so preview matches reality.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ packId: string }> },
) {
  const { packId } = await params;
  const sb = getServiceClient();

  const { data: pack, error } = await sb
    .from("evidence_packs")
    .select("id, pack_json")
    .eq("id", packId)
    .single();

  if (error || !pack) {
    return NextResponse.json({ error: "Pack not found" }, { status: 404 });
  }

  const packJson = pack.pack_json as {
    sections?: Array<{
      type: string;
      label: string;
      source: string;
      data: Record<string, unknown>;
    }>;
  } | null;

  if (!packJson?.sections) {
    return NextResponse.json({ fields: [] });
  }

  // Convert to RawPackSection format
  const rawSections: RawPackSection[] = packJson.sections.map((s) => ({
    type: s.type,
    label: s.label,
    source: s.source,
    data: s.data,
  }));

  // Use the real serialization engine (same as actual Shopify submission)
  const evidenceInput = buildEvidenceInputFromRaw(rawSections);

  // Also get rebuttal
  const { data: rebuttal } = await sb
    .from("rebuttal_drafts")
    .select("sections")
    .eq("pack_id", packId)
    .eq("locale", "en-US")
    .maybeSingle();

  if (rebuttal?.sections) {
    const rebuttalSections = rebuttal.sections as Array<{ text: string }>;
    const rebuttalText = rebuttalSections.map((s) => s.text).join("\n\n");
    if (rebuttalText.trim()) {
      // Add to cancellationRebuttal or uncategorizedText
      if (!evidenceInput.cancellationRebuttal) {
        evidenceInput.cancellationRebuttal = rebuttalText;
      } else {
        evidenceInput.uncategorizedText =
          (evidenceInput.uncategorizedText ? evidenceInput.uncategorizedText + "\n\n" : "") +
          rebuttalText;
      }
    }
  }

  // Build preview fields from the evidence input
  const fields = FIELD_MAPPINGS.map((mapping) => {
    const content = (evidenceInput as Record<string, string | undefined>)[mapping.shopifyField] ?? "";
    return {
      shopifyFieldName: mapping.shopifyField,
      shopifyFieldLabel: mapping.label,
      content,
      contentPreview: content.length > 300 ? content.slice(0, 300) + "..." : content,
      source: "auto",
      included: content.length > 0,
    };
  }).filter((f) => f.included);

  return NextResponse.json({ fields });
}
