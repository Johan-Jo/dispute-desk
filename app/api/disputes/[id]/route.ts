import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/disputes/:id
 *
 * Returns a single dispute with all columns + linked evidence packs.
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const sb = getServiceClient();

  const { data: dispute, error } = await sb
    .from("disputes")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !dispute) {
    return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
  }

  const { data: packs } = await sb
    .from("evidence_packs")
    .select(
      "id, status, completeness_score, blockers, recommended_actions, saved_to_shopify_at, created_at, updated_at"
    )
    .eq("dispute_id", id)
    .order("created_at", { ascending: false });

  return NextResponse.json({
    dispute,
    packs: packs ?? [],
  });
}
