/**
 * Deferred merchant install email (lib/shopify/deferredInstallEmail.ts).
 * Pins: sends the requested variant with Shopify details + the shop's locale,
 * skips when an install email already went out, never throws.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let shopRow: Record<string, unknown> | null = null;
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: shopRow, error: null }) }) }),
    }),
  }),
}));

const fetchShopDetails = vi.fn();
vi.mock("@/lib/shopify/shopDetails", () => ({
  fetchShopDetails: (...a: unknown[]) => fetchShopDetails(...a),
}));

const sendInstallWelcomeEmail = vi.fn();
vi.mock("@/lib/email/sendInstallWelcome", () => ({
  sendInstallWelcomeEmail: (...a: unknown[]) => sendInstallWelcomeEmail(...a),
}));

import { sendDeferredInstallEmail } from "@/lib/shopify/deferredInstallEmail";

describe("sendDeferredInstallEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    shopRow = {
      shop_domain: "sharpdesk.myshopify.com",
      shop_name: null,
      locale: "pt-BR",
      welcome_email_sent_at: null,
    };
    fetchShopDetails.mockResolvedValue({ email: "owner@sharp.test", name: "Sharp Desk" });
    sendInstallWelcomeEmail.mockResolvedValue({ ok: true });
  });

  it("sends the no-orders variant to the shop owner in the shop's locale", async () => {
    await sendDeferredInstallEmail("shop-1", "no_orders");
    expect(sendInstallWelcomeEmail).toHaveBeenCalledWith({
      shopInternalId: "shop-1",
      shopDomain: "sharpdesk.myshopify.com",
      to: "owner@sharp.test",
      shopName: "Sharp Desk",
      locale: "pt",
      variant: "no_orders",
    });
  });

  it("skips (no Shopify call) when an install email was already sent", async () => {
    shopRow = { ...shopRow, welcome_email_sent_at: "2026-10-15T13:59:12Z" };
    await sendDeferredInstallEmail("shop-1", "no_orders");
    expect(fetchShopDetails).not.toHaveBeenCalled();
    expect(sendInstallWelcomeEmail).not.toHaveBeenCalled();
  });

  it("never throws", async () => {
    sendInstallWelcomeEmail.mockRejectedValue(new Error("resend down"));
    await expect(sendDeferredInstallEmail("shop-1", "welcome")).resolves.toBeUndefined();
  });
});
