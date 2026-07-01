/**
 * Tests for `sendFreeOutOfPacksEmail` (lib/email/billingLifecycle.ts).
 *
 * This is the free-tier wall email: a free shop exhausted its lifetime
 * pack floor and hit the manual-build 403. It must
 *   1. delegate throttling to `claimBillingBlockedEmailSlot` — when the
 *      slot is denied, NO email goes out (a merchant clicking build
 *      repeatedly must not get spammed);
 *   2. respect the merchant's `notifications.billing` opt-out;
 *   3. send once when the slot is granted and a team email exists.
 *
 * The throttle helper has its own unit tests, so here it's mocked to
 * the two outcomes that matter to this function (allowed / denied).
 * Resend + Supabase are mocked so no real I/O happens.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/automation/billingBlockedEmailThrottle", () => ({
  claimBillingBlockedEmailSlot: vi.fn(),
}));
const sendMock = vi.fn().mockResolvedValue({ data: { id: "msg-1" }, error: null });
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: sendMock } })),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { claimBillingBlockedEmailSlot } from "@/lib/automation/billingBlockedEmailThrottle";
import { sendFreeOutOfPacksEmail } from "../billingLifecycle";

const mockGetClient = vi.mocked(getServiceClient);
const mockClaim = vi.mocked(claimBillingBlockedEmailSlot);

const ORIGINAL_RESEND_KEY = process.env.RESEND_API_KEY;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = "test_key";
});
afterEach(() => {
  process.env.RESEND_API_KEY = ORIGINAL_RESEND_KEY;
});

/** Minimal Supabase mock: shop_setup (team email + opt-out), shops
 *  (domain), audit_events (insert sink). */
function buildSb(opts: {
  teamPayload?: Record<string, unknown> | null;
}) {
  const steps =
    opts.teamPayload === null
      ? null
      : { team: { payload: opts.teamPayload ?? { teamEmail: "team@example.com" } } };

  return {
    from: vi.fn((table: string) => {
      if (table === "shop_setup") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: steps ? { steps } : null, error: null }),
            }),
          }),
        };
      }
      if (table === "shops") {
        return {
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({
                data: { shop_domain: "shop.myshopify.com" },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "audit_events") {
        return { insert: vi.fn().mockResolvedValue({ error: null }) };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };
}

describe("sendFreeOutOfPacksEmail", () => {
  it("sends when the throttle slot is granted and a team email exists", async () => {
    mockClaim.mockResolvedValue({ allowed: true });
    mockGetClient.mockReturnValue(buildSb({}) as never);

    const r = await sendFreeOutOfPacksEmail({
      shopId: "shop-1",
      disputeId: "dispute-1",
      disputeDueAt: null,
    });

    expect(r).toEqual({ sent: true, logTag: "free_out_of_packs" });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT send when the throttle denies the slot", async () => {
    mockClaim.mockResolvedValue({
      allowed: false,
      reason: "throttled_same_reason",
    });
    mockGetClient.mockReturnValue(buildSb({}) as never);

    const r = await sendFreeOutOfPacksEmail({
      shopId: "shop-1",
      disputeId: "dispute-1",
    });

    expect(r).toEqual({ skipped: "throttled" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("respects notifications.billing === false (opted out)", async () => {
    mockClaim.mockResolvedValue({ allowed: true });
    mockGetClient.mockReturnValue(
      buildSb({
        teamPayload: {
          teamEmail: "team@example.com",
          notifications: { billing: false },
        },
      }) as never,
    );

    const r = await sendFreeOutOfPacksEmail({
      shopId: "shop-1",
      disputeId: "dispute-1",
    });

    expect(r).toEqual({ skipped: "opted_out" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("skips when no team email is configured", async () => {
    mockClaim.mockResolvedValue({ allowed: true });
    mockGetClient.mockReturnValue(
      buildSb({ teamPayload: {} }) as never,
    );

    const r = await sendFreeOutOfPacksEmail({
      shopId: "shop-1",
      disputeId: "dispute-1",
    });

    expect(r).toEqual({ skipped: "no_team_email" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("passes the dispute deadline through to the throttle (72h override)", async () => {
    mockClaim.mockResolvedValue({ allowed: true });
    mockGetClient.mockReturnValue(buildSb({}) as never);

    await sendFreeOutOfPacksEmail({
      shopId: "shop-1",
      disputeId: "dispute-1",
      disputeDueAt: "2026-07-05T00:00:00Z",
    });

    expect(mockClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        shopId: "shop-1",
        disputeId: "dispute-1",
        disputeDueAt: "2026-07-05T00:00:00Z",
      }),
    );
  });
});
