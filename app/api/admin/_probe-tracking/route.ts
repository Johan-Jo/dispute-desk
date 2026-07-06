import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { getServiceClient } from "@/lib/supabase/server";
import { getShopBackgroundSession } from "@/lib/shopify/sessions/getShopBackgroundSession";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * TEMPORARY read-only diagnostic — DELETE AFTER USE.
 *
 * GET /api/admin/_probe-tracking?shop_id=<uuid>&first=<n>
 *
 * Dumps, for a sample of recently-fulfilled orders, EVERY order- and
 * fulfillment-level metafield namespace/key AND the native Shopify
 * fulfillment fields (deliveredAt, events with status/happenedAt).
 * Purpose: discover where a merchant's carrier app (e.g. PostNord)
 * writes delivery-confirmation + signature data, so we can wire the
 * Insights delivery KPIs to read it. No writes.
 */

const PROBE_QUERY = /* GraphQL */ `
  query ProbeTracking($first: Int!, $query: String) {
    orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          name
          displayFulfillmentStatus
          metafields(first: 25) {
            edges { node { namespace key value type } }
          }
          # NOTE: Fulfillment.metafields is NOT in the Admin GraphQL schema
          # (verified 2026-01, see ordersForBackfill.ts) — querying it fails
          # the whole request. Fulfillment tracking/delivery data comes from
          # native fields (deliveredAt, events) below; app metafields live at
          # the ORDER level above.
          fulfillments(first: 5) {
            id
            status
            displayStatus
            deliveredAt
            estimatedDeliveryAt
            trackingInfo(first: 5) { company number url }
            events(first: 30, sortKey: HAPPENED_AT, reverse: true) {
              edges { node { status happenedAt message } }
            }
          }
        }
      }
    }
  }
`;

interface ProbeMetafield {
  node: { namespace: string; key: string; value: string; type: string | null };
}
interface ProbeFulfillment {
  id: string;
  status: string | null;
  displayStatus: string | null;
  deliveredAt: string | null;
  estimatedDeliveryAt: string | null;
  trackingInfo: Array<{ company: string | null; number: string | null; url: string | null }>;
  events: { edges: Array<{ node: { status: string | null; happenedAt: string | null; message: string | null } }> };
}
interface ProbeOrder {
  id: string;
  name: string | null;
  displayFulfillmentStatus: string | null;
  metafields: { edges: ProbeMetafield[] } | null;
  fulfillments: ProbeFulfillment[] | null;
}

export async function GET(req: NextRequest) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shopId = req.nextUrl.searchParams.get("shop_id");
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }
  const first = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("first") ?? "8"), 1),
    25,
  );

  const sb = getServiceClient();
  const { data: shop } = await sb
    .from("shops")
    .select("shop_domain")
    .eq("id", shopId)
    .single();

  const session = await getShopBackgroundSession(shopId);

  const resp = await requestShopifyGraphQL<{ orders: { edges: Array<{ node: ProbeOrder }> } }>({
    session: { shopDomain: session.shopDomain, accessToken: session.accessToken },
    query: PROBE_QUERY,
    variables: { first, query: "fulfillment_status:fulfilled" },
    correlationId: "probe-tracking",
    locale: "en",
  });

  const orderNamespaces = new Set<string>();
  const eventStatuses = new Set<string>();
  let anyNativeDeliveredAt = false;
  let anySignatureLikeMetafield = false;

  const orders = (resp.data?.orders.edges ?? []).map((e) => {
    const o = e.node;
    const orderMfs = (o.metafields?.edges ?? []).map((m) => {
      orderNamespaces.add(m.node.namespace);
      if (/sign/i.test(m.node.key) || /sign/i.test(m.node.value ?? "")) {
        anySignatureLikeMetafield = true;
      }
      return `${m.node.namespace}.${m.node.key} [${m.node.type}] = ${String(m.node.value ?? "").slice(0, 120)}`;
    });
    const fulfillments = (o.fulfillments ?? []).map((f) => {
      if (f.deliveredAt) anyNativeDeliveredAt = true;
      const events = (f.events?.edges ?? []).map((ev) => {
        if (ev.node.status) eventStatuses.add(ev.node.status);
        // Signature capture, when a carrier reports it, shows up in the
        // native event message/status. Flag anything sign-related.
        if (/sign/i.test(ev.node.status ?? "") || /sign/i.test(ev.node.message ?? "")) {
          anySignatureLikeMetafield = true;
        }
        return { status: ev.node.status, happenedAt: ev.node.happenedAt, message: ev.node.message };
      });
      return {
        displayStatus: f.displayStatus,
        status: f.status,
        deliveredAt: f.deliveredAt,
        estimatedDeliveryAt: f.estimatedDeliveryAt,
        trackingInfo: f.trackingInfo,
        events,
      };
    });
    return {
      name: o.name,
      displayFulfillmentStatus: o.displayFulfillmentStatus,
      orderMetafields: orderMfs,
      fulfillments,
    };
  });

  return NextResponse.json({
    shop: shop?.shop_domain ?? null,
    sampled: orders.length,
    summary: {
      orderMetafieldNamespaces: [...orderNamespaces].sort(),
      nativeFulfillmentEventStatuses: [...eventStatuses].sort(),
      anyNativeDeliveredAt,
      anySignatureLikeSignal: anySignatureLikeMetafield,
    },
    orders,
  });
}
