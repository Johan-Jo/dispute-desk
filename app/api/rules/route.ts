import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/rules?shop_id=...
 * List all rules for a shop, ordered by priority.
 */
export async function GET(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get("shop_id");
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("rules")
    .select("*")
    .eq("shop_id", shopId)
    .order("priority", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

/**
 * POST /api/rules
 * Create a new rule.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { shop_id, name, match, action, enabled, priority } = body;

  if (!shop_id) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("rules")
    .insert({
      shop_id,
      name: name ?? null,
      match: match ?? {},
      action: action ?? { mode: "review" },
      enabled: enabled ?? true,
      priority: priority ?? 0,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
