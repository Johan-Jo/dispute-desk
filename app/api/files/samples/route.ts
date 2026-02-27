import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { logSetupEvent } from "@/lib/setup/events";
import { randomUUID } from "crypto";

const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/jpg",
];
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const BUCKET = "evidence-samples";

/**
 * GET /api/files/samples — list sample files for a shop
 */
export async function GET(req: NextRequest) {
  const shopId = req.headers.get("x-shop-id");
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("evidence_files")
    .select("*")
    .eq("shop_id", shopId)
    .eq("kind", "sample")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ files: data ?? [] });
}

/**
 * POST /api/files/samples — upload a sample file (server-side upload)
 * Expects multipart/form-data with a `file` field.
 */
export async function POST(req: NextRequest) {
  const shopId = req.headers.get("x-shop-id");
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: `File type ${file.type} not allowed. Use PDF, JPG, or PNG.` },
      { status: 400 }
    );
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: "File too large. Maximum 10 MB." },
      { status: 400 }
    );
  }

  const uuid = randomUUID();
  const storagePath = `${shopId}/samples/${uuid}-${file.name}`;

  const sb = getServiceClient();

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await sb.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json(
      { error: `Upload failed: ${uploadError.message}` },
      { status: 500 }
    );
  }

  const { data: row, error: dbError } = await sb
    .from("evidence_files")
    .insert({
      shop_id: shopId,
      storage_path: storagePath,
      filename: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      kind: "sample",
    })
    .select()
    .single();

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  await logSetupEvent(shopId, "sample_file_uploaded", {
    fileId: row.id,
    filename: file.name,
    size: file.size,
  });

  return NextResponse.json({ ok: true, file: row });
}
