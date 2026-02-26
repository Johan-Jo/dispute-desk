import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const db = getServiceClient();

  const { data, error } = await db
    .from("pack_templates")
    .select("*, pack_template_documents(*)")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json();

  const allowed = ["name", "dispute_type", "description", "status"];
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key];
  }

  const db = getServiceClient();
  const { data, error } = await db
    .from("pack_templates")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Not found" }, { status: error ? 500 : 404 });
  }

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const db = getServiceClient();

  const { error } = await db
    .from("pack_templates")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
