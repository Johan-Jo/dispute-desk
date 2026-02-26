import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const db = getServiceClient();

  const { data: source, error: srcErr } = await db
    .from("pack_templates")
    .select("*, pack_template_documents(*)")
    .eq("id", id)
    .single();

  if (srcErr || !source) {
    return NextResponse.json({ error: "Source template not found" }, { status: 404 });
  }

  const { data: copy, error: copyErr } = await db
    .from("pack_templates")
    .insert({
      shop_id: source.shop_id,
      name: `${source.name} (Copy)`,
      dispute_type: source.dispute_type,
      description: source.description,
      status: "draft",
    })
    .select("*")
    .single();

  if (copyErr || !copy) {
    return NextResponse.json({ error: copyErr?.message ?? "Failed" }, { status: 500 });
  }

  if (source.pack_template_documents?.length) {
    const docs = source.pack_template_documents.map(
      (d: { name: string; file_type: string; file_size: string; required: boolean; storage_path: string }) => ({
        template_id: copy.id,
        name: d.name,
        file_type: d.file_type,
        file_size: d.file_size,
        required: d.required,
        storage_path: d.storage_path,
      })
    );
    await db.from("pack_template_documents").insert(docs);
  }

  return NextResponse.json(copy, { status: 201 });
}
