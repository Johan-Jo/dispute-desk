/**
 * Fulfillment / shipping evidence source collector.
 *
 * Extracts fulfillment and tracking data from the order fetched
 * by the order source. Contributes shipping_tracking and delivery_proof.
 */

import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import {
  ORDER_DETAIL_QUERY,
  type OrderDetailResponse,
  type OrderDetailNode,
  type OrderFulfillment,
} from "@/lib/shopify/queries/orders";
import type { EvidenceSection, BuildContext } from "../types";

function extractTrackingData(fulfillment: OrderFulfillment) {
  return {
    fulfillmentId: fulfillment.id,
    status: fulfillment.status,
    displayStatus: fulfillment.displayStatus,
    createdAt: fulfillment.createdAt,
    deliveredAt: fulfillment.deliveredAt,
    estimatedDeliveryAt: fulfillment.estimatedDeliveryAt,
    tracking: fulfillment.trackingInfo
      .filter((t) => t.number || t.url)
      .map((t) => ({
        number: t.number,
        url: t.url,
        carrier: t.company,
      })),
    items: fulfillment.fulfillmentLineItems.edges.map((e) => ({
      title: e.node.lineItem.title,
      quantity: e.node.quantity,
    })),
  };
}

export async function collectFulfillmentEvidence(
  ctx: BuildContext
): Promise<EvidenceSection[]> {
  if (!ctx.orderGid) return [];

  const res = await requestShopifyGraphQL<OrderDetailResponse>({
    session: { shopDomain: ctx.shopDomain, accessToken: ctx.accessToken },
    query: ORDER_DETAIL_QUERY,
    variables: { id: ctx.orderGid },
    correlationId: ctx.correlationId,
  });

  const order = res.data?.node as OrderDetailNode | undefined;
  if (!order?.fulfillments?.length) return [];

  const fieldsProvided: string[] = [];
  const hasTracking = order.fulfillments.some((f) =>
    f.trackingInfo.some((t) => t.number || t.url)
  );
  if (hasTracking) fieldsProvided.push("shipping_tracking");

  const hasDelivery = order.fulfillments.some(
    (f) =>
      f.deliveredAt ||
      f.status === "SUCCESS" ||
      f.displayStatus === "DELIVERED"
  );
  if (hasDelivery) fieldsProvided.push("delivery_proof");

  return [
    {
      type: "shipping",
      label: `Fulfillments (${order.fulfillments.length})`,
      source: "shopify_fulfillments",
      fieldsProvided,
      data: {
        fulfillmentCount: order.fulfillments.length,
        overallStatus: order.displayFulfillmentStatus,
        fulfillments: order.fulfillments.map(extractTrackingData),
      },
    },
  ];
}
