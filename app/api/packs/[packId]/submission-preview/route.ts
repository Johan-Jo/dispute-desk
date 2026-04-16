import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import {
  previewEvidenceMapping,
  type PackSection,
} from "@/lib/shopify/fieldMapping";

export const runtime = "nodejs";

/**
 * GET /api/packs/:packId/submission-preview
 *
 * Compute the exact Shopify submission payload preview.
 * Does NOT submit — returns what would be sent.
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
    return NextResponse.json(
      { error: "Pack not found" },
      { status: 404 },
    );
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

  // Build PackSection array from pack_json sections
  const sections: PackSection[] = packJson.sections.map((s) => ({
    key: s.type,
    label: s.label,
    content: JSON.stringify(s.data, null, 2),
  }));

  // Also check for rebuttal draft
  const { data: rebuttal } = await sb
    .from("rebuttal_drafts")
    .select("sections, source")
    .eq("pack_id", packId)
    .eq("locale", "en-US")
    .maybeSingle();

  if (rebuttal?.sections) {
    const rebuttalSections = rebuttal.sections as Array<{
      type: string;
      text: string;
    }>;
    const rebuttalText = rebuttalSections
      .map((s) => s.text)
      .join("\n\n");
    if (rebuttalText.trim()) {
      sections.push({
        key: "cancellation_rebuttal",
        label: "Dispute Response Argument",
        content: rebuttalText,
      });
    }
  }

  const preview = previewEvidenceMapping(sections);

  const fields = preview.map((p) => ({
    shopifyFieldName: p.shopifyField,
    shopifyFieldLabel: p.label,
    content: p.content,
    contentPreview:
      p.content.length > 200
        ? p.content.slice(0, 200) + "..."
        : p.content,
    source: "auto",
    included: p.enabled,
  }));

  return NextResponse.json({ fields });
}
