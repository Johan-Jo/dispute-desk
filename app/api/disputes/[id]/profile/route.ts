import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import {
  DISPUTE_PROFILE_QUERY,
  type DisputeProfileResponse,
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
 * GET /api/disputes/:id/profile
 *
 * Returns customer and order profile for the dispute by fetching from Shopify.
 * Used by the dispute detail page to show name, contact, and address data.
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
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
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!shop || !session) {
    return NextResponse.json(
      { error: "Shop or session not found" },
      { status: 404 }
    );
  }

  const accessToken = decryptAccessToken(session.access_token_encrypted);

  const gqlResult = await requestShopifyGraphQL<DisputeProfileResponse>({
    session: { shopDomain: shop.shop_domain, accessToken },
    query: DISPUTE_PROFILE_QUERY,
    variables: { id: dispute.dispute_gid },
    correlationId: `dispute-profile-${id}`,
  });

  const node = gqlResult.data?.dispute;
  if (!node) {
    return NextResponse.json(
      { profile: null, error: gqlResult.errors?.[0]?.message ?? "Dispute not found in Shopify" },
      { status: 200 }
    );
  }

  return NextResponse.json({
    profile: node.order
      ? {
          orderName: node.order.name,
          orderId: node.order.legacyResourceId,
          createdAt: node.order.createdAt,
          total: node.order.totalPriceSet?.shopMoney,
          customerName:
            node.order.displayAddress?.name?.trim() ||
            node.order.shippingAddress?.name?.trim() ||
            node.order.customer?.displayName?.trim() ||
            null,
          email: node.order.email?.trim() || null,
          phone:
            node.order.phone?.trim() ||
            node.order.displayAddress?.phone?.trim() ||
            node.order.shippingAddress?.phone?.trim() ||
            null,
          displayAddress: node.order.displayAddress,
          shippingAddress: node.order.shippingAddress,
          billingAddress: node.order.billingAddress,
          fulfillments: node.order.fulfillments ?? [],
        }
      : null,
  });
}
