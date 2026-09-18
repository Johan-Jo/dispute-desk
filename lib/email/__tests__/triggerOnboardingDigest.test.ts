/**
 * Tests for the onboarding-digest trigger.
 *
 * The load-bearing behaviour is IDEMPOTENCY. `backfillShopOrders`'s
 * completion branch is not a one-shot event — the walk resumes by cursor and
 * its job is retried by the worker on failure — so this can be called more
 * than once for one shop. Without an atomic claim a merchant gets emailed
 * again on every re-run.
 *
 * The claim must be taken BEFORE the send. Sending first would mean a crash
 * between send and claim re-emails on retry, which is exactly the failure the
 * column exists to prevent.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/email/sendOnboardingAnalysisDigest", () => ({
  sendOnboardingAnalysisDigest: vi.fn(),
}));
vi.mock("@/lib/insights/railSegmentation", () => ({
  railSegmentationFor: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { sendOnboardingAnalysisDigest } from "@/lib/email/sendOnboardingAnalysisDigest";
import { railSegmentationFor } from "@/lib/insights/railSegmentation";
import { triggerOnboardingDigest } from "../triggerOnboardingDigest";

const mockClient = vi.mocked(getServiceClient);
const mockSend = vi.mocked(sendOnboardingAnalysisDigest);
const mockRail = vi.mocked(railSegmentationFor);

const SHOP = "11111111-1111-1111-1111-111111111111";

interface State {
  alreadySent?: string | null;
  teamEmail?: string | null;
  monthlyDigest?: boolean;
  orders?: number;
  /** Simulates another worker winning the claim first. */
  claimLost?: boolean;
}

function buildSb(st: State) {
  const calls = {
    claimAttempts: 0,
    order: [] as string[],
    onClaim: undefined as undefined | (() => void),
  };
  const orderRows = Array.from({ length: st.orders ?? 10 }, () => ({
    processed_at: "2026-08-01T00:00:00Z",
    fulfilled_at: "2026-08-02T00:00:00Z",
    risk_level_initial: "LOW",
    fraud_protection_level: null,
    payment_gateway: "shopify_payments",
    payment_method: "card",
    three_ds_authenticated: null,
    signed_by_name: null,
    delivered_at_tracking: null,
  }));

  const sb = {
    from(table: string) {
      if (table === "shops") {
        return {
          select() {
            const chain = {
              eq: () => chain,
              is: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: SHOP,
                    shop_domain: "x.myshopify.com",
                    historical_import_orders_total: 5000,
                    onboarding_digest_sent_at: st.alreadySent ?? null,
                  },
                }),
              then: undefined,
            };
            return chain;
          },
          update() {
            calls.claimAttempts += 1;
            calls.order.push("claim");
            calls.onClaim?.();
            const chain = {
              eq: () => chain,
              is: () => chain,
              select: () =>
                Promise.resolve({
                  data: st.claimLost ? [] : [{ id: SHOP }],
                  error: null,
                }),
            };
            return chain;
          },
        };
      }
      if (table === "shop_setup") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    steps: {
                      team: {
                        payload: {
                          teamEmail:
                            st.teamEmail === undefined
                              ? "merchant@example.com"
                              : st.teamEmail,
                          notifications:
                            st.monthlyDigest === undefined
                              ? undefined
                              : { monthlyDigest: st.monthlyDigest },
                        },
                      },
                    },
                  },
                }),
            }),
          }),
        };
      }
      if (table === "shopify_orders") {
        return {
          select: (_c: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.head) {
              const c = {
                eq: () => c,
                gte: () => c,
                lt: () => Promise.resolve({ count: 1000 }),
              };
              return c;
            }
            const c = {
              eq: () => c,
              gte: () => c,
              lt: () => c,
              range: () => Promise.resolve({ data: orderRows }),
            };
            return c;
          },
        };
      }
      if (table === "disputes") {
        const c = {
          eq: () => c,
          gte: () => c,
          lt: () => Promise.resolve({ count: 5 }),
        };
        return { select: () => c };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { sb, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRail.mockResolvedValue({
    card: { orders: 100, disputes: 5, ratePct: 5 },
    alt: { orders: 0, disputes: 0, ratePct: null },
    unknown: { orders: 0, disputes: 0, ratePct: null },
    cardShare: 1,
    cardDisputeShare: 1,
    cardFramingApplies: true,
    unknownShare: 0,
  } as never);
  mockSend.mockResolvedValue({ delivered: true, subject: "s" });
});

describe("triggerOnboardingDigest — idempotency", () => {
  it("sends once and claims the send", async () => {
    const { sb, calls } = buildSb({});
    mockClient.mockReturnValue(sb as never);

    const r = await triggerOnboardingDigest(SHOP);

    expect(r).toEqual({ sent: true, reason: "sent" });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(calls.claimAttempts).toBe(1);
  });

  it("does not send when the column is already stamped", async () => {
    const { sb } = buildSb({ alreadySent: "2026-08-01T00:00:00Z" });
    mockClient.mockReturnValue(sb as never);

    const r = await triggerOnboardingDigest(SHOP);

    expect(r).toEqual({ sent: false, reason: "already_sent" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does not send when another worker wins the claim", async () => {
    // The pre-check passed (column still NULL when read) but the conditional
    // UPDATE matched zero rows — a concurrent worker claimed it in between.
    // This is the race the pre-check alone cannot close.
    const { sb } = buildSb({ claimLost: true });
    mockClient.mockReturnValue(sb as never);

    const r = await triggerOnboardingDigest(SHOP);

    expect(r).toEqual({ sent: false, reason: "already_sent" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("claims BEFORE sending, so a crash between them cannot re-send", async () => {
    // Ordering is the whole guarantee. If the send ran first, a crash before
    // the claim landed would leave the column NULL and the worker's retry
    // would email the merchant a second time.
    const seq: string[] = [];
    const { sb, calls } = buildSb({});
    calls.onClaim = () => seq.push("claim");
    mockClient.mockReturnValue(sb as never);
    mockSend.mockImplementation(async () => {
      seq.push("send");
      return { delivered: true, subject: "s" };
    });

    await triggerOnboardingDigest(SHOP);

    expect(seq).toEqual(["claim", "send"]);
  });

  it("keeps the claim when the send fails, rather than retrying forever", async () => {
    const { sb } = buildSb({});
    mockClient.mockReturnValue(sb as never);
    mockSend.mockResolvedValue({ delivered: false, subject: "s" });

    const r = await triggerOnboardingDigest(SHOP);

    expect(r).toEqual({ sent: false, reason: "send_failed" });
    // One missed digest beats a retry loop that emails the merchant
    // repeatedly; the sender logs the failure.
  });
});

describe("triggerOnboardingDigest — preconditions", () => {
  it("honours the digest opt-out", async () => {
    const { sb } = buildSb({ monthlyDigest: false });
    mockClient.mockReturnValue(sb as never);

    const r = await triggerOnboardingDigest(SHOP);

    expect(r).toEqual({ sent: false, reason: "opted_out" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does not send without a recipient", async () => {
    const { sb } = buildSb({ teamEmail: null });
    mockClient.mockReturnValue(sb as never);

    const r = await triggerOnboardingDigest(SHOP);

    expect(r).toEqual({ sent: false, reason: "no_recipient" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does not send to a shop with no recent orders", async () => {
    const { sb } = buildSb({ orders: 0 });
    mockClient.mockReturnValue(sb as never);

    const r = await triggerOnboardingDigest(SHOP);

    expect(r).toEqual({ sent: false, reason: "no_recent_orders" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("never throws — a failed digest must not fail an import", async () => {
    mockClient.mockImplementation(() => {
      throw new Error("db down");
    });

    await expect(triggerOnboardingDigest(SHOP)).resolves.toEqual({
      sent: false,
      reason: "error",
    });
  });
});
