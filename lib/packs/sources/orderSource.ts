/**
 * Order evidence source collector.
 *
 * Reads the pre-fetched OrderDetailNode from ctx.order (populated by
 * buildPack.ts once per build) and extracts:
 * - Line items, amounts, discounts, refunds
 * - Billing/shipping addresses (city-level only, no street for PII)
 * - Customer tenure info
 *
 * Before commit 1ab166e the three order-dependent collectors each
 * issued their own ORDER_DETAIL_QUERY. The fetch is now centralized
 * in buildPack.ts.
 */

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
  ctx: BuildContext,
): Promise<EvidenceSection[]> {
  const order = ctx.order;
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

  // Activity log: customer tenure + order timeline.
  // Maps to Shopify's accessActivityLog field and satisfies the
  // "activity_log" completeness field.
  if (order.customer || order.events?.edges?.length) {
    const timelineEvents = (order.events?.edges ?? []).map((e) => ({
      message: e.node.message,
      createdAt: e.node.createdAt,
    }));

    sections.push({
      type: "access_log",
      label: "Customer activity log",
      source: "shopify_order",
      fieldsProvided: ["activity_log"],
      data: {
        customerTenure: order.customer
          ? {
              totalOrders: order.customer.numberOfOrders,
              customerSince: order.customer.createdAt,
              customerNote: order.customer.note,
            }
          : null,
        timelineEvents: timelineEvents.slice(0, 20),
        timelineEventCount: timelineEvents.length,
      },
    });
  }

  // Customer account info: standalone section that satisfies the
  // `customer_account_info` template requirement. Distinct from
  // `customer_communication` (timeline messages) and `activity_log`
  // (combined tenure + timeline) — this section isolates the account
  // profile so the merchant sees order history and account age as
  // their own fraud-defense signal, not a side-note buried under
  // timeline events.
  if (order.customer) {
    const totalOrders = Number(order.customer.numberOfOrders ?? 0);
    sections.push({
      type: "other",
      label: "Customer account details",
      source: "shopify_order",
      fieldsProvided: ["customer_account_info"],
      data: {
        totalOrders: Number.isFinite(totalOrders) ? totalOrders : 0,
        customerSince: order.customer.createdAt,
        customerNote: order.customer.note,
        isRepeatCustomer: totalOrders > 1,
      },
    });
  }

  return sections;
}
