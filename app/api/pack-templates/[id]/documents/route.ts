import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const db = getServiceClient();

  const { data, error } = await db
    .from("pack_template_documents")
    .select("*")
    .eq("template_id", id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ documents: data ?? [] });
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json();
  const { name, fileType, fileSize, required } = body;

  if (!name || !fileType) {
    return NextResponse.json(
      { error: "name and fileType are required" },
      { status: 400 }
    );
  }

  const db = getServiceClient();
  const { data, error } = await db
    .from("pack_template_documents")
    .insert({
      template_id: id,
      name,
      file_type: fileType,
      file_size: fileSize ?? null,
      required: required ?? false,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
