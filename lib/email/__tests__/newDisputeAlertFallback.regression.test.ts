/**
 * Regression: `sendNewDisputeAlert` MUST fall back to the Shopify shop
 * contact email when the merchant has not completed Settings → Team.
 *
 * 2026-05-25 incident (dispute #5DF25744):
 *   - The shop had no `shop_setup.team.payload.teamEmail` (Settings → Team
 *     not yet completed).
 *   - The deferred-email claim (`disputes.new_dispute_alert_sent_at`) was
 *     written successfully — so the system *thought* it had sent.
 *   - `sendNewDisputeAlert` returned early at the `!teamEmail` guard and
 *     the merchant got total silence on a real new dispute.
 *
 * Contract pinned by this test:
 *   1. When `shop_setup.team.payload.teamEmail` is unset/blank, the alert
 *      MUST attempt a Shopify-owner fallback via `fetchShopDetails` before
 *      giving up.
 *   2. When the fallback resolves an email, the Resend send MUST fire to
 *      that address (so the merchant actually gets the alert).
 *   3. When both the team email AND the Shopify fallback are unavailable,
 *      the send is skipped with a warning log — silent drops are forbidden.
 *
 * If a future refactor removes the fallback, dispute #5DF25744 happens
 * again. This test is the gate.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// RESEND_API_KEY is read at module-import time in sendNewDisputeAlert.ts
// (top-level const). Must be set BEFORE the dynamic-import-equivalent ESM
// hoisting captures it.
process.env.RESEND_API_KEY = "test-key";

interface ResendSendArgs {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}
const sendMock = vi.fn(async (_args: ResendSendArgs) => ({
  data: { id: "msg-1" },
}));

vi.mock("resend", () => {
  class FakeResend {
    emails = { send: sendMock };
    constructor(_apiKey?: string) {
      // no-op
    }
  }
  return { Resend: FakeResend };
});
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/email/publicSiteUrl", () => ({
  getEmbeddedAppUrl: vi.fn(() => "https://example.test/disputes/x"),
}));
vi.mock("@/lib/shopify/shopDetails", () => ({
  fetchShopDetails: vi.fn(),
}));

import { sendNewDisputeAlert } from "@/lib/email/sendNewDisputeAlert";
import { getServiceClient } from "@/lib/supabase/server";
import { fetchShopDetails } from "@/lib/shopify/shopDetails";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockFetchShopDetails = vi.mocked(fetchShopDetails);

interface ShopSetupRow {
  steps:
    | Record<string, { payload?: Record<string, unknown> } | undefined>
    | null;
}

function buildClient(setup: {
  shopSetup: ShopSetupRow | null;
  shopDomain?: string;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromImpl = (table: string): any => {
    if (table === "shop_setup") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi
              .fn()
              .mockResolvedValue({ data: setup.shopSetup, error: null }),
          }),
        }),
      };
    }
    if (table === "shops") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { shop_domain: setup.shopDomain ?? "test.myshopify.com" },
              error: null,
            }),
          }),
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  };
  return { from: fromImpl } as unknown as never;
}

const BASE_CTX = {
  shopId: "shop-1",
  disputeId: "dispute-1",
  reason: "fraudulent",
  phase: "chargeback",
  amount: 167.64,
  currencyCode: "USD",
  dueAt: "2026-06-01T22:55:00Z",
  orderName: "#1082",
  resolvedMode: "review" as const,
  shopifyDisputeEvidenceGid: null,
};

describe("[REGRESSION] sendNewDisputeAlert Shopify-owner fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = "test-key";
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("teamEmail missing → falls back to Shopify shop.email and SENDS", async () => {
    const client = buildClient({ shopSetup: { steps: {} } });
    mockGetServiceClient.mockReturnValue(client);
    mockFetchShopDetails.mockResolvedValue({
      name: "Test Shop",
      email: "owner@example.com",
      phone: "",
      primaryDomain: "https://test.myshopify.com",
      currencyCode: "USD",
      address: {
        address1: "",
        address2: "",
        city: "",
        province: "",
        zip: "",
        country: "",
      },
    });

    await sendNewDisputeAlert(BASE_CTX);

    expect(mockFetchShopDetails).toHaveBeenCalledWith("shop-1");
    expect(sendMock).toHaveBeenCalledTimes(1);
    // The send MUST go to the Shopify fallback address. If this becomes
    // `undefined` or the test silently no-ops, the regression has returned.
    expect(sendMock.mock.calls[0]?.[0]).toMatchObject({
      to: "owner@example.com",
    });
  });

  it("teamEmail present → uses it WITHOUT calling Shopify fallback", async () => {
    const client = buildClient({
      shopSetup: {
        steps: { team: { payload: { teamEmail: "team@example.com" } } },
      },
    });
    mockGetServiceClient.mockReturnValue(client);

    await sendNewDisputeAlert(BASE_CTX);

    expect(mockFetchShopDetails).not.toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0]?.[0]).toMatchObject({
      to: "team@example.com",
    });
  });

  it("teamEmail missing AND fetchShopDetails returns null → skips send (no silent claim)", async () => {
    const client = buildClient({ shopSetup: { steps: {} } });
    mockGetServiceClient.mockReturnValue(client);
    mockFetchShopDetails.mockResolvedValue(null);

    await sendNewDisputeAlert(BASE_CTX);

    expect(mockFetchShopDetails).toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("teamEmail missing AND fetchShopDetails throws → skips send, never throws", async () => {
    const client = buildClient({ shopSetup: { steps: {} } });
    mockGetServiceClient.mockReturnValue(client);
    mockFetchShopDetails.mockRejectedValue(new Error("Shopify API down"));

    await expect(sendNewDisputeAlert(BASE_CTX)).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("notifications.newDispute=false → respect opt-out even when Shopify fallback exists", async () => {
    const client = buildClient({
      shopSetup: {
        steps: {
          team: {
            payload: {
              teamEmail: "team@example.com",
              notifications: { newDispute: false },
            },
          },
        },
      },
    });
    mockGetServiceClient.mockReturnValue(client);

    await sendNewDisputeAlert(BASE_CTX);

    expect(sendMock).not.toHaveBeenCalled();
    expect(mockFetchShopDetails).not.toHaveBeenCalled();
  });
});
