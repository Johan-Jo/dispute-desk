/**
 * Delivery milestones must appear in the access_log timeline (Chronology
 * of Events). Native carrier delivery lives on Fulfillment.events, a
 * different Shopify connection than Order.events — so before the merge in
 * orderSource, a confirmed delivery never reached the bank-facing
 * chronology even though the narrative mentioned it.
 */
import { describe, expect, it } from "vitest";
import { collectOrderEvidence } from "../orderSource";
import type { BuildContext } from "../../types";
import type { OrderDetailNode, OrderFulfillment } from "@/lib/shopify/queries/orders";

const fulfillment = (
  events: Array<{ status: string | null; happenedAt: string | null; message: string | null }>,
): OrderFulfillment =>
  ({
    id: "gid://shopify/Fulfillment/1",
    status: "SUCCESS",
    displayStatus: "IN_TRANSIT",
    createdAt: "2026-06-07T14:39:06Z",
    updatedAt: null,
    deliveredAt: null,
    estimatedDeliveryAt: null,
    trackingInfo: [],
    fulfillmentLineItems: { edges: [] },
    events: { edges: events.map((node) => ({ node })) },
  }) as unknown as OrderFulfillment;

const ctx = (order: Partial<OrderDetailNode>): BuildContext =>
  ({
    packId: "p1",
    disputeId: "d1",
    shopId: "s1",
    disputeReason: "PRODUCT_NOT_RECEIVED",
    orderGid: "gid://shopify/Order/1",
    shopDomain: "t.myshopify.com",
    accessToken: "x",
    order: {
      id: "gid://shopify/Order/1",
      name: "#12936",
      createdAt: "2026-06-06T07:08:00Z",
      displayFinancialStatus: "PAID",
      displayFulfillmentStatus: "FULFILLED",
      lineItems: { edges: [] },
      totalPriceSet: { shopMoney: { amount: "439.05", currencyCode: "SEK" } },
      subtotalPriceSet: { shopMoney: { amount: "439.05", currencyCode: "SEK" } },
      totalShippingPriceSet: { shopMoney: { amount: "0.00", currencyCode: "SEK" } },
      totalTaxSet: { shopMoney: { amount: "0.00", currencyCode: "SEK" } },
      totalDiscountsSet: { shopMoney: { amount: "0.00", currencyCode: "SEK" } },
      totalRefundedSet: { shopMoney: { amount: "0.00", currencyCode: "SEK" } },
      billingAddress: null,
      shippingAddress: null,
      transactions: [],
      refunds: [],
      events: { edges: [] },
      customer: null,
      fulfillments: [],
      returnStatus: null,
      ...order,
    } as unknown as OrderDetailNode,
    paymentContext: { family: "card", raw: null, label: "Card", cardNetwork: null },
  }) as BuildContext;

async function timeline(c: BuildContext) {
  const sections = await collectOrderEvidence(c);
  const accessLog = sections.find((s) => s.type === "access_log");
  return ((accessLog?.data as { timelineEvents?: Array<{ message: string; createdAt: string }> })
    ?.timelineEvents) ?? [];
}

describe("orderSource — delivery milestones in the chronology timeline", () => {
  it("adds a 'carrier confirmed delivery' bullet from the native fulfillment event", async () => {
    const events = await timeline(
      ctx({
        fulfillments: [
          fulfillment([
            { status: "IN_TRANSIT", happenedAt: "2026-06-07T17:16:52Z", message: "Försändelsen är på väg." },
            { status: "FAILURE", happenedAt: "2026-07-06T18:16:00Z", message: "Försändelsen har levererats." },
          ]),
        ],
      }),
    );
    const delivered = events.find((e) => /confirmed delivery/i.test(e.message));
    expect(delivered).toBeTruthy();
    expect(delivered!.createdAt).toBe("2026-07-06T18:16:00Z");
    // In-transit scans are NOT surfaced (noise).
    expect(events.some((e) => /på väg/i.test(e.message))).toBe(false);
  });

  it("surfaces a returned-to-sender milestone", async () => {
    const events = await timeline(
      ctx({
        fulfillments: [
          fulfillment([
            { status: "FAILURE", happenedAt: "2026-06-17T06:05:42Z", message: "Ditt paket har returnerats till avsändaren." },
          ]),
        ],
      }),
    );
    expect(events.some((e) => /returned to sender/i.test(e.message))).toBe(true);
  });

  it("keeps only the LATEST delivery per category (no duplicate bullets)", async () => {
    const events = await timeline(
      ctx({
        fulfillments: [
          fulfillment([
            { status: "FAILURE", happenedAt: "2026-06-17T06:05:42Z", message: "returnerats till avsändaren" },
            { status: "FAILURE", happenedAt: "2026-06-30T08:26:01Z", message: "returnerats till avsändaren" },
            { status: "FAILURE", happenedAt: "2026-07-06T18:16:00Z", message: "Försändelsen har levererats." },
          ]),
        ],
      }),
    );
    expect(events.filter((e) => /returned to sender/i.test(e.message)).length).toBe(1);
    expect(events.filter((e) => /confirmed delivery/i.test(e.message)).length).toBe(1);
  });

  it("merges delivery with existing Order.events", async () => {
    const events = await timeline(
      ctx({
        events: {
          edges: [
            { node: { message: "Order placed", createdAt: "2026-06-06T07:08:00Z" } },
          ],
        } as unknown as OrderDetailNode["events"],
        fulfillments: [
          fulfillment([
            { status: "FAILURE", happenedAt: "2026-07-06T18:16:00Z", message: "Försändelsen har levererats." },
          ]),
        ],
      }),
    );
    expect(events.some((e) => /Order placed/i.test(e.message))).toBe(true);
    expect(events.some((e) => /confirmed delivery/i.test(e.message))).toBe(true);
  });
});
