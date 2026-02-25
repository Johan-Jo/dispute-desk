import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const shopId = sp.get("shop_id") ?? "";
  const eventType = sp.get("event_type") ?? "";
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const format = sp.get("format") ?? "json";

  const sb = getServiceClient();
  let query = sb
    .from("audit_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  if (shopId) query = query.eq("shop_id", shopId);
  if (eventType) query = query.eq("event_type", eventType);
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (format === "csv") {
    const rows = data ?? [];
    const header = "id,shop_id,event_type,actor_type,created_at,event_payload";
    const csv = [
      header,
      ...rows.map((r: Record<string, unknown>) =>
        [r.id, r.shop_id, r.event_type, r.actor_type, r.created_at, JSON.stringify(r.event_payload)].join(",")
      ),
    ].join("\n");
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=audit.csv" } });
  }

  return NextResponse.json(data);
}
