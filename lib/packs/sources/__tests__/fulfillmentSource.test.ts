/**
 * Fulfillment source — delivery proofType + deliveredToVerifiedAddress
 * (rubric #9). Focus: the flag that upgrades a confirmed delivery to STRONG
 * for item-not-received disputes is set ONLY for a genuine final delivery
 * to the verified customer address, and never for pickup/returned/
 * cross-border.
 */
import { describe, expect, it } from "vitest";
import { collectFulfillmentEvidence } from "../fulfillmentSource";
import type { BuildContext } from "../../types";
import type { OrderDetailNode, OrderFulfillment } from "@/lib/shopify/queries/orders";

type Addr = OrderDetailNode["shippingAddress"];

const addr = (city: string, country: string): Addr =>
  ({
    address1: "1 Main",
    address2: null,
    city,
    province: null,
    provinceCode: "XX",
    country,
    countryCode: country,
    zip: "00000",
  }) as Addr;

const evtFulfillment = (
  events: Array<{ status: string | null; happenedAt: string | null; message: string | null }>,
  overrides: Partial<OrderFulfillment> = {},
): OrderFulfillment =>
  ({
    id: "gid://shopify/Fulfillment/1",
    status: "SUCCESS",
    displayStatus: "IN_TRANSIT",
    createdAt: "2026-06-07T14:39:06Z",
    updatedAt: null,
    deliveredAt: null,
    estimatedDeliveryAt: null,
    trackingInfo: [{ number: "00573132901672098616", url: "https://tracking.postnord.com/x", company: "PostNord SE" }],
    fulfillmentLineItems: { edges: [{ node: { lineItem: { title: "Necklace" }, quantity: 1 } }] },
    events: { edges: events.map((node) => ({ node })) },
    ...overrides,
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
      displayFulfillmentStatus: "FULFILLED",
      billingAddress: addr("Stockholm", "SE"),
      shippingAddress: addr("Stockholm", "SE"),
      ...order,
    } as OrderDetailNode,
    paymentContext: { family: "card", raw: null, label: "Card", cardNetwork: null },
  }) as BuildContext;

const DELIVERED = { status: "FAILURE", happenedAt: "2026-07-06T18:16:00Z", message: "Försändelsen har levererats." };
const PICKUP = { status: "FAILURE", happenedAt: "2026-07-01T10:00:00Z", message: "Försändelsen har levererats till ett serviceställe." };
const RETURNED = { status: "FAILURE", happenedAt: "2026-06-17T06:05:42Z", message: "Ditt paket har returnerats till avsändaren." };

async function sectionData(c: BuildContext) {
  const sections = await collectFulfillmentEvidence(c);
  return sections[0]?.data as Record<string, unknown>;
}

describe("collectFulfillmentEvidence — deliveredToVerifiedAddress (rubric #9)", () => {
  it("sets the flag for a native final delivery to the verified (matching) address", async () => {
    const data = await sectionData(
      ctx({ fulfillments: [evtFulfillment([DELIVERED])] as OrderFulfillment[] } as Partial<OrderDetailNode>),
    );
    expect(data.proofType).toBe("delivered_confirmed");
    expect(data.deliveredToVerifiedAddress).toBe(true);
    expect(data.deliveredAt).toBe("2026-07-06T18:16:00Z");
  });

  it("does NOT set the flag when the parcel only reached a pickup point", async () => {
    const data = await sectionData(
      ctx({ fulfillments: [evtFulfillment([PICKUP])] as OrderFulfillment[] } as Partial<OrderDetailNode>),
    );
    expect(data.deliveredToVerifiedAddress).toBe(false);
  });

  it("does NOT set the flag when the parcel was returned to sender", async () => {
    const data = await sectionData(
      ctx({ fulfillments: [evtFulfillment([RETURNED])] as OrderFulfillment[] } as Partial<OrderDetailNode>),
    );
    expect(data.deliveredToVerifiedAddress).toBe(false);
  });

  it("does NOT set the flag on a cross-border order (billing≠shipping country) even when delivered", async () => {
    const data = await sectionData(
      ctx({
        billingAddress: addr("Berlin", "DE"),
        shippingAddress: addr("Stockholm", "SE"),
        fulfillments: [evtFulfillment([DELIVERED])] as OrderFulfillment[],
      } as Partial<OrderDetailNode>),
    );
    expect(data.proofType).toBe("delivered_confirmed");
    expect(data.deliveredToVerifiedAddress).toBe(false);
  });

  it("does NOT set the flag when billing and shipping cities differ", async () => {
    const data = await sectionData(
      ctx({
        billingAddress: addr("Gothenburg", "SE"),
        shippingAddress: addr("Örebro", "SE"),
        fulfillments: [evtFulfillment([DELIVERED])] as OrderFulfillment[],
      } as Partial<OrderDetailNode>),
    );
    expect(data.deliveredToVerifiedAddress).toBe(false);
  });
});

describe("collectFulfillmentEvidence — collection at pickup point (ID-verified receipt)", () => {
  const COLLECTION_SEQUENCE = [
    PICKUP, // 2026-07-01 arrival at serviceställe
    { status: "FAILURE", happenedAt: "2026-07-06T18:16:00Z", message: "Försändelsen har levererats." }, // customer collects
  ];

  it("counts as confirmed receipt (moderate tier + receipt date) but NEVER as address delivery", async () => {
    const data = await sectionData(
      ctx({ fulfillments: [evtFulfillment(COLLECTION_SEQUENCE)] as OrderFulfillment[] } as Partial<OrderDetailNode>),
    );
    expect(data.proofType).toBe("delivered_confirmed"); // receipt confirmed
    expect(data.deliveredAt).toBe("2026-07-06T18:16:00Z"); // collection date
    expect(data.deliveredToVerifiedAddress).toBe(false); // rubric #9 stays off
    const f = (data.fulfillments as Array<Record<string, unknown>>)[0];
    expect((f.carrierTracking as Record<string, unknown>).deliveryStatus).toBe("CollectedAtPickup");
  });
});
