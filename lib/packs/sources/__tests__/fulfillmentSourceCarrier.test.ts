/**
 * Carrier plan PR 1C (+ always-verify v2, 2026-07) — carrier-API
 * integration in the fulfillment collector: always-verify lookups (query
 * the carrier for strength even when Shopify already reports delivered),
 * cache participation, cross-source reconciliation, multi-shipment
 * coverage (§5.6/§5.7), and the safety contract (a total carrier outage
 * never breaks the pack build and never produces negative delivery
 * language; a carrier result only ever adds strength, never downgrades).
 *
 * The DHL adapter runs against a mocked global fetch; Supabase and the
 * admin-email helper are mocked so alert/dedup/cache flows are observable.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

// ── Supabase mock: chainable builder covering the three query shapes the
//    carrier layer uses (cache select, cache upsert, order rollup update,
//    alert RPC). ─────────────────────────────────────────────────────────
const rpcMock = vi.fn();
const upsertMock = vi.fn(async (_row: unknown, _opts: unknown) => ({ error: null }));
const updateEqEqMock = vi.fn(async () => ({ error: null }));
let cacheRows: Array<Record<string, unknown>> = [];

function makeBuilder() {
  return {
    select: () => makeBuilder(),
    eq: () => makeBuilder(),
    in: async () => ({ data: cacheRows, error: null }),
    upsert: (row: unknown, opts: unknown) => upsertMock(row, opts),
    update: () => ({ eq: () => ({ eq: updateEqEqMock }) }),
  };
}
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({ rpc: rpcMock, from: () => makeBuilder() }),
}));

const sendAdminEmailMock = vi.fn(async (_opts: unknown) => {});
vi.mock("@/lib/email/adminEmail", () => ({
  sendAdminEmail: (opts: unknown) => sendAdminEmailMock(opts),
}));

import { collectFulfillmentEvidence } from "../fulfillmentSource";
import type { BuildContext } from "../../types";
import type { OrderDetailNode, OrderFulfillment } from "@/lib/shopify/queries/orders";

const DHL_URL =
  "https://www.dhl.com/se-en/home/tracking.html?tracking-id=373325386394209542";

type Addr = OrderDetailNode["shippingAddress"];
const addr = (city: string, country: string): Addr =>
  ({ address1: "1 Main", address2: null, city, province: null, provinceCode: "XX", country, countryCode: country, zip: "00000" }) as Addr;

let fulfillmentSeq = 0;
const fulfillment = (over: Partial<Record<string, unknown>> = {}): OrderFulfillment =>
  ({
    id: `gid://shopify/Fulfillment/${++fulfillmentSeq}`,
    status: "SUCCESS",
    displayStatus: "IN_TRANSIT",
    createdAt: "2026-05-20T10:00:00Z",
    updatedAt: null,
    deliveredAt: null,
    estimatedDeliveryAt: null,
    trackingInfo: [{ number: "5198980574", url: DHL_URL, company: "DHL Freight" }],
    fulfillmentLineItems: { edges: [{ node: { lineItem: { title: "Item" }, quantity: 1 } }] },
    events: { edges: [] },
    ...over,
  }) as unknown as OrderFulfillment;

const NATIVE_DELIVERED = {
  edges: [
    { node: { status: "DELIVERED", happenedAt: "2026-06-01T10:00:00Z", message: "Delivered to recipient" } },
  ],
};

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
      displayFulfillmentStatus: "FULFILLED",
      billingAddress: addr("Stockholm", "SE"),
      shippingAddress: addr("Stockholm", "SE"),
      ...order,
    } as OrderDetailNode,
    paymentContext: { family: "card", raw: null, label: "Card", cardNetwork: null },
  }) as BuildContext;

const lineItems = (qty: number) =>
  ({ edges: [{ node: { title: "Item", quantity: qty } }] }) as unknown as OrderDetailNode["lineItems"];

const pickupFixture = {
  shipments: [
    {
      status: { timestamp: "2026-06-04T14:31:00", statusCode: "delivered", description: "Picked up by receiver" },
      events: [
        { timestamp: "2026-06-04T14:31:00", statusCode: "delivered", description: "Picked up by receiver, DIREKTEN LÖDÖSE Servicepoint" },
      ],
    },
  ],
};

async function sectionData(c: BuildContext) {
  const sections = await collectFulfillmentEvidence(c);
  return sections[0]?.data as Record<string, any>;
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("DHL_API_KEY", "test-key");
  vi.stubEnv("DHL_API_SECRET", "test-secret");
  fetchMock.mockReset();
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: true, error: null });
  upsertMock.mockClear();
  updateEqEqMock.mockClear();
  sendAdminEmailMock.mockClear();
  cacheRows = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the #12809 acceptance shape — DHL Freight, no Shopify signal", () => {
  it("cites the carrier collection honestly: CollectedAtPickup (ID-verified receipt), carrier provenance, URL-derived id", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(pickupFixture), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const data = await sectionData(ctx({ fulfillments: [fulfillment()] }));

    // Lookup used the URL-derived tracking-id, not the stored confirmation number.
    expect(String(fetchMock.mock.calls[0][0])).toContain("trackingNumber=373325386394209542");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("5198980574");

    const f = data.fulfillments[0];
    expect(f.carrierTracking).toMatchObject({
      deliveryStatus: "CollectedAtPickup",
      trackingSource: "carrier_api_dhl",
      deliveredAtTracking: "2026-06-04T14:31:00", // customer-receipt date
    });
    expect(f.carrierTerminalEvent.message).toContain("Picked up by receiver");
    // ID-verified collection = confirmed customer receipt → moderate tier…
    expect(data.proofType).toBe("delivered_confirmed");
    expect(data.deliveredAt).toBe("2026-06-04T14:31:00");
    // …but NEVER an address-delivery claim (rubric #9 stays off).
    expect(data.deliveredToVerifiedAddress).toBe(false);
    // Result persisted with provenance for cache + admin.
    expect(upsertMock).toHaveBeenCalled();
    const persisted = upsertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(persisted).toMatchObject({
      carrier_normalized: "dhl",
      effective_tracking_id: "373325386394209542",
      identifier_source: "url",
      shipment_status: "CollectedAtPickup",
      tracking_source: "carrier_api_dhl",
      last_carrier_lookup_result: "success",
    });
  });

  it("a carrier Delivered result rolls up to shopify_orders (KPI reuse)", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          shipments: [
            {
              status: { timestamp: "2026-06-04T14:31:00", statusCode: "delivered" },
              events: [{ timestamp: "2026-06-04T14:31:00", statusCode: "delivered", description: "Delivered to recipient" }],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const data = await sectionData(ctx({ fulfillments: [fulfillment()] }));
    expect(data.proofType).toBe("delivered_confirmed");
    expect(data.deliveredAt).toBe("2026-06-04T14:31:00");
    expect(updateEqEqMock).toHaveBeenCalled(); // order-level rollup fired
  });
});

describe("always-verify + cache participation (§5.7 v2)", () => {
  it("still queries the carrier for strength even when Shopify already reports delivered", async () => {
    // v2 (2026-07): the bounded gate is gone — we fetch the carrier POD for
    // strength regardless of the existing Shopify "Delivered" signal. The
    // carrier confirming the same delivery keeps proofType delivered_confirmed.
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          shipments: [
            {
              status: { timestamp: "2026-06-01T10:00:00Z", statusCode: "delivered" },
              events: [{ timestamp: "2026-06-01T10:00:00Z", statusCode: "delivered", description: "Delivered to recipient" }],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const data = await sectionData(
      ctx({ fulfillments: [fulfillment({ events: NATIVE_DELIVERED })] }),
    );
    expect(fetchMock).toHaveBeenCalled();
    expect(data.proofType).toBe("delivered_confirmed");
  });

  it("a cached terminal carrier Returned beats an older native Delivered — no live call", async () => {
    const f = fulfillment({ events: NATIVE_DELIVERED });
    cacheRows = [
      {
        tracking_key: "5198980574",
        shopify_fulfillment_id: f.id,
        shipment_status: "Returned",
        terminal_at: "2026-06-20T10:00:00Z",
        tracking_source: "carrier_api_dhl",
        last_carrier_lookup_result: "success",
        last_carrier_lookup_at: "2026-06-21T00:00:00Z",
        effective_tracking_id: "373325386394209542",
      },
    ];
    const data = await sectionData(ctx({ fulfillments: [f] }));
    expect(fetchMock).not.toHaveBeenCalled();
    const payload = data.fulfillments[0];
    expect(payload.carrierTracking).toMatchObject({
      deliveryStatus: "Returned",
      trackingSource: "carrier_api_dhl",
    });
    expect(payload.sourceConflict).toBe(true); // conflict surfaced, not discarded
    expect(data.proofType).toBe("label_created"); // stale positive is dead
    expect(data.deliveredAt).toBeNull();
  });

  it("conflicting Shopify-side signals trigger a live lookup that settles the state", async () => {
    // Native timeline says returned, but Shopify deliveredAt says delivered → conflict.
    const f = fulfillment({
      deliveredAt: "2026-06-01T10:00:00Z",
      events: {
        edges: [
          { node: { status: "FAILURE", happenedAt: "2026-06-10T10:00:00Z", message: "Returned to sender" } },
        ],
      },
    });
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          shipments: [
            {
              status: { timestamp: "2026-06-25T10:00:00Z", statusCode: "delivered" },
              events: [{ timestamp: "2026-06-25T10:00:00Z", statusCode: "delivered", description: "Delivered to recipient" }],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const data = await sectionData(ctx({ fulfillments: [f] }));
    expect(fetchMock).toHaveBeenCalled();
    // Redelivery (newest) supersedes the mid-timeline return.
    expect(data.proofType).toBe("delivered_confirmed");
    expect(data.fulfillments[0].sourceConflict).toBe(true);
  });
});

describe("safety: carrier failures never break the build or create negative evidence", () => {
  it("total carrier outage → pack still builds on Shopify data; failure notified once", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const data = await sectionData(ctx({ fulfillments: [fulfillment()] }));
    expect(data).toBeTruthy();
    expect(data.fulfillments[0].carrierTracking).toBeNull(); // absence, not negativity
    expect(data.proofType).toBe("delivered_unverified"); // from status SUCCESS only
    expect(sendAdminEmailMock).toHaveBeenCalledTimes(1);
    const email = sendAdminEmailMock.mock.calls[0][0] as { subject: string; text: string };
    expect(email.subject).toContain("network_error");
    expect(email.text).not.toContain("373325386394209542"); // masked
  });

  it("isolated not_found is logged but sends no email (§6.5)", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 404 }));
    const data = await sectionData(ctx({ fulfillments: [fulfillment()] }));
    expect(data.fulfillments[0].carrierTracking).toBeNull();
    expect(sendAdminEmailMock).not.toHaveBeenCalled();
  });
});

describe("unsupported / unknown carriers (§7)", () => {
  it("unsupported carrier with NO delivery signal notifies (demand signal)", async () => {
    const f = fulfillment({
      trackingInfo: [{ number: "PN1", url: "https://tracking.postnord.com/se?id=PN1", company: "PostNord SE" }],
    });
    await sectionData(ctx({ fulfillments: [f] }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendAdminEmailMock).toHaveBeenCalledTimes(1);
    const email = sendAdminEmailMock.mock.calls[0][0] as { subject: string; text: string };
    expect(email.subject).toBe("[DisputeDesk] Unsupported carrier detected: postnord");
    expect(email.text).not.toContain("?id="); // hostname only
  });

  it("unsupported carrier ALWAYS notifies now, even with an existing terminal signal (v2)", async () => {
    // v2: a missing adapter always costs us the stronger carrier POD, so
    // the demand signal fires regardless of Shopify already reporting
    // delivered. (Dedup still limits this to one email per merchant+carrier
    // per 7 days at the alerts layer.)
    const f = fulfillment({
      trackingInfo: [{ number: "PN1", url: null, company: "PostNord SE" }],
      events: NATIVE_DELIVERED,
    });
    await sectionData(ctx({ fulfillments: [f] }));
    expect(sendAdminEmailMock).toHaveBeenCalledTimes(1);
    const email = sendAdminEmailMock.mock.calls[0][0] as { subject: string };
    expect(email.subject).toBe("[DisputeDesk] Unsupported carrier detected: postnord");
  });

  it("unknown carrier is recorded but never emailed", async () => {
    const f = fulfillment({
      trackingInfo: [{ number: "X1", url: "https://bobsvans.example/t/1", company: "Bob's Vans" }],
    });
    const data = await sectionData(ctx({ fulfillments: [f] }));
    expect(sendAdminEmailMock).not.toHaveBeenCalled();
    expect(data.fulfillments[0].carrierTracking).toBeNull();
  });
});

describe("multi-shipment coverage (§5.6)", () => {
  it("one delivered + one in-transit shipment → partial coverage, no order-level claim, package evidence kept", async () => {
    const delivered = fulfillment({ events: NATIVE_DELIVERED, trackingInfo: [] });
    const inTransit = fulfillment({ trackingInfo: [], displayStatus: "IN_TRANSIT", status: "OPEN" });
    const data = await sectionData(
      ctx({ lineItems: lineItems(2), fulfillments: [delivered, inTransit] }),
    );
    expect(data.deliveryCoverage).toBe("partial");
    expect(data.deliveredToVerifiedAddress).toBe(false); // no order-level definitive claim
    expect(data.proofType).toBe("delivered_confirmed"); // package-level evidence preserved
    expect(data.deliveredAt).toBe("2026-06-01T10:00:00Z");
  });

  it("two delivered shipments covering the order → complete coverage + order-level claim", async () => {
    const f1 = fulfillment({ events: NATIVE_DELIVERED, trackingInfo: [] });
    const f2 = fulfillment({ events: NATIVE_DELIVERED, trackingInfo: [] });
    const data = await sectionData(ctx({ lineItems: lineItems(2), fulfillments: [f1, f2] }));
    expect(data.deliveryCoverage).toBe("complete");
    expect(data.deliveredToVerifiedAddress).toBe(true);
  });

  it("one delivered + one returned → partial coverage; the returned shipment adds nothing", async () => {
    const returned = fulfillment({
      trackingInfo: [],
      events: {
        edges: [{ node: { status: "FAILURE", happenedAt: "2026-06-10T10:00:00Z", message: "Returned to sender" } }],
      },
    });
    const delivered = fulfillment({ events: NATIVE_DELIVERED, trackingInfo: [] });
    const data = await sectionData(
      ctx({ lineItems: lineItems(2), fulfillments: [delivered, returned] }),
    );
    expect(data.deliveryCoverage).toBe("partial");
    expect(data.deliveredToVerifiedAddress).toBe(false);
  });

  it("no line items on the order → coverage unknown, existing behavior preserved", async () => {
    const data = await sectionData(
      ctx({ fulfillments: [fulfillment({ events: NATIVE_DELIVERED, trackingInfo: [] })] }),
    );
    expect(data.deliveryCoverage).toBe("unknown");
    expect(data.deliveredToVerifiedAddress).toBe(true);
  });
});
