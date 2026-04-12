import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

/**
 * GET /api/feedback/eligibility
 *
 * Returns whether the merchant is eligible to see the feedback/rating banner.
 * Criteria: shop has at least one won dispute (first_win_at is set).
 */
export async function GET(req: NextRequest) {
  const shopId = req.headers.get("x-shop-id");
  if (!shopId) {
    return NextResponse.json({ eligible: false });
  }

  const sb = getServiceClient();
  const { data } = await sb
    .from("shops")
    .select("first_win_at")
    .eq("id", shopId)
    .single();

  return NextResponse.json({
    eligible: Boolean(data?.first_win_at),
    firstWinAt: data?.first_win_at ?? null,
  });
}
