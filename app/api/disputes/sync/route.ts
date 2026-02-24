import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/disputes/sync
 * Body: { shop_id }
 *
 * Enqueues a sync_disputes job for the given shop.
 * Returns 202 with jobId.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const shopId = body.shop_id;

  if (!shopId) {
    return NextResponse.json(
      { error: "shop_id required" },
      { status: 400 }
    );
  }

  const sb = getServiceClient();

  const { data: job, error } = await sb
    .from("jobs")
    .insert({
      shop_id: shopId,
      job_type: "sync_disputes",
      entity_id: shopId,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json(
      { error: `Failed to enqueue sync: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
