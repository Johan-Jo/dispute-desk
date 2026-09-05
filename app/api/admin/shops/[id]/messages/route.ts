/**
 * Admin CRUD for targeted merchant messages.
 *
 * GET  /api/admin/shops/[id]/messages — all messages for the shop
 * POST /api/admin/shops/[id]/messages — create one
 *
 * Middleware already gates /api/admin/*; the explicit hasAdminSession()
 * check is the same defence-in-depth the other admin routes use.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { hasAdminSession, getAdminSessionUser } from "@/lib/admin/auth";
import { mapMerchantMessageRow } from "@/lib/merchantMessages/types";

export const runtime = "nodejs";

const TONES = new Set(["info", "success", "warning", "critical"]);
const STATUSES = new Set(["draft", "published", "archived"]);

const MAX_TITLE = 200;
const MAX_BODY = 4000;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("merchant_messages")
    .select("*")
    .eq("shop_id", id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ messages: (data ?? []).map(mapMerchantMessageRow) });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  let body: {
    title?: string;
    body?: string;
    askForContact?: boolean;
    tone?: string;
    status?: string;
    expiresAt?: string | null;
  } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }

  const title = (body.title ?? "").trim().slice(0, MAX_TITLE);
  const text = (body.body ?? "").trim().slice(0, MAX_BODY);
  if (!title || !text) {
    return NextResponse.json(
      { error: "title and body required" },
      { status: 400 },
    );
  }

  const tone = TONES.has(body.tone ?? "") ? body.tone! : "info";
  const status = STATUSES.has(body.status ?? "") ? body.status! : "draft";

  const sb = getServiceClient();

  // Fail early with a clear error rather than letting the FK reject it.
  const { data: shop } = await sb
    .from("shops")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!shop) {
    return NextResponse.json({ error: "shop not found" }, { status: 404 });
  }

  const admin = await getAdminSessionUser();

  const { data, error } = await sb
    .from("merchant_messages")
    .insert({
      shop_id: id,
      title,
      body: text,
      ask_for_contact: body.askForContact !== false,
      tone,
      status,
      expires_at: body.expiresAt || null,
      created_by: admin?.id ?? null,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ message: mapMerchantMessageRow(data) });
}
