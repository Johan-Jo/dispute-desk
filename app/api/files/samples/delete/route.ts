import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

const BUCKET = "evidence-samples";

export async function POST(req: NextRequest) {
  const shopId = req.headers.get("x-shop-id");
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const body = await req.json();
  const fileId = body.fileId as string;

  if (!fileId) {
    return NextResponse.json({ error: "fileId required" }, { status: 400 });
  }

  const sb = getServiceClient();

  const { data: file } = await sb
    .from("evidence_files")
    .select("id, storage_path")
    .eq("id", fileId)
    .eq("shop_id", shopId)
    .single();

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  await sb.storage.from(BUCKET).remove([file.storage_path]);
  await sb.from("evidence_files").delete().eq("id", file.id);

  return NextResponse.json({ ok: true });
}
