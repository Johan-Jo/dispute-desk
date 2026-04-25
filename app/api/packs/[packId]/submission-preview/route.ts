import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { FIELD_MAPPINGS, type RawPackSection } from "@/lib/shopify/fieldMapping";
import { composeShopifyMutationPayload } from "@/lib/shopify/composeShopifyMutationPayload";
import {
  type ManualAttachmentInput,
  type PackPdfInput,
} from "@/lib/shopify/manualAttachments";
import {
  loadChecklistFieldByEvidenceItemIdFromAudit,
  resolveChecklistFieldForManualItem,
} from "@/lib/shopify/manualUploadChecklistFromAudit";

export const runtime = "nodejs";

// Placeholder shown in the preview where the save-to-shopify job will later
// substitute a real HMAC-signed DisputeDesk URL. Keeping the tokens out of the
// preview avoids leaking 180-day credentials through an authenticated UI
// endpoint — the merchant only needs to see that links will be emitted.
const PLACEHOLDER_ATTACHMENT_URL = "https://disputedesk.app/e/<secure-link>";

/**
 * GET /api/packs/:packId/submission-preview[?format=raw]
 *
 * Returns the merchant-facing preview of what will be sent to Shopify.
 * Uses `composeShopifyMutationPayload` — the same builder the submit
 * job (`saveToShopifyJob`) calls — so given the same inputs, both
 * produce byte-equivalent payloads.
 *
 * Default response: `{ fields: SubmissionField[] }` (mapped from the
 * mutation payload via FIELD_MAPPINGS).
 *
 * `?format=raw`: includes `mutationPayload` — the actual
 * `disputeEvidenceUpdate.input` GraphQL variable. The only intentional
 * difference vs the submit job is the URL token in
 * manualAttachments / PDF — placeholder here, real short-link there
 * (caller-supplied input, not a transformation inside the builder).
 * Plan v3 §3.A.2.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ packId: string }> },
) {
  const { packId } = await params;
  const format = req.nextUrl.searchParams.get("format");
  const sb = getServiceClient();

  const { data: pack, error } = await sb
    .from("evidence_packs")
    .select("id, pack_json, pdf_path, dispute_id")
    .eq("id", packId)
    .single();

  if (error || !pack) {
    return NextResponse.json({ error: "Pack not found" }, { status: 404 });
  }

  // Customer info + reason — fetched in one round-trip so the preview
  // mirrors saveToShopifyJob's payload composition exactly.
  const { data: disputeRow } = await sb
    .from("disputes")
    .select("reason, customer_display_name, customer_email")
    .eq("id", pack.dispute_id)
    .maybeSingle();
  const disputeReason: string | null = disputeRow?.reason ?? null;

  const packJson = pack.pack_json as {
    sections?: Array<{
      type: string;
      label: string;
      source: string;
      data: Record<string, unknown>;
    }>;
  } | null;

  if (!packJson?.sections) {
    return format === "raw"
      ? NextResponse.json({ fields: [], mutationPayload: {} })
      : NextResponse.json({ fields: [] });
  }

  // Convert to RawPackSection format (include fieldsProvided for IP / device gates)
  const rawSections: RawPackSection[] = packJson.sections.map((s) => {
    const rec = s as Record<string, unknown>;
    const fieldsProvided = rec.fieldsProvided;
    return {
      type: s.type,
      label: s.label,
      source: s.source,
      data: s.data,
      ...(Array.isArray(fieldsProvided)
        ? { fieldsProvided: fieldsProvided as string[] }
        : {}),
    };
  });

  const { data: rebuttal } = await sb
    .from("rebuttal_drafts")
    .select("sections")
    .eq("pack_id", packId)
    .eq("locale", "en-US")
    .maybeSingle();

  const rebuttalText = rebuttal?.sections
    ? (rebuttal.sections as Array<{ text: string }>)
        .map((s) => s.text)
        .join("\n\n")
        .trim() || null
    : null;

  // Manual attachments — preview uses placeholder URLs in place of the
  // real short-link tokens that saveToShopifyJob mints. Everything else
  // (label, filename, size, checklistField resolution) matches the job.
  const { data: manualItems } = await sb
    .from("evidence_items")
    .select("id, label, payload, created_at")
    .eq("pack_id", packId)
    .eq("source", "manual_upload")
    .order("created_at", { ascending: false });

  const auditChecklistByItemId =
    await loadChecklistFieldByEvidenceItemIdFromAudit(sb, packId);

  const manualAttachments: ManualAttachmentInput[] = (manualItems ?? []).map(
    (item) => {
      const meta = (item.payload ?? {}) as Record<string, unknown>;
      const checklistField = resolveChecklistFieldForManualItem(
        String(item.id),
        meta,
        auditChecklistByItemId,
      );
      return {
        checklistField,
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

  // Single source of truth — same builder, same input shape, same field
  // omission rules as `saveToShopifyJob`. See plan v3 §3.A.2 and the
  // byte-equivalence test in `lib/shopify/__tests__/composeShopifyMutationPayload.test.ts`.
  const mutationPayload = composeShopifyMutationPayload({
    sections: rawSections,
    rebuttalText,
    disputeReason,
    customer: {
      displayName: disputeRow?.customer_display_name ?? null,
      email: disputeRow?.customer_email ?? null,
    },
    manualAttachments,
    pdfAttachment,
  });

  // Field-by-field structured view derived from the same payload.
  const fields = FIELD_MAPPINGS.map((mapping) => {
    const content = (mutationPayload as Record<string, string | undefined>)[mapping.shopifyField] ?? "";
    return {
      shopifyFieldName: mapping.shopifyField,
      shopifyFieldLabel: mapping.label,
      content,
      contentPreview: content.length > 300 ? content.slice(0, 300) + "..." : content,
      source: "auto",
      included: content.length > 0,
    };
  }).filter((f) => f.included);

  if (format === "raw") {
    return NextResponse.json({ fields, mutationPayload });
  }
  return NextResponse.json({ fields });
}
