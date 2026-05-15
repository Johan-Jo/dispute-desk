/**
 * Tests for `claimBillingBlockedEmailSlot` — the throttle that decides
 * whether to send a merchant email when the automation pipeline
 * blocks a pack for a billing-shaped reason. The throttle protects
 * the merchant from receiving N identical "upgrade" emails when N
 * disputes arrive simultaneously with a depleted quota.
 *
 * Coverage:
 *   1. First blocked dispute → allowed.
 *   2. Same dispute again → denied (per-dispute dedupe).
 *   3. Second different dispute within 6h same reason → denied.
 *   4. Different reason within 6h → allowed.
 *   5. Same reason within 6h but dispute deadline < 72h → allowed (override).
 *   6. Supabase throws → fail-open (allowed).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import {
  claimBillingBlockedEmailSlot,
  BILLING_BLOCKED_EMAIL_THROTTLE_HOURS,
  BILLING_BLOCKED_DEADLINE_OVERRIDE_HOURS,
} from "../billingBlockedEmailThrottle";
import { DISPUTE_ATTENTION_REASONS } from "@/lib/disputes/attentionReasons";

const mockGetClient = vi.mocked(getServiceClient);

interface SbState {
  /** Rows the suite seeds for the per-dispute existence check.
   *  Keyed by (shop_id, dispute_id, event_type='billing_blocked_email_sent'). */
  perDispute: Array<{ shop_id: string; dispute_id: string }>;
  /** Rows for the per-shop recency window. */
  recent: Array<{ event_payload: { reason: string }; created_at: string }>;
  inserts: Array<Record<string, unknown>>;
  throwOn?: "perDisputeSelect" | "recentSelect" | "insert";
}

function buildSb(state: SbState) {
  return {
    from: vi.fn((table: string) => {
      if (table !== "audit_events") return {} as never;

      return {
        // For the per-dispute existence check.
        select: vi.fn((cols: string) => {
          if (cols === "id") {
            return {
              eq: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockImplementation(async () => {
                if (state.throwOn === "perDisputeSelect") {
                  throw new Error("supabase down");
                }
                return {
                  data: state.perDispute.length > 0 ? { id: "x" } : null,
                  error: null,
                };
              }),
              order: vi.fn().mockReturnThis(),
              gte: vi.fn().mockImplementation(() => ({
                order: vi.fn().mockReturnThis(),
                limit: vi.fn().mockImplementation(async () => {
                  if (state.throwOn === "recentSelect") {
                    throw new Error("supabase down");
                  }
                  return { data: state.recent, error: null };
                }),
              })),
            };
          }
          // The recency window query reads "id, event_payload".
          return {
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockImplementation(() => ({
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockImplementation(async () => {
                if (state.throwOn === "recentSelect") {
                  throw new Error("supabase down");
                }
                return { data: state.recent, error: null };
              }),
            })),
          };
        }),
        insert: vi.fn().mockImplementation(async (row) => {
          if (state.throwOn === "insert") {
            throw new Error("supabase down");
          }
          state.inserts.push(row);
          return { data: null, error: null };
        }),
      };
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("claimBillingBlockedEmailSlot", () => {
  it("constants are stable for downstream consumers", () => {
    expect(BILLING_BLOCKED_EMAIL_THROTTLE_HOURS).toBe(6);
    expect(BILLING_BLOCKED_DEADLINE_OVERRIDE_HOURS).toBe(72);
  });

  it("allows the first blocked email + writes the audit row", async () => {
    const state: SbState = { perDispute: [], recent: [], inserts: [] };
    mockGetClient.mockReturnValue(buildSb(state) as never);
    const res = await claimBillingBlockedEmailSlot({
      shopId: "s-1",
      disputeId: "d-1",
      reason: DISPUTE_ATTENTION_REASONS.QUOTA_EXCEEDED,
      disputeDueAt: null,
    });
    expect(res.allowed).toBe(true);
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).toMatchObject({
      event_type: "billing_blocked_email_sent",
      event_payload: { reason: DISPUTE_ATTENTION_REASONS.QUOTA_EXCEEDED },
    });
  });

  it("denies a second claim for the same dispute (per-dispute dedupe)", async () => {
    const state: SbState = {
      perDispute: [{ shop_id: "s-1", dispute_id: "d-1" }],
      recent: [],
      inserts: [],
    };
    mockGetClient.mockReturnValue(buildSb(state) as never);
    const res = await claimBillingBlockedEmailSlot({
      shopId: "s-1",
      disputeId: "d-1",
      reason: DISPUTE_ATTENTION_REASONS.QUOTA_EXCEEDED,
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe("already_sent_for_dispute");
    expect(state.inserts).toHaveLength(0);
  });

  it("denies a different dispute within 6h for the same reason", async () => {
    const state: SbState = {
      perDispute: [],
      recent: [
        {
          event_payload: {
            reason: DISPUTE_ATTENTION_REASONS.QUOTA_EXCEEDED,
          },
          created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        },
      ],
      inserts: [],
    };
    mockGetClient.mockReturnValue(buildSb(state) as never);
    const res = await claimBillingBlockedEmailSlot({
      shopId: "s-1",
      disputeId: "d-2",
      reason: DISPUTE_ATTENTION_REASONS.QUOTA_EXCEEDED,
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe("throttled_same_reason");
    expect(state.inserts).toHaveLength(0);
  });

  it("allows a different reason within the same 6h window", async () => {
    const state: SbState = {
      perDispute: [],
      recent: [
        {
          event_payload: {
            reason: DISPUTE_ATTENTION_REASONS.QUOTA_EXCEEDED,
          },
          created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        },
      ],
      inserts: [],
    };
    mockGetClient.mockReturnValue(buildSb(state) as never);
    const res = await claimBillingBlockedEmailSlot({
      shopId: "s-1",
      disputeId: "d-2",
      reason: DISPUTE_ATTENTION_REASONS.PAYMENT_FAILED,
    });
    expect(res.allowed).toBe(true);
    expect(state.inserts).toHaveLength(1);
  });

  it("overrides the throttle when dispute deadline < 72h", async () => {
    const state: SbState = {
      perDispute: [],
      recent: [
        {
          event_payload: {
            reason: DISPUTE_ATTENTION_REASONS.QUOTA_EXCEEDED,
          },
          created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        },
      ],
      inserts: [],
    };
    mockGetClient.mockReturnValue(buildSb(state) as never);
    const dueIn48h = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const res = await claimBillingBlockedEmailSlot({
      shopId: "s-1",
      disputeId: "d-2",
      reason: DISPUTE_ATTENTION_REASONS.QUOTA_EXCEEDED,
      disputeDueAt: dueIn48h,
    });
    expect(res.allowed).toBe(true);
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).toMatchObject({
      event_payload: { deadline_override: true },
    });
  });

  it("does NOT override when deadline is more than 72h out", async () => {
    const state: SbState = {
      perDispute: [],
      recent: [
        {
          event_payload: {
            reason: DISPUTE_ATTENTION_REASONS.QUOTA_EXCEEDED,
          },
          created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        },
      ],
      inserts: [],
    };
    mockGetClient.mockReturnValue(buildSb(state) as never);
    const dueIn5Days = new Date(
      Date.now() + 5 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const res = await claimBillingBlockedEmailSlot({
      shopId: "s-1",
      disputeId: "d-2",
      reason: DISPUTE_ATTENTION_REASONS.QUOTA_EXCEEDED,
      disputeDueAt: dueIn5Days,
    });
    expect(res.allowed).toBe(false);
  });

  it("fails open on infrastructure error (perDispute select throws)", async () => {
    const state: SbState = {
      perDispute: [],
      recent: [],
      inserts: [],
      throwOn: "perDisputeSelect",
    };
    mockGetClient.mockReturnValue(buildSb(state) as never);
    const res = await claimBillingBlockedEmailSlot({
      shopId: "s-1",
      disputeId: "d-1",
      reason: DISPUTE_ATTENTION_REASONS.QUOTA_EXCEEDED,
    });
    expect(res.allowed).toBe(true);
    expect(res.reason).toBe("throttle_failed_safe");
  });
});
