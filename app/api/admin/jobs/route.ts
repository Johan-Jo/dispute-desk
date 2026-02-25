import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const statusFilter = sp.get("status") ?? "";
  const shopFilter = sp.get("shop_id") ?? "";

  const sb = getServiceClient();
  let query = sb
    .from("jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (statusFilter) query = query.eq("status", statusFilter);
  if (shopFilter) query = query.eq("shop_id", shopFilter);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = Date.now();
  const enriched = (data ?? []).map((j: Record<string, unknown>) => ({
    ...j,
    stale:
      j.status === "running" &&
      j.locked_at &&
      now - new Date(j.locked_at as string).getTime() > 10 * 60 * 1000,
  }));

  return NextResponse.json(enriched);
}
