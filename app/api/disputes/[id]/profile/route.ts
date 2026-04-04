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
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const locale = req.nextUrl.searchParams.get("locale") ?? undefined;
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
    locale,
  });

  const node = gqlResult.data?.dispute;
  if (!node) {
    return NextResponse.json(
      { profile: null, error: gqlResult.errors?.[0]?.message ?? "Dispute not found in Shopify" },
      { status: 200 }
    );
  }

  const ev = node.disputeEvidence;

  return NextResponse.json({
    profile: {
      orderName: node.order?.name ?? null,
      orderId: node.order?.legacyResourceId ?? null,
      createdAt: node.order?.createdAt ?? null,
      total: node.order?.totalPriceSet?.shopMoney ?? null,
      customerName:
        [ev?.customerFirstName, ev?.customerLastName]
          .filter(Boolean).join(" ").trim() ||
        ev?.shippingAddress?.name?.trim() ||
        ev?.billingAddress?.name?.trim() ||
        null,
      email: ev?.customerEmailAddress?.trim() || null,
      phone:
        ev?.shippingAddress?.phone?.trim() ||
        ev?.billingAddress?.phone?.trim() ||
        null,
      shippingAddress: ev?.shippingAddress ?? null,
      billingAddress: ev?.billingAddress ?? null,
      displayAddress: ev?.shippingAddress ?? null,
      fulfillments: node.order?.fulfillments ?? [],
      orderEvents: node.order?.events?.edges.map((e) => e.node) ?? [],
    },
  });
}
