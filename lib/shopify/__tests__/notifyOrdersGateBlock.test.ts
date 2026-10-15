/**
 * Admin alert when a shop hits the no-orders lock screen. Pins: the email goes
 * out only when the throttle claim (conditional UPDATE) matches a row, it
 * carries the store's details, and nothing ever throws.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let claimedRow: Record<string, unknown> | null = null;
let previousStamp: string | null = null;
const orFilter = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { orders_gate_notified_at: previousStamp },
            error: null,
          }),
        }),
      }),
      update: () => ({
        eq: () => ({
          or: (f: string) => {
            orFilter(f);
            return {
              select: () => ({
                maybeSingle: async () => ({ data: claimedRow, error: null }),
              }),
            };
          },
        }),
      }),
    }),
  }),
}));

const fetchShopDetails = vi.fn();
vi.mock("@/lib/shopify/shopDetails", () => ({
  fetchShopDetails: (...a: unknown[]) => fetchShopDetails(...a),
}));

const send = vi.fn();
vi.mock("@/lib/email/sendAdminNotification", () => ({
  sendAdminOrdersGateBlockNotification: (...a: unknown[]) => send(...a),
}));

import { notifyOrdersGateBlock } from "@/lib/shopify/notifyOrdersGateBlock";

describe("notifyOrdersGateBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    previousStamp = null;
    claimedRow = {
      shop_domain: "empty-store.myshopify.com",
      shop_name: "Empty Store DB",
      created_at: "2026-10-14T10:00:00Z",
      installed_at: "2026-10-14T10:00:00Z",
      orders_gate_notified_at: "2026-10-15T12:00:00Z",
    };
    fetchShopDetails.mockResolvedValue({
      name: "Empty Store",
      email: "owner@empty.test",
      phone: "+1 555",
      primaryDomain: "https://empty.test",
      currencyCode: "USD",
      address: { country: "Canada" },
    });
  });

  it("claims the 24h throttle and sends the store's details", async () => {
    await notifyOrdersGateBlock({ shopInternalId: "shop-1", path: "/app" });
    expect(orFilter.mock.calls[0][0]).toMatch(
      /^orders_gate_notified_at\.is\.null,orders_gate_notified_at\.lt\./,
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        shopDomain: "empty-store.myshopify.com",
        shopName: "Empty Store",
        email: "owner@empty.test",
        country: "Canada",
        path: "/app",
        shopInternalId: "shop-1",
        shopifyAdminUrl: "https://admin.shopify.com/store/empty-store",
      }),
    );
  });

  it("does not send when already alerted within 24h (claim matched nothing)", async () => {
    claimedRow = null;
    await notifyOrdersGateBlock({ shopInternalId: "shop-1" });
    expect(send).not.toHaveBeenCalled();
    expect(fetchShopDetails).not.toHaveBeenCalled();
  });

  it("still sends with DB fields when Shopify enrichment fails", async () => {
    fetchShopDetails.mockRejectedValue(new Error("401"));
    await notifyOrdersGateBlock({ shopInternalId: "shop-1" });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ shopName: "Empty Store DB", email: undefined }),
    );
  });

  it("never throws when the send fails", async () => {
    send.mockRejectedValue(new Error("resend down"));
    await expect(notifyOrdersGateBlock({ shopInternalId: "shop-1" })).resolves.toBeUndefined();
  });
});
