import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
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

  const { data: pack } = await db
    .from("evidence_packs")
    .select("id, shop_id, dispute_id")
    .eq("id", packId)
    .single();

  if (!pack) {
    return NextResponse.json({ error: "Pack not found" }, { status: 404 });
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
  const storagePath = `evidence-uploads/${pack.shop_id}/${packId}/${Date.now()}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadErr } = await db.storage
    .from("evidence-uploads")
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

  return NextResponse.json(
    { itemId: item.id, storagePath },
    { status: 201 }
  );
}
