/**
 * Tests for handleFulfillmentWebhook (fulfillment_events/create +
 * fulfillments/update): a carrier update on a disputed order rebuilds the
 * case; an update on any other order writes nothing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/webhooks/verify", () => ({ verifyShopifyWebhook: vi.fn() }));
vi.mock("@/lib/webhooks/eventIdempotency", () => ({
  checkAndClaim: vi.fn(),
  markProcessed: vi.fn(),
  buildSafePayloadExcerpt: vi.fn(),
}));
vi.mock("@/lib/shopify/orderIngest", () => ({ resolveShopIdByDomain: vi.fn() }));
vi.mock("@/lib/disputes/rebuildOnCarrierUpdate", () => ({
  openDisputesForOrder: vi.fn(),
  rebuildOpenDisputesOnCarrierUpdate: vi.fn(),
}));

import { handleFulfillmentWebhook } from "@/lib/webhooks/handleFulfillmentWebhook";
import { verifyShopifyWebhook } from "@/lib/webhooks/verify";
import { checkAndClaim, markProcessed } from "@/lib/webhooks/eventIdempotency";
import { resolveShopIdByDomain } from "@/lib/shopify/orderIngest";
import {
  openDisputesForOrder,
  rebuildOpenDisputesOnCarrierUpdate,
} from "@/lib/disputes/rebuildOnCarrierUpdate";

const mockVerify = vi.mocked(verifyShopifyWebhook);
const mockClaim = vi.mocked(checkAndClaim);
const mockMark = vi.mocked(markProcessed);
const mockShop = vi.mocked(resolveShopIdByDomain);
const mockOpen = vi.mocked(openDisputesForOrder);
const mockRebuild = vi.mocked(rebuildOpenDisputesOnCarrierUpdate);

const HEADERS = {
  hmac: "h",
  shopDomain: "blume-box.myshopify.com",
  webhookId: "wh-1",
  topic: "fulfillment_events/create",
};
const EVENT = JSON.stringify({
  id: 111,
  fulfillment_id: 6719323799745,
  order_id: 7549174841537,
  status: "delivered",
  admin_graphql_api_id: "gid://shopify/FulfillmentEvent/111",
});

describe("handleFulfillmentWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerify.mockReturnValue(true);
    mockShop.mockResolvedValue("shop-1");
    mockClaim.mockResolvedValue({ status: "fresh", eventRowId: "row-1" });
    mockOpen.mockResolvedValue([{ id: "d-1", packId: "p-1" }]);
    mockRebuild.mockResolvedValue({ reingested: true, rebuildsEnqueued: 1, alreadyQueued: 0 });
  });

  it("401 on a bad signature", async () => {
    mockVerify.mockReturnValue(false);
    const r = await handleFulfillmentWebhook({ rawBody: EVENT, headers: HEADERS });
    expect(r.status).toBe(401);
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("rebuilds the open dispute on the event's order", async () => {
    const r = await handleFulfillmentWebhook({ rawBody: EVENT, headers: HEADERS });
    expect(r.status).toBe(200);
    expect(mockOpen).toHaveBeenCalledWith("shop-1", "gid://shopify/Order/7549174841537");
    expect(mockRebuild).toHaveBeenCalledWith(
      expect.objectContaining({
        shopId: "shop-1",
        orderGid: "gid://shopify/Order/7549174841537",
        disputes: [{ id: "d-1", packId: "p-1" }],
        trigger: "webhook_fulfillment_events_create",
        eventStatus: "delivered",
      }),
    );
    expect(mockMark).toHaveBeenCalledWith(expect.objectContaining({ outcome: "applied" }));
  });

  it("an order with no open dispute writes nothing — not even a webhook_events row", async () => {
    mockOpen.mockResolvedValue([]);
    const r = await handleFulfillmentWebhook({ rawBody: EVENT, headers: HEADERS });
    expect(r.body).toMatchObject({ skipped: "no_open_dispute" });
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mockRebuild).not.toHaveBeenCalled();
  });

  it("a redelivered webhook is not processed twice", async () => {
    mockClaim.mockResolvedValue({ status: "duplicate" } as never);
    const r = await handleFulfillmentWebhook({ rawBody: EVENT, headers: HEADERS });
    expect(r.body).toMatchObject({ skipped: "duplicate_event" });
    expect(mockRebuild).not.toHaveBeenCalled();
  });

  it("reads fulfillments/update's shipment_status", async () => {
    const body = JSON.stringify({ id: 6719323799745, order_id: 7549174841537, status: "success", shipment_status: "delivered" });
    await handleFulfillmentWebhook({ rawBody: body, headers: { ...HEADERS, topic: "fulfillments/update" } });
    expect(mockRebuild).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: "webhook_fulfillments_update", eventStatus: "delivered" }),
    );
  });

  it("unknown shop and missing order id are 200 so Shopify does not retry", async () => {
    mockShop.mockResolvedValueOnce(null);
    expect((await handleFulfillmentWebhook({ rawBody: EVENT, headers: HEADERS })).status).toBe(200);
    const r = await handleFulfillmentWebhook({ rawBody: JSON.stringify({ id: 1 }), headers: HEADERS });
    expect(r.body).toMatchObject({ skipped: "missing_order_id" });
  });

  it("500 when the rebuild fails, so Shopify retries", async () => {
    mockRebuild.mockRejectedValue(new Error("db down"));
    const r = await handleFulfillmentWebhook({ rawBody: EVENT, headers: HEADERS });
    expect(r.status).toBe(500);
    expect(mockMark).toHaveBeenCalledWith(expect.objectContaining({ outcome: "error" }));
  });
});
