import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string; docId: string }> };

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { docId } = await params;
  const db = getServiceClient();

  const { error } = await db
    .from("pack_template_documents")
    .delete()
    .eq("id", docId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
