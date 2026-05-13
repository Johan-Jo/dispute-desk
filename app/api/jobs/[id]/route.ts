import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";

/**
 * GET /api/jobs/:id
 *
 * Returns job status for UI polling.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const shopId = extractShopId(req);
  if (!shopId || shopId === "demo") {
    return NextResponse.json(
      { error: "Shop context required.", code: "SHOP_CONTEXT_REQUIRED" },
      { status: 401 },
    );
  }
  const db = getServiceClient();

  const { data, error } = await db
    .from("jobs")
    .select("id, shop_id, job_type, entity_id, status, attempts, max_attempts, last_error, created_at, updated_at")
    .eq("id", id)
    .eq("shop_id", shopId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
