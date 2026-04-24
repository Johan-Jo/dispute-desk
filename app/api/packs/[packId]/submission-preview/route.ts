import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import {
  buildEvidenceInputFromRaw,
  FIELD_MAPPINGS,
  type RawPackSection,
} from "@/lib/shopify/fieldMapping";
import {
  formatManualAttachmentsBlock,
  type ManualAttachmentInput,
  type PackPdfInput,
} from "@/lib/shopify/manualAttachments";

export const runtime = "nodejs";

// Placeholder shown in the preview where the save-to-shopify job will later
// substitute a real HMAC-signed DisputeDesk URL. Keeping the tokens out of the
// preview avoids leaking 180-day credentials through an authenticated UI
// endpoint — the merchant only needs to see that links will be emitted.
const PLACEHOLDER_ATTACHMENT_URL = "https://disputedesk.app/e/<secure-link>";

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
    .select("id, pack_json, pdf_path")
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

  // Mirror saveToShopifyJob: append the "Supporting documents" block so the
  // preview matches what the bank will see byte-for-byte (modulo the URL
  // token, which is swapped for a placeholder here — see top of file).
  const { data: manualItems } = await sb
    .from("evidence_items")
    .select("id, label, payload, created_at")
    .eq("pack_id", packId)
    .eq("source", "manual_upload")
    .order("created_at", { ascending: false });

  const manualAttachments: ManualAttachmentInput[] = (manualItems ?? []).map(
    (item) => {
      const meta = (item.payload ?? {}) as Record<string, unknown>;
      return {
        label: (item.label as string | null) ?? null,
        fileName: typeof meta.fileName === "string" ? meta.fileName : null,
        fileSize: typeof meta.fileSize === "number" ? meta.fileSize : null,
        createdAt: (item.created_at as string | null) ?? null,
        url: PLACEHOLDER_ATTACHMENT_URL,
      };
    },
  );

  const pdfAttachment: PackPdfInput | null = pack.pdf_path
    ? { url: PLACEHOLDER_ATTACHMENT_URL }
    : null;

  const attachmentsBlock = formatManualAttachmentsBlock(
    manualAttachments,
    pdfAttachment,
  );
  if (attachmentsBlock) {
    evidenceInput.uncategorizedText = evidenceInput.uncategorizedText
      ? `${evidenceInput.uncategorizedText}\n\n${attachmentsBlock}`
      : attachmentsBlock;
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
