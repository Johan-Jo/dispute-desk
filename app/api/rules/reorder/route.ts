import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/rules/reorder
 * Body: { ordered_ids: string[] }
 * Sets priority = index for each rule ID in the given order.
 */
export async function POST(req: NextRequest) {
  const { ordered_ids } = await req.json();

  if (!Array.isArray(ordered_ids) || ordered_ids.length === 0) {
    return NextResponse.json(
      { error: "ordered_ids must be a non-empty array" },
      { status: 400 }
    );
  }

  const sb = getServiceClient();

  for (let i = 0; i < ordered_ids.length; i++) {
    await sb
      .from("rules")
      .update({ priority: i, updated_at: new Date().toISOString() })
      .eq("id", ordered_ids[i]);
  }

  return NextResponse.json({ reordered: ordered_ids.length });
}
