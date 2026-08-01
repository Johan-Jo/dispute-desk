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
import { classifyDeliveryEvent } from "@/lib/shopify/deliveryEventClassifier";
import type { OrderDetailNode } from "@/lib/shopify/queries/orders";
import { detectCreditAlreadyIssued } from "@/lib/automation/creditTiming";

/**
 * Extract bank-facing chronology bullets from native carrier fulfillment
 * events (`Fulfillment.events`). These live on a DIFFERENT Shopify
 * connection than `Order.events` (which the timeline is otherwise built
 * from), so delivery milestones — the decisive facts for an item-not-
 * received dispute — never reached the "Chronology of Events" list.
 *
 * We surface only the meaningful transitions (not every carrier scan):
 *   - final delivery to the recipient        → "Carrier confirmed delivery…"
 *   - delivery to a pickup point / locker     → "…delivered to a pickup point…"
 *   - return to sender                        → "…returned to sender…"
 * The classifier already distinguishes these (and correctly treats a
 * pickup/neighbour/returned message as NOT final delivery). Each surfaced
 * event carries its own carrier timestamp so the merge stays chronological.
 */
function fulfillmentChronologyEvents(
  order: OrderDetailNode,
): Array<{ message: string; createdAt: string }> {
  // Keep only the LATEST event of each category across all fulfillments —
  // a carrier log often repeats "in transit"/"returned" scans, and a
  // parcel can be returned then re-delivered. One bullet per meaningful
  // milestone (the last time it occurred) keeps the chronology honest and
  // uncluttered.
  const latest: Partial<Record<
    "delivered" | "collected_at_pickup" | "delivered_to_pickup" | "returned",
    string
  >> = {};
  for (const f of order.fulfillments ?? []) {
    for (const e of (f.events?.edges ?? []).map((n) => n.node)) {
      const at = e.happenedAt ?? null;
      if (!at) continue;
      const cat = classifyDeliveryEvent(e);
      if (
        cat !== "delivered" &&
        cat !== "collected_at_pickup" &&
        cat !== "delivered_to_pickup" &&
        cat !== "returned"
      ) {
        continue;
      }
      if (!latest[cat] || at > latest[cat]!) latest[cat] = at;
    }
  }
  const out: Array<{ message: string; createdAt: string }> = [];
  if (latest.returned) {
    out.push({ message: "Carrier reported the shipment returned to sender.", createdAt: latest.returned });
  }
  if (latest.delivered_to_pickup) {
    out.push({ message: "Carrier delivered the shipment to a pickup point for collection.", createdAt: latest.delivered_to_pickup });
  }
  if (latest.collected_at_pickup) {
    out.push({ message: "Recipient collected the shipment at the pickup point (identification required at collection).", createdAt: latest.collected_at_pickup });
  }
  if (latest.delivered) {
    out.push({ message: "Carrier confirmed delivery of the shipment to the recipient.", createdAt: latest.delivered });
  }
  return out;
}

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
      labelToken: {
        key: "packs.section.order",
        params: { orderName: order.name },
      },
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
        channel: order.sourceName ?? null,
      },
    },
  ];

  if (order.refunds.length > 0) {
    // A refund actually issued on the order is the decisive evidence for a
    // CREDIT_NOT_PROCESSED ("you didn't refund me") dispute. Emit it as the
    // `refund_record` field so it becomes a citable fact — categorized
    // strong when a positive amount was processed. `refundStatus:
    // "processed"` is the load-bearing key the refund_processed predicate
    // matches on (a refund that exists on the order IS processed; Shopify
    // doesn't expose pending refunds here). The latest refund carries the
    // amount/date the narrative cites; totalRefunded is the order total.
    const totalRefunded = Number.parseFloat(
      order.totalRefundedSet.shopMoney.amount,
    );
    const latest = [...order.refunds].sort((a, b) =>
      (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
    )[0];
    // Did the credit land BEFORE the cardholder filed? That single bit
    // separates a representable case from a concession, and the
    // narrative needs it (plus the coverage arithmetic) to argue the
    // credit without overclaiming. Same helper the fatal-loss gate uses.
    const credit = detectCreditAlreadyIssued({
      order,
      disputeAmount: ctx.disputeAmount,
      disputeInitiatedAt: ctx.disputeInitiatedAt,
    });
    sections.push({
      type: "order",
      labelToken: { key: "packs.section.refundHistory" },
      source: "shopify_order",
      fieldsProvided: totalRefunded > 0 ? ["refund_record"] : [],
      data: {
        refundStatus: totalRefunded > 0 ? "processed" : "none",
        amount: order.totalRefundedSet.shopMoney.amount,
        currency: order.totalRefundedSet.shopMoney.currencyCode,
        refundedAt: latest?.createdAt ?? null,
        // `precededDispute` gates the `credit_preceded_dispute`
        // predicate, and therefore the whole credit-already-issued
        // strategy. It is false whenever we cannot positively establish
        // the ordering — never assert a credit came first on a guess.
        precededDispute: credit.triggered,
        creditCoversDisputedAmount: credit.coversDisputedAmount,
        creditResidual: credit.residual,
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

  // No-return-initiated evidence. For a CREDIT_NOT_PROCESSED dispute where
  // NO refund was issued, `returnStatus === NO_RETURN` is the grounded basis
  // for "no refund was owed — the customer never initiated a return." Only
  // emitted when BOTH conditions hold: emitting it alongside a processed
  // refund would be self-contradictory ("we didn't refund because no return"
  // next to "we refunded"), and asserting it when a return IS in flight would
  // be false. Verified live 2026-07: Order.returnStatus is an Admin-2026-01
  // enum (NO_RETURN | RETURN_REQUESTED | IN_PROGRESS | RETURNED | …).
  const totalRefundedAll = Number.parseFloat(
    order.totalRefundedSet.shopMoney.amount,
  );
  if (order.returnStatus === "NO_RETURN" && !(totalRefundedAll > 0)) {
    sections.push({
      type: "order",
      labelToken: { key: "packs.section.noReturnInitiated" },
      source: "shopify_order",
      fieldsProvided: ["no_return_initiated"],
      data: {
        returnStatus: order.returnStatus,
      },
    });
  }

  // Activity log: customer tenure + order timeline.
  // Maps to Shopify's accessActivityLog field and satisfies the
  // "activity_log" completeness field.
  const deliveryChronology = fulfillmentChronologyEvents(order);
  if (order.customer || order.events?.edges?.length || deliveryChronology.length) {
    const timelineEvents = [
      ...(order.events?.edges ?? []).map((e) => ({
        message: e.node.message,
        createdAt: e.node.createdAt,
      })),
      // Native carrier delivery milestones (Fulfillment.events) — decisive
      // for item-not-received disputes and otherwise absent from the
      // Order.events-only timeline. The chronology builder sorts by time.
      ...deliveryChronology,
    ];

    // Cap at 20 but NEVER drop a delivery milestone — those are the
    // decisive bullets for an item-not-received dispute. Keep all delivery
    // events + fill the remaining slots with the most recent order events.
    const deliverySet = new Set(deliveryChronology);
    const cappedTimeline =
      timelineEvents.length <= 20
        ? timelineEvents
        : [
            ...deliveryChronology,
            ...timelineEvents
              .filter((e) => !deliverySet.has(e))
              .slice(-(Math.max(0, 20 - deliveryChronology.length))),
          ];

    sections.push({
      type: "access_log",
      labelToken: { key: "packs.section.customerActivityLog" },
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
        timelineEvents: cappedTimeline,
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
    // `disputeFreeHistory` and `priorUndisputedOrders` are emitted ONLY
    // when `loadPriorOrderHistory` verified them against our own
    // ingested orders + disputes. When it could not (guest checkout,
    // partial order coverage, read failure) the keys are OMITTED — an
    // absent key reads as "unknown" through `disputeFreeHistoryState`,
    // and the copy then states the order count without claiming the
    // history is clean. Do NOT default either key: writing `true` here
    // is exactly the bug that told an issuer an account with two open
    // chargebacks had "an established dispute-free order history"
    // (blume-box dispute 162042cd, 2026-07-31).
    const prior = ctx.priorHistory;
    sections.push({
      type: "other",
      labelToken: { key: "packs.section.customerAccountDetails" },
      source: "shopify_order",
      fieldsProvided: ["customer_account_info"],
      data: {
        totalOrders: Number.isFinite(totalOrders) ? totalOrders : 0,
        customerSince: order.customer.createdAt,
        customerNote: order.customer.note,
        isRepeatCustomer: totalOrders > 1,
        // Both keys or neither: `priorUndisputedOrders` asserts
        // undisputedness in its own name, so it may only be emitted
        // alongside a RESOLVED `disputeFreeHistory`. On partial coverage
        // (`disputeFreeHistory === null`) we emit neither and the row
        // reads as unknown.
        ...(prior && prior.disputeFreeHistory !== null
          ? {
              priorUndisputedOrders: prior.priorUndisputedOrders,
              disputeFreeHistory: prior.disputeFreeHistory,
            }
          : {}),
      },
    });
  }

  return sections;
}
