import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const search = sp.get("search") ?? "";
  const planFilter = sp.get("plan") ?? "";
  const status = sp.get("status") ?? "";

  const sb = getServiceClient();
  let query = sb.from("shops").select("*").order("created_at", { ascending: false });

  if (search) query = query.ilike("shop_domain", `%${search}%`);
  if (planFilter) query = query.eq("plan", planFilter);
  if (status === "active") query = query.is("uninstalled_at", null);
  if (status === "uninstalled") query = query.not("uninstalled_at", "is", null);

  const { data, error } = await query.limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}
