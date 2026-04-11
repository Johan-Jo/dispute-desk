/**
 * Fulfillment / shipping evidence source collector.
 *
 * Reads the pre-fetched OrderDetailNode from ctx.order (populated by
 * buildPack.ts) and extracts fulfillment + tracking data.
 * Contributes shipping_tracking and delivery_proof.
 */

import type { OrderFulfillment } from "@/lib/shopify/queries/orders";
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
  ctx: BuildContext,
): Promise<EvidenceSection[]> {
  const order = ctx.order;
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
