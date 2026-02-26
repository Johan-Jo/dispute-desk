import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const shopId = searchParams.get("shopId");
  if (!shopId) {
    return NextResponse.json({ error: "shopId required" }, { status: 400 });
  }

  const db = getServiceClient();
  let query = db
    .from("pack_templates")
    .select("*, pack_template_documents(id)")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false });

  const status = searchParams.get("status");
  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  const search = searchParams.get("q");
  if (search) {
    query = query.or(`name.ilike.%${search}%,dispute_type.ilike.%${search}%`);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const templates = (data ?? []).map((t) => ({
    ...t,
    documents_count: t.pack_template_documents?.length ?? 0,
    pack_template_documents: undefined,
  }));

  return NextResponse.json({ templates });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { shopId, name, disputeType, description } = body;

  if (!shopId || !name || !disputeType) {
    return NextResponse.json(
      { error: "shopId, name, and disputeType are required" },
      { status: 400 }
    );
  }

  const db = getServiceClient();
  const { data, error } = await db
    .from("pack_templates")
    .insert({
      shop_id: shopId,
      name,
      dispute_type: disputeType,
      description: description ?? null,
      status: "draft",
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
