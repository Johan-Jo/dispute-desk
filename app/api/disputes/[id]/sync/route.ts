import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { makeAuthedRequest } from "@/lib/shopify/makeAuthedRequest";
import { NoBackgroundSessionError } from "@/lib/shopify/sessions/getShopBackgroundSession";
import {
  DISPUTE_DETAIL_QUERY,
  type DisputeDetailResponse,
} from "@/lib/shopify/queries/disputes";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/disputes/:id/sync
 *
 * Re-fetch a single dispute from Shopify and upsert into the local DB.
 */
export async function POST(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const sb = getServiceClient();

  const { data: dispute, error: dErr } = await sb
    .from("disputes")
    .select("id, shop_id, dispute_gid")
    .eq("id", id)
    .single();

  if (dErr || !dispute) {
    return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
  }

  let gqlResult;
  try {
    gqlResult = await makeAuthedRequest<DisputeDetailResponse>({
      shopId: dispute.shop_id,
      query: DISPUTE_DETAIL_QUERY,
      variables: { id: dispute.dispute_gid },
      correlationId: `single-sync-${id}`,
    });
  } catch (err) {
    if (err instanceof NoBackgroundSessionError) {
      return NextResponse.json(
        { error: "Shop or session not found" },
        { status: 404 }
      );
    }
    throw err;
  }

  const node = gqlResult.data?.dispute;
  if (!node) {
    return NextResponse.json(
      { error: "Dispute not found in Shopify" },
      { status: 404 }
    );
  }

  const { error: updateErr } = await sb
    .from("disputes")
    .update({
      status: node.status?.toLowerCase() ?? null,
      reason: node.reasonDetails?.reason ?? null,
      amount: node.amount ? parseFloat(node.amount.amount) : null,
      currency_code: node.amount?.currencyCode ?? null,
      dispute_evidence_gid: node.disputeEvidence?.id ?? null,
      initiated_at: node.initiatedAt,
      due_at: node.evidenceDueBy,
      last_synced_at: new Date().toISOString(),
      raw_snapshot: {
        id: node.id,
        status: node.status,
        reasonDetails: node.reasonDetails,
        amount: node.amount,
        initiatedAt: node.initiatedAt,
        evidenceDueBy: node.evidenceDueBy,
        order: node.order
          ? {
              id: node.order.id,
              legacyResourceId: node.order.legacyResourceId,
              name: node.order.name,
            }
          : null,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  await sb.from("audit_events").insert({
    shop_id: dispute.shop_id,
    dispute_id: id,
    actor_type: "merchant",
    event_type: "disputes_synced",
    event_payload: { single: true, dispute_gid: dispute.dispute_gid },
  });

  return NextResponse.json({ synced: true, disputeId: id });
}
