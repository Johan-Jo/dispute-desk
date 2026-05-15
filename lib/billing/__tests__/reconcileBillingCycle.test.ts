/**
 * Tests for `reconcileBillingCycleForShop`.
 *
 * Coverage targets per PRD Phase 2 acceptance criteria:
 *   1. Active Shopify subscription → monthly credits granted once.
 *   2. Duplicate run (cron + webhook race) → no duplicate credits.
 *   3. No active Shopify subscription → local state transitions to
 *      `expired`; cancelled / expired states are not downgraded.
 *   4. Uninstalled shop → skipped, no Shopify call.
 *   5. Defensive PENDING mapping (covered by subscriptionState tests
 *      directly; reconciler delegates to that mapper).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/shopify/makeAuthedRequest", () => ({
  makeAuthedRequest: vi.fn(),
}));
vi.mock("@/lib/billing/consumePack", () => ({
  grantCredits: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { makeAuthedRequest } from "@/lib/shopify/makeAuthedRequest";
import { grantCredits } from "@/lib/billing/consumePack";
import {
  reconcileBillingCycleForShop,
  monthlyGrantReference,
} from "../reconcileBillingCycle";

const mockGetClient = vi.mocked(getServiceClient);
const mockRequest = vi.mocked(makeAuthedRequest);
const mockGrant = vi.mocked(grantCredits);

interface SbState {
  shop: { uninstalled_at: string | null } | null;
  session: { id: string } | null;
  entitlement: {
    shop_id: string;
    plan_key: string;
    trial_ends_at: string | null;
    billing_cycle_started_at: string | null;
    billing_cycle_ends_at: string | null;
    subscription_state: string | null;
    shopify_subscription_gid: string | null;
  } | null;
  existingLedgerForReference: { id: string } | null;
  updates: Array<{ table: string; row: Record<string, unknown> }>;
  inserts: Array<{ table: string; row: Record<string, unknown> }>;
}

function buildSb(state: SbState) {
  const sb = {
    from: vi.fn((table: string) => {
      if (table === "shops") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: state.shop,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "shop_sessions") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: state.session,
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "plan_entitlements") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: state.entitlement,
                error: null,
              }),
            }),
          }),
          update: vi.fn().mockImplementation((row) => {
            return {
              eq: vi.fn().mockImplementation(async () => {
                state.updates.push({ table: "plan_entitlements", row });
                return { data: null, error: null };
              }),
            };
          }),
        };
      }
      if (table === "pack_credits_ledger") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: state.existingLedgerForReference,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "audit_events") {
        return {
          insert: vi.fn().mockImplementation(async (row) => {
            state.inserts.push({ table: "audit_events", row });
            return { data: null, error: null };
          }),
        };
      }
      return {} as never;
    }),
  };
  return sb;
}

function shopifyResponse(
  status: string,
  currentPeriodEnd: string | null = "2026-07-01T00:00:00Z",
) {
  return {
    data: {
      currentAppInstallation: {
        id: "gid://shopify/AppInstallation/1",
        activeSubscriptions:
          status === "NONE"
            ? []
            : [
                {
                  id: "gid://shopify/AppSubscription/100",
                  name: "Growth",
                  status,
                  currentPeriodEnd,
                  trialDays: 14,
                  test: true,
                  createdAt: "2026-05-01T00:00:00Z",
                  lineItems: [],
                },
              ],
      },
    },
  };
}

const NOW = new Date("2026-06-01T00:00:00Z");

const BASE_ENTITLEMENT: SbState["entitlement"] = {
  shop_id: "shop-1",
  plan_key: "growth",
  trial_ends_at: "2026-04-18T00:00:00Z",
  billing_cycle_started_at: "2026-05-04T00:00:00Z",
  billing_cycle_ends_at: "2026-06-04T00:00:00Z",
  subscription_state: "active",
  shopify_subscription_gid: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reconcileBillingCycleForShop", () => {
  it("skips uninstalled shops without calling Shopify", async () => {
    const state: SbState = {
      shop: { uninstalled_at: "2026-04-01T00:00:00Z" },
      session: null,
      entitlement: null,
      existingLedgerForReference: null,
      updates: [],
      inserts: [],
    };
    mockGetClient.mockReturnValue(buildSb(state) as never);

    const res = await reconcileBillingCycleForShop({
      shopId: "shop-1",
      now: NOW,
    });
    expect(res).toEqual({ ok: true, action: "skipped_uninstalled" });
    expect(mockRequest).not.toHaveBeenCalled();
    expect(mockGrant).not.toHaveBeenCalled();
  });

  it("skips when no offline session, marks reconciliation tick", async () => {
    const state: SbState = {
      shop: { uninstalled_at: null },
      session: null,
      entitlement: BASE_ENTITLEMENT,
      existingLedgerForReference: null,
      updates: [],
      inserts: [],
    };
    mockGetClient.mockReturnValue(buildSb(state) as never);

    const res = await reconcileBillingCycleForShop({
      shopId: "shop-1",
      now: NOW,
    });
    expect(res).toEqual({ ok: true, action: "skipped_no_session" });
    expect(state.updates).toContainEqual(
      expect.objectContaining({ table: "plan_entitlements" }),
    );
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("active sub → grants monthly credits exactly once and bumps cycle end", async () => {
    const state: SbState = {
      shop: { uninstalled_at: null },
      session: { id: "sess-1" },
      entitlement: BASE_ENTITLEMENT,
      existingLedgerForReference: null,
      updates: [],
      inserts: [],
    };
    mockGetClient.mockReturnValue(buildSb(state) as never);
    mockRequest.mockResolvedValue(shopifyResponse("ACTIVE") as never);

    const res = await reconcileBillingCycleForShop({
      shopId: "shop-1",
      now: NOW,
    });

    expect(res.ok).toBe(true);
    if (res.ok && res.action === "credits_granted") {
      expect(res.packs).toBe(75); // Growth plan packsPerMonth
      expect(res.cycleEndIso).toBe("2026-07-01T00:00:00Z");
    } else {
      throw new Error(`expected credits_granted, got ${JSON.stringify(res)}`);
    }
    expect(mockGrant).toHaveBeenCalledTimes(1);
    expect(mockGrant.mock.calls[0][0]).toMatchObject({
      shopId: "shop-1",
      source: "monthly_included",
      packs: 75,
      expiresAt: "2026-07-01T00:00:00Z",
      reference: monthlyGrantReference("shop-1", "2026-07-01T00:00:00Z"),
    });
    // Audit event for the grant.
    const auditTypes = state.inserts.map(
      (i) => (i.row as { event_type: string }).event_type,
    );
    expect(auditTypes).toContain("monthly_credits_granted");
    // Plan entitlement updated with the cycle end Shopify just reported.
    const planUpdate = state.updates.find(
      (u) => u.table === "plan_entitlements",
    );
    expect(planUpdate?.row).toMatchObject({
      billing_cycle_ends_at: "2026-07-01T00:00:00Z",
      shopify_subscription_gid: "gid://shopify/AppSubscription/100",
    });
  });

  it("duplicate run (existing ledger row) does not double-grant", async () => {
    const reference = monthlyGrantReference("shop-1", "2026-07-01T00:00:00Z");
    const state: SbState = {
      shop: { uninstalled_at: null },
      session: { id: "sess-1" },
      entitlement: BASE_ENTITLEMENT,
      existingLedgerForReference: { id: "ledger-existing" },
      updates: [],
      inserts: [],
    };
    mockGetClient.mockReturnValue(buildSb(state) as never);
    mockRequest.mockResolvedValue(shopifyResponse("ACTIVE") as never);

    const res = await reconcileBillingCycleForShop({
      shopId: "shop-1",
      now: NOW,
    });
    expect(res.ok).toBe(true);
    if (res.ok && res.action === "credits_duplicate") {
      expect(res.state).toBe("active");
    } else {
      throw new Error(
        `expected credits_duplicate, got ${JSON.stringify(res)}`,
      );
    }
    expect(mockGrant).not.toHaveBeenCalled();
    // No monthly_credits_granted audit on duplicate path.
    const auditTypes = state.inserts.map(
      (i) => (i.row as { event_type: string }).event_type,
    );
    expect(auditTypes).not.toContain("monthly_credits_granted");
    // reference value verified via the SELECT path inside the SB mock
    expect(reference).toBe("monthly_shop-1_2026-07-01T00:00:00Z");
  });

  it("unique-violation on grant insert is treated as duplicate", async () => {
    const state: SbState = {
      shop: { uninstalled_at: null },
      session: { id: "sess-1" },
      entitlement: BASE_ENTITLEMENT,
      existingLedgerForReference: null,
      updates: [],
      inserts: [],
    };
    mockGetClient.mockReturnValue(buildSb(state) as never);
    mockRequest.mockResolvedValue(shopifyResponse("ACTIVE") as never);
    mockGrant.mockRejectedValueOnce(
      new Error('duplicate key value violates unique constraint "..." (23505)'),
    );

    const res = await reconcileBillingCycleForShop({
      shopId: "shop-1",
      now: NOW,
    });
    expect(res.ok).toBe(true);
    if (!res.ok || res.action !== "credits_duplicate") {
      throw new Error(
        `expected credits_duplicate, got ${JSON.stringify(res)}`,
      );
    }
  });

  it("no active subscription transitions active → expired with audit", async () => {
    const state: SbState = {
      shop: { uninstalled_at: null },
      session: { id: "sess-1" },
      entitlement: BASE_ENTITLEMENT,
      existingLedgerForReference: null,
      updates: [],
      inserts: [],
    };
    mockGetClient.mockReturnValue(buildSb(state) as never);
    mockRequest.mockResolvedValue(shopifyResponse("NONE") as never);

    const res = await reconcileBillingCycleForShop({
      shopId: "shop-1",
      now: NOW,
    });
    expect(res.ok).toBe(true);
    if (res.ok && res.action === "state_transition") {
      expect(res.from).toBe("active");
      expect(res.to).toBe("expired");
    } else {
      throw new Error(
        `expected state_transition, got ${JSON.stringify(res)}`,
      );
    }
    const update = state.updates.find(
      (u) => u.table === "plan_entitlements",
    );
    expect(update?.row).toMatchObject({
      subscription_state: "expired",
    });
    const auditTypes = state.inserts.map(
      (i) => (i.row as { event_type: string }).event_type,
    );
    expect(auditTypes).toContain("subscription_state_changed");
  });

  it("no active subscription does NOT downgrade cancelled → expired", async () => {
    const state: SbState = {
      shop: { uninstalled_at: null },
      session: { id: "sess-1" },
      entitlement: { ...BASE_ENTITLEMENT, subscription_state: "cancelled" },
      existingLedgerForReference: null,
      updates: [],
      inserts: [],
    };
    mockGetClient.mockReturnValue(buildSb(state) as never);
    mockRequest.mockResolvedValue(shopifyResponse("NONE") as never);

    const res = await reconcileBillingCycleForShop({
      shopId: "shop-1",
      now: NOW,
    });
    expect(res.ok).toBe(true);
    if (!res.ok || res.action !== "no_change") {
      throw new Error(
        `expected no_change, got ${JSON.stringify(res)}`,
      );
    }
    expect((res as { state: string }).state).toBe("cancelled");
    // No audit row written for a no-op.
    const auditTypes = state.inserts.map(
      (i) => (i.row as { event_type: string }).event_type,
    );
    expect(auditTypes).not.toContain("subscription_state_changed");
  });

  it("FROZEN active subscription transitions active → grace", async () => {
    const state: SbState = {
      shop: { uninstalled_at: null },
      session: { id: "sess-1" },
      entitlement: BASE_ENTITLEMENT,
      existingLedgerForReference: { id: "existing" }, // skip grant in this test
      updates: [],
      inserts: [],
    };
    mockGetClient.mockReturnValue(buildSb(state) as never);
    mockRequest.mockResolvedValue(shopifyResponse("FROZEN") as never);

    const res = await reconcileBillingCycleForShop({
      shopId: "shop-1",
      now: NOW,
    });
    expect(res.ok).toBe(true);
    if (!res.ok || res.action !== "state_transition") {
      throw new Error(
        `expected state_transition, got ${JSON.stringify(res)}`,
      );
    }
    expect(res.to).toBe("grace");
    const update = state.updates.find(
      (u) => u.table === "plan_entitlements",
    );
    expect(update?.row).toMatchObject({
      subscription_state: "grace",
    });
    expect(update?.row.grace_entered_at).toBeTruthy();
  });

  it("PENDING with stale trial_ends_at maps to expired (defensive)", async () => {
    const state: SbState = {
      shop: { uninstalled_at: null },
      session: { id: "sess-1" },
      // trial_ends_at is in the past — defensive rule must not let
      // PENDING upgrade this to trialing.
      entitlement: BASE_ENTITLEMENT,
      existingLedgerForReference: null,
      updates: [],
      inserts: [],
    };
    mockGetClient.mockReturnValue(buildSb(state) as never);
    mockRequest.mockResolvedValue(shopifyResponse("PENDING") as never);

    const res = await reconcileBillingCycleForShop({
      shopId: "shop-1",
      now: NOW,
    });
    if (!res.ok || res.action !== "state_transition") {
      throw new Error(
        `expected state_transition, got ${JSON.stringify(res)}`,
      );
    }
    expect(res.to).toBe("expired");
    // Importantly, no monthly_credits_granted audit fires for expired.
    const auditTypes = state.inserts.map(
      (i) => (i.row as { event_type: string }).event_type,
    );
    expect(auditTypes).not.toContain("monthly_credits_granted");
  });
});
