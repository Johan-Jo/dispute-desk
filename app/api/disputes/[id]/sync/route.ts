import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import {
  DISPUTE_DETAIL_QUERY,
  type DisputeDetailResponse,
} from "@/lib/shopify/queries/disputes";
import { deserializeEncrypted, decrypt } from "@/lib/security/encryption";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function decryptAccessToken(encryptedToken: string): string {
  try {
    const payload = deserializeEncrypted(encryptedToken);
    return decrypt(payload);
  } catch {
    return encryptedToken;
  }
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

  const { data: shop } = await sb
    .from("shops")
    .select("shop_domain")
    .eq("id", dispute.shop_id)
    .single();

  const { data: session } = await sb
    .from("shop_sessions")
    .select("access_token_encrypted, shop_domain")
    .eq("shop_id", dispute.shop_id)
    .eq("session_type", "offline")
    .single();

  if (!shop || !session) {
    return NextResponse.json(
      { error: "Shop or session not found" },
      { status: 404 }
    );
  }

  const accessToken = decryptAccessToken(session.access_token_encrypted);

  const gqlResult = await requestShopifyGraphQL<DisputeDetailResponse>({
    session: { shopDomain: shop.shop_domain, accessToken },
    query: DISPUTE_DETAIL_QUERY,
    variables: { id: dispute.dispute_gid },
    correlationId: `single-sync-${id}`,
  });

  const node = gqlResult.data?.node;
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
      dispute_evidence_gid: node.evidence?.id ?? null,
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
