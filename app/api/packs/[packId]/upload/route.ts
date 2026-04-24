import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import {
  evaluateCompletenessV2,
  MANUAL_UPLOAD_FIELD,
} from "@/lib/automation/completeness";
import type { WaivedItemRecord } from "@/lib/types/evidenceItem";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
/** Same bucket as pack PDFs (`renderPdfJob`); `evidence-uploads` is not provisioned in migrations and may 400 in prod. */
const MANUAL_UPLOAD_STORAGE_BUCKET = "evidence-packs";
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
]);

/**
 * Map a Supabase Storage error to merchant-safe copy. Supabase returns
 * 400 for two distinct reasons here:
 *   - `allowed_mime_types` blocks the file type (dashboard-configured
 *     restriction, not something the merchant can fix).
 *   - `file_size_limit` is below the API's 10 MB cap.
 * Anything else falls through to a generic message; the raw text is
 * still logged server-side for support.
 */
function merchantUploadMessage(err: { message?: string }, fileType: string): string {
  const raw = (err?.message ?? "").toLowerCase();
  if (raw.includes("mime type") || raw.includes("invalid_mime_type")) {
    return `This Shopify store hasn't allowed ${fileType || "this file type"} uploads in evidence storage yet. Contact DisputeDesk support — it's a one-time setting.`;
  }
  if (raw.includes("exceeded the maximum allowed size") || raw.includes("payload too large")) {
    return "This file is larger than your storage limit allows. Try a file under 10 MB or contact support.";
  }
  if (raw.includes("duplicate") || raw.includes("already exists")) {
    return "A file with this name already exists for this pack. Rename it and try again.";
  }
  return "We couldn't save this file to evidence storage. Please try again, or contact support if it keeps failing.";
}

/**
 * POST /api/packs/:packId/upload
 *
 * Upload a file as manual evidence for a pack.
 * Stores in Supabase Storage and creates an evidence_items row.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ packId: string }> }
) {
  const { packId } = await params;
  const db = getServiceClient();

  let pack: { id: string; shop_id: string; dispute_id: string | null } | null = (
    await db
      .from("evidence_packs")
      .select("id, shop_id, dispute_id")
      .eq("id", packId)
      .single()
  ).data;

  // Library pack (template-installed): may exist only in packs table. Lazy-create evidence_packs row so uploads work.
  if (!pack) {
    const { data: libraryPack } = await db
      .from("packs")
      .select("id, shop_id")
      .eq("id", packId)
      .single();
    if (!libraryPack) {
      return NextResponse.json({ error: "Pack not found" }, { status: 404 });
    }
    const { error: insertErr } = await db.from("evidence_packs").insert({
      id: libraryPack.id,
      shop_id: libraryPack.shop_id,
      dispute_id: null,
      status: "draft",
    });
    if (insertErr) {
      return NextResponse.json(
        { error: `Could not enable uploads for this pack: ${insertErr.message}` },
        { status: 500 }
      );
    }
    pack = {
      id: libraryPack.id,
      shop_id: libraryPack.shop_id,
      dispute_id: null,
    };
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const label = (formData.get("label") as string) || "Manual upload";
  const fieldRaw = formData.get("field");
  // The dispute workspace attaches `field` so the server can mark that specific
  // checklist row (e.g. `shipping_tracking`) as satisfied. Other callers (library
  // pack uploads) omit it — those still count as a generic supporting document.
  const uploadedField: string | null =
    typeof fieldRaw === "string" && fieldRaw.trim().length > 0
      ? fieldRaw.trim()
      : null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large. Max ${MAX_FILE_SIZE / 1024 / 1024} MB` },
      { status: 400 }
    );
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `File type '${file.type}' not allowed` },
      { status: 400 }
    );
  }

  const ext = file.name.split(".").pop() ?? "bin";
  const storagePath = `${pack.shop_id}/${packId}/manual-${Date.now()}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadErr } = await db.storage
    .from(MANUAL_UPLOAD_STORAGE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadErr) {
    // Surface the real Supabase error in server logs so we can diagnose bucket/policy
    // issues without asking merchants to retry blindly.
    console.error("[packs/upload] storage upload failed", {
      bucket: MANUAL_UPLOAD_STORAGE_BUCKET,
      storagePath,
      shopId: pack.shop_id,
      packId,
      fileType: file.type,
      fileSize: file.size,
      errorMessage: uploadErr.message,
      errorName: uploadErr.name,
    });
    return NextResponse.json(
      { error: merchantUploadMessage(uploadErr, file.type) },
      { status: 500 }
    );
  }

  const { data: item, error: itemErr } = await db
    .from("evidence_items")
    .insert({
      pack_id: packId,
      type: "other",
      label,
      source: "manual_upload",
      payload: {
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        storagePath,
        storageBucket: MANUAL_UPLOAD_STORAGE_BUCKET,
      },
    })
    .select("id")
    .single();

  if (itemErr) {
    return NextResponse.json(
      { error: `Failed to record item: ${itemErr.message}` },
      { status: 500 }
    );
  }

  await logAuditEvent({
    shopId: pack.shop_id,
    disputeId: pack.dispute_id,
    packId,
    actorType: "merchant",
    eventType: "item_added",
    eventPayload: {
      type: "manual_upload",
      label,
      fileName: file.name,
      fileSize: file.size,
    },
  });

  // Recompute completeness so the UI (v2 checklist) reflects the upload.
  // The workspace reads `checklist_v2` — updating only the legacy `checklist`
  // caused uploaded rows to flicker "Included" (optimistic local state) then
  // revert to "Missing" once the next poll overwrote the local overlay.
  const { data: packRow } = await db
    .from("evidence_packs")
    .select("checklist, waived_items")
    .eq("id", packId)
    .single();
  const checklist = (packRow?.checklist ?? []) as Array<{ field: string; present?: boolean }>;
  const waivedItems = (packRow?.waived_items ?? []) as WaivedItemRecord[];
  const presentFields = new Set(
    checklist.filter((c) => c.present).map((c) => c.field),
  );
  // Always count manual uploads as satisfying the generic "supporting documents"
  // row, plus the specific checklist field the merchant was uploading for.
  presentFields.add(MANUAL_UPLOAD_FIELD);
  if (uploadedField) presentFields.add(uploadedField);

  let disputeReason: string | null = null;
  if (pack.dispute_id) {
    const { data: dispute } = await db
      .from("disputes")
      .select("reason")
      .eq("id", pack.dispute_id)
      .single();
    disputeReason = dispute?.reason ?? null;
  }
  const result = evaluateCompletenessV2(
    disputeReason,
    presentFields,
    waivedItems,
    null,
  );

  await db
    .from("evidence_packs")
    .update({
      completeness_score: result.completenessScore,
      checklist: result.legacyChecklist,
      checklist_v2: result.checklist,
      blockers: result.legacyBlockers,
      recommended_actions: result.legacyRecommendedActions,
      submission_readiness: result.submissionReadiness,
      updated_at: new Date().toISOString(),
    })
    .eq("id", packId);

  return NextResponse.json(
    { itemId: item.id, storagePath },
    { status: 201 }
  );
}
