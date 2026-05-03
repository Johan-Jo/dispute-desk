import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { makeAuthedRequest } from "@/lib/shopify/makeAuthedRequest";
import { NoBackgroundSessionError } from "@/lib/shopify/sessions/getShopBackgroundSession";
import {
  DISPUTE_PROFILE_QUERY,
  type DisputeProfileResponse,
} from "@/lib/shopify/queries/disputes";

interface RouteParams {
  params: Promise<{ id: string }>;
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

  let gqlResult;
  try {
    gqlResult = await makeAuthedRequest<DisputeProfileResponse>({
      shopId: dispute.shop_id,
      query: DISPUTE_PROFILE_QUERY,
      variables: { id: dispute.dispute_gid },
      correlationId: `dispute-profile-${id}`,
      locale,
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
