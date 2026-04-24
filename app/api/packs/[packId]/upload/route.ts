import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { evaluateCompleteness, MANUAL_UPLOAD_FIELD } from "@/lib/automation/completeness";

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
    return NextResponse.json(
      { error: `Upload failed: ${uploadErr.message}` },
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

  // Recompute completeness so the progress bar updates (include manual uploads as supporting_documents)
  const { data: packRow } = await db
    .from("evidence_packs")
    .select("checklist")
    .eq("id", packId)
    .single();
  const checklist = (packRow?.checklist ?? []) as Array<{ field: string; present?: boolean }>;
  const presentFields = new Set(checklist.filter((c) => c.present).map((c) => c.field));
  presentFields.add(MANUAL_UPLOAD_FIELD);

  let disputeReason: string | null = null;
  if (pack.dispute_id) {
    const { data: dispute } = await db
      .from("disputes")
      .select("reason")
      .eq("id", pack.dispute_id)
      .single();
    disputeReason = dispute?.reason ?? null;
  }
  const result = evaluateCompleteness(disputeReason, presentFields);

  await db
    .from("evidence_packs")
    .update({
      completeness_score: result.score,
      checklist: result.checklist,
      blockers: result.blockers,
      recommended_actions: result.recommended_actions,
      updated_at: new Date().toISOString(),
    })
    .eq("id", packId);

  return NextResponse.json(
    { itemId: item.id, storagePath },
    { status: 201 }
  );
}
