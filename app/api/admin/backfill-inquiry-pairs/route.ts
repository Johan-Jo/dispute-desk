import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { backfillInquiryPairs } from "@/lib/backfill/inquiryPairs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin/backfill-inquiry-pairs
 * Body (optional): { shop_id?: string }
 *
 * Installs missing inquiry-sibling packs and rewrites phase-paired automation
 * rules. With no shop_id, runs across every shop.
 */
export async function POST(req: NextRequest) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { shop_id?: string } = {};
  try {
    body = (await req.json()) as { shop_id?: string };
  } catch {
    // empty body is fine
  }

  try {
    const summary = await backfillInquiryPairs(body.shop_id);
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Backfill failed" },
      { status: 500 },
    );
  }
}
