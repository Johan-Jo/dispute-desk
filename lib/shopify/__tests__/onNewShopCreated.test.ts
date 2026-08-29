/**
 * Behavioural contract for `onNewShopCreated` — the shared once-per-new-merchant
 * side effects (admin install alert + Free-tier pack grant).
 *
 * Pins the properties the three historical regressions each violated:
 *   1. The admin alert is AWAITED (not fire-and-forget) — the 2026-07 miss was
 *      an un-awaited Shopify round-trip losing the race against Vercel freezing
 *      the instance on redirect.
 *   2. A failing `fetchShopDetails` never suppresses the alert — enrichment is
 *      best-effort; the shop domain alone is always enough to notify.
 *   3. A failing credits grant never suppresses the alert, and vice versa.
 *   4. Nothing throws — a side-effect failure can't break a working install.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchShopDetails = vi.fn();
const grantFreeLifetimeCredits = vi.fn();
const sendAdminInstallNotification = vi.fn();

vi.mock("@/lib/shopify/shopDetails", () => ({
  fetchShopDetails: (...args: unknown[]) => fetchShopDetails(...args),
}));
vi.mock("@/lib/billing/grantFreeLifetime", () => ({
  grantFreeLifetimeCredits: (...args: unknown[]) => grantFreeLifetimeCredits(...args),
}));
vi.mock("@/lib/email/sendAdminNotification", () => ({
  sendAdminInstallNotification: (...args: unknown[]) =>
    sendAdminInstallNotification(...args),
}));

import { onNewShopCreated } from "@/lib/shopify/onNewShopCreated";

const OPTS = {
  shopInternalId: "shop-uuid",
  shopDomain: "6a8848-dd.myshopify.com",
  source: "token-exchange",
};

describe("onNewShopCreated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchShopDetails.mockResolvedValue({
      email: "owner@example.com",
      name: "Acme Goods",
    });
    grantFreeLifetimeCredits.mockResolvedValue(undefined);
    sendAdminInstallNotification.mockResolvedValue(undefined);
  });

  it("sends the install alert enriched with store name and owner email", async () => {
    await onNewShopCreated(OPTS);

    expect(sendAdminInstallNotification).toHaveBeenCalledTimes(1);
    expect(sendAdminInstallNotification).toHaveBeenCalledWith({
      shopDomain: "6a8848-dd.myshopify.com",
      email: "owner@example.com",
      shopName: "Acme Goods",
      source: "token-exchange",
    });
  });

  it("grants the Free-tier lifetime packs", async () => {
    await onNewShopCreated(OPTS);
    expect(grantFreeLifetimeCredits).toHaveBeenCalledWith("shop-uuid");
  });

  it("resolves only AFTER the alert send settles (not fire-and-forget)", async () => {
    let settled = false;
    sendAdminInstallNotification.mockImplementation(
      () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            settled = true;
            resolve();
          }, 10),
        ),
    );

    await onNewShopCreated(OPTS);

    // If the send were fire-and-forget this would still be false — exactly the
    // 2026-07 regression where Vercel killed the instance mid-flight.
    expect(settled).toBe(true);
  });

  it("still sends the alert when shop-details enrichment throws", async () => {
    fetchShopDetails.mockRejectedValue(new Error("401 before token propagates"));

    await onNewShopCreated(OPTS);

    expect(sendAdminInstallNotification).toHaveBeenCalledTimes(1);
    const arg = sendAdminInstallNotification.mock.calls[0][0];
    expect(arg.shopDomain).toBe("6a8848-dd.myshopify.com");
    expect(arg.email).toBeUndefined();
    expect(arg.shopName).toBeUndefined();
  });

  it("still sends the alert when the credits grant fails", async () => {
    grantFreeLifetimeCredits.mockRejectedValue(new Error("ledger down"));

    await expect(onNewShopCreated(OPTS)).resolves.toBeUndefined();
    expect(sendAdminInstallNotification).toHaveBeenCalledTimes(1);
  });

  it("never throws when the alert send itself fails", async () => {
    sendAdminInstallNotification.mockRejectedValue(new Error("resend down"));

    await expect(onNewShopCreated(OPTS)).resolves.toBeUndefined();
  });
});
