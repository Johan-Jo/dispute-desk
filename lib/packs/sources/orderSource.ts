/**
 * Order evidence source collector.
 *
 * Fetches order details from Shopify and extracts:
 * - Line items, amounts, discounts, refunds
 * - Billing/shipping addresses (city-level only, no street for PII)
 * - Customer tenure info
 */

import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import {
  ORDER_DETAIL_QUERY,
  type OrderDetailResponse,
  type OrderDetailNode,
} from "@/lib/shopify/queries/orders";
import type { EvidenceSection, BuildContext } from "../types";

function redactAddress(addr: { city: string; provinceCode: string; countryCode: string; zip: string } | null) {
  if (!addr) return null;
  return {
    city: addr.city,
    provinceCode: addr.provinceCode,
    countryCode: addr.countryCode,
    zipPrefix: addr.zip?.slice(0, 3) ?? null,
  };
}

export async function collectOrderEvidence(
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
  if (!order) return [];

  const lineItems = order.lineItems.edges.map((e) => ({
    title: e.node.title,
    variant: e.node.variantTitle,
    quantity: e.node.quantity,
    total: e.node.originalTotalSet.shopMoney.amount,
    currency: e.node.originalTotalSet.shopMoney.currencyCode,
    sku: e.node.sku,
  }));

  const fieldsProvided: string[] = ["order_confirmation"];

  const billingRedacted = redactAddress(order.billingAddress);
  const shippingRedacted = redactAddress(order.shippingAddress);

  if (billingRedacted && shippingRedacted) {
    const match =
      billingRedacted.city === shippingRedacted.city &&
      billingRedacted.countryCode === shippingRedacted.countryCode;
    if (match) fieldsProvided.push("billing_address_match");
  }

  const sections: EvidenceSection[] = [
    {
      type: "order",
      label: `Order ${order.name}`,
      source: "shopify_order",
      fieldsProvided,
      data: {
        orderId: order.id,
        orderName: order.name,
        createdAt: order.createdAt,
        financialStatus: order.displayFinancialStatus,
        fulfillmentStatus: order.displayFulfillmentStatus,
        lineItems,
        totals: {
          subtotal: order.subtotalPriceSet.shopMoney.amount,
          shipping: order.totalShippingPriceSet.shopMoney.amount,
          tax: order.totalTaxSet.shopMoney.amount,
          discounts: order.totalDiscountsSet.shopMoney.amount,
          total: order.totalPriceSet.shopMoney.amount,
          refunded: order.totalRefundedSet.shopMoney.amount,
          currency: order.totalPriceSet.shopMoney.currencyCode,
        },
        billingAddress: billingRedacted,
        shippingAddress: shippingRedacted,
        customerTenure: order.customer
          ? {
              totalOrders: order.customer.numberOfOrders,
              customerSince: order.customer.createdAt,
            }
          : null,
        cancelledAt: order.cancelledAt,
      },
    },
  ];

  if (order.refunds.length > 0) {
    sections.push({
      type: "order",
      label: "Refund History",
      source: "shopify_order",
      fieldsProvided: [],
      data: {
        refunds: order.refunds.map((r) => ({
          id: r.id,
          createdAt: r.createdAt,
          note: r.note,
          amount: r.totalRefundedSet.shopMoney.amount,
          currency: r.totalRefundedSet.shopMoney.currencyCode,
        })),
      },
    });
  }

  return sections;
}
