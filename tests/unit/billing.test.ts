/**
 * Tests for the billing module.
 *
 * Closes the "Billing automated tests" gap from
 * RELEASE_TESTING_PLAN.md §12. Covers:
 *   - lib/billing/plans.ts — pure plan + top-up lookup
 *   - lib/billing/checkQuota.ts — pack quota gate + feature-access gate
 *   - lib/billing/consumePack.ts — credit consumption + idempotency +
 *     pack-limit error
 *
 * Supabase calls are mocked; this is unit-level coverage. The actual
 * `pack_balance` view + `pack_credits_ledger` semantics live in the
 * DB schema and are exercised by the seeded smoke (`scripts/smoke-test.mjs`).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import {
  PLANS,
  TOP_UPS,
  TRIAL_DAYS,
  TRIAL_INCLUDED_PACKS,
  FREE_LIFETIME_PACKS,
  getPlan,
  getTopUp,
} from "@/lib/billing/plans";
import { checkPackQuota, checkFeatureAccess } from "@/lib/billing/checkQuota";
import {
  consumePack,
  getBalance,
  grantCredits,
  PackLimitReachedError,
} from "@/lib/billing/consumePack";

const mockGetServiceClient = vi.mocked(getServiceClient);

/* ── Pure helpers (no I/O) ────────────────────────────────── */

describe("plans — getPlan", () => {
  it("returns the plan for a known id", () => {
    expect(getPlan("starter").id).toBe("starter");
    expect(getPlan("growth").price).toBe(129);
    expect(getPlan("scale").packsPerMonth).toBe(400);
  });

  it("falls back to free for unknown plan ids (defensive)", () => {
    expect(getPlan("unknown" as string).id).toBe("free");
    expect(getPlan("").id).toBe("free");
  });

  it("free plan exposes packsLifetime, no monthly allowance, autoPack disabled", () => {
    const free = getPlan("free");
    expect(free.packsPerMonth).toBe(0);
    expect(free.packsLifetime).toBe(FREE_LIFETIME_PACKS);
    expect(free.autoPack).toBe(false);
    expect(free.rules).toBe(false);
  });

  it("paid plans enable autoPack + rules", () => {
    for (const planId of ["starter", "growth", "scale"] as const) {
      const plan = PLANS[planId];
      expect(plan.autoPack, `${planId} autoPack`).toBe(true);
      expect(plan.rules, `${planId} rules`).toBe(true);
      expect(plan.trialDays).toBe(TRIAL_DAYS);
    }
  });

  it("growth + scale have unlimited rules (maxRules === null)", () => {
    expect(PLANS.growth.maxRules).toBeNull();
    expect(PLANS.scale.maxRules).toBeNull();
  });

  it("starter caps rules at 5", () => {
    expect(PLANS.starter.maxRules).toBe(5);
  });

  it("trial included packs constant matches the documented contract", () => {
    expect(TRIAL_INCLUDED_PACKS).toBe(25);
  });
});

describe("plans — getTopUp", () => {
  it("returns the top-up for a known sku", () => {
    expect(getTopUp("topup_10")?.packs).toBe(10);
    expect(getTopUp("topup_50")?.priceUsd).toBe(79);
    expect(getTopUp("topup_200")?.packs).toBe(200);
  });

  it("returns undefined for unknown sku", () => {
    expect(getTopUp("nonexistent")).toBeUndefined();
  });

  it("every TOP_UPS entry has a valid sku/label/packs/priceUsd", () => {
    for (const t of TOP_UPS) {
      expect(t.sku).toMatch(/^topup_\d+$/);
      expect(t.label).toContain("packs");
      expect(t.packs).toBeGreaterThan(0);
      expect(t.priceUsd).toBeGreaterThan(0);
    }
  });
});

/* ── checkFeatureAccess (pure) ───────────────────────────── */

describe("checkFeatureAccess", () => {
  it("blocks autoPack on free plan with the documented message", () => {
    const r = checkFeatureAccess("free", "autoPack");
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("Auto-pack");
    expect(r.reason).toContain("Starter");
  });

  it("blocks rules on free plan", () => {
    const r = checkFeatureAccess("free", "rules");
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("Rules");
  });

  it("allows autoPack + rules on paid plans", () => {
    for (const plan of ["starter", "growth", "scale"]) {
      expect(checkFeatureAccess(plan, "autoPack").allowed).toBe(true);
      expect(checkFeatureAccess(plan, "rules").allowed).toBe(true);
    }
  });

  it("falls back to free's restrictions for unknown plan id", () => {
    expect(checkFeatureAccess("unknown", "autoPack").allowed).toBe(false);
  });
});

/* ── Mocked Supabase: checkPackQuota / consumePack / getBalance ─── */

interface MockState {
  shopPlan?: string | null;
  remainingPacks?: number;
  usageCount?: number;
  existingUsageEvent?: Record<string, unknown> | null;
  insertError?: { message: string } | null;
  cycleStart?: string | null;
}

function setupSupabase(state: MockState): {
  insertSpy: ReturnType<typeof vi.fn>;
  ledgerInsertSpy: ReturnType<typeof vi.fn>;
} {
  const insertSpy = vi.fn().mockResolvedValue({
    data: null,
    error: state.insertError ?? null,
  });
  const ledgerInsertSpy = vi.fn().mockResolvedValue({
    data: null,
    error: null,
  });

  const mockFrom = vi.fn((table: string) => {
    if (table === "shops") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: state.shopPlan === undefined ? { plan: "free" } : { plan: state.shopPlan },
          error: null,
        }),
      };
    }
    if (table === "pack_balance") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: state.remainingPacks === undefined
            ? null
            : { remaining_packs: state.remainingPacks },
          error: null,
        }),
      };
    }
    if (table === "pack_usage_events") {
      return {
        select: vi.fn((_cols, opts) => {
          if (opts?.head) {
            // Supabase `head:true, count:'exact'` returns the row count
            // in `count` and leaves `data` null. The production code
            // (post-fix) reads `count`; the chain also supports
            // `.gte("created_at", cycleStart)` for cycle scoping.
            const headResponse = {
              data: null,
              count: state.usageCount ?? 0,
              error: null,
            };
            return {
              eq: vi.fn().mockReturnValue({
                gte: vi.fn().mockResolvedValue(headResponse),
                then: (resolve: (value: typeof headResponse) => unknown) =>
                  resolve(headResponse),
              }),
            };
          }
          return {
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: state.existingUsageEvent ?? null,
              error: null,
            }),
          };
        }),
        insert: insertSpy,
      };
    }
    if (table === "plan_entitlements") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data:
            state.cycleStart === undefined
              ? null
              : { billing_cycle_started_at: state.cycleStart },
          error: null,
        }),
      };
    }
    if (table === "pack_credits_ledger") {
      return { insert: ledgerInsertSpy };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  mockGetServiceClient.mockReturnValue({ from: mockFrom } as never);
  return { insertSpy, ledgerInsertSpy };
}

describe("checkPackQuota", () => {
  beforeEach(() => vi.clearAllMocks());

  it("blocks when remaining balance is 0 with the user-facing reason", async () => {
    setupSupabase({ shopPlan: "free", remainingPacks: 0, usageCount: 3 });
    const r = await checkPackQuota("shop-1");
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
    expect(r.plan).toBe("free");
    expect(r.reason).toContain("Pack limit reached");
  });

  it("allows when remaining balance is at least 1", async () => {
    setupSupabase({ shopPlan: "starter", remainingPacks: 5, usageCount: 10 });
    const r = await checkPackQuota("shop-1");
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(5);
    expect(r.plan).toBe("starter");
  });

  it("derives `limit` from packsLifetime for free, packsPerMonth for paid", async () => {
    setupSupabase({ shopPlan: "free", remainingPacks: 1 });
    const free = await checkPackQuota("shop-1");
    expect(free.limit).toBe(FREE_LIFETIME_PACKS);

    setupSupabase({ shopPlan: "growth", remainingPacks: 70 });
    const growth = await checkPackQuota("shop-1");
    expect(growth.limit).toBe(100);
  });

  it("treats a missing shop row as the free plan (defensive)", async () => {
    setupSupabase({ shopPlan: null, remainingPacks: 1 });
    const r = await checkPackQuota("shop-1");
    expect(r.plan).toBe("free");
  });

  // Regression: the previous implementation read `data` from a
  // `head:true, count:'exact'` query, where `data` is always null —
  // so the merchant-facing "N of <limit> packs used" counter was
  // permanently stuck at 0 even after pack consumption (real-world
  // case: surasvenne.myshopify.com on Growth, 4 consumed, UI showed 0).
  it("reports the consumed usage count, not zero, on paid plans", async () => {
    setupSupabase({
      shopPlan: "growth",
      remainingPacks: 96,
      usageCount: 4,
      cycleStart: "2026-05-15T23:07:00Z",
    });
    const r = await checkPackQuota("shop-1");
    expect(r.used).toBe(4);
    expect(r.limit).toBe(100);
  });
});

describe("consumePack — credit ledger", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts a pack_usage_events row and returns consumed:1, decremented remaining", async () => {
    const { insertSpy } = setupSupabase({
      remainingPacks: 4,
      existingUsageEvent: null,
    });

    const r = await consumePack({
      shopId: "shop-1",
      disputeId: "dispute-1",
      packId: "pack-1",
      eventType: "submit",
    });

    expect(r).toEqual({ ok: true, consumed: 1, remaining: 3 });
    expect(insertSpy).toHaveBeenCalledWith({
      shop_id: "shop-1",
      dispute_id: "dispute-1",
      pack_id: "pack-1",
      event_type: "submit",
      packs: 1,
    });
  });

  it("idempotent: existing (shopId, disputeId, eventType) returns consumed:0 with current balance", async () => {
    const { insertSpy } = setupSupabase({
      remainingPacks: 2,
      existingUsageEvent: { id: "evt-1" },
    });

    const r = await consumePack({
      shopId: "shop-1",
      disputeId: "dispute-1",
      eventType: "submit",
    });

    expect(r).toEqual({ ok: true, consumed: 0, remaining: 2 });
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("throws PackLimitReachedError when balance < 1 (no insert)", async () => {
    const { insertSpy } = setupSupabase({
      remainingPacks: 0,
      existingUsageEvent: null,
    });

    await expect(
      consumePack({
        shopId: "shop-1",
        disputeId: "dispute-1",
        eventType: "finalize",
      }),
    ).rejects.toBeInstanceOf(PackLimitReachedError);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("PackLimitReachedError carries shopId, remaining and the documented code", async () => {
    setupSupabase({ remainingPacks: 0, existingUsageEvent: null });

    try {
      await consumePack({
        shopId: "shop-9",
        disputeId: "dispute-1",
        eventType: "submit",
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PackLimitReachedError);
      const e = err as PackLimitReachedError;
      expect(e.code).toBe("PACK_LIMIT_REACHED");
      expect(e.shopId).toBe("shop-9");
      expect(e.remaining).toBe(0);
    }
  });
});

describe("getBalance + grantCredits", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getBalance returns 0 when pack_balance has no row", async () => {
    setupSupabase({ remainingPacks: undefined });
    expect(await getBalance("shop-1")).toBe(0);
  });

  it("getBalance returns the row's remaining_packs when present", async () => {
    setupSupabase({ remainingPacks: 12 });
    expect(await getBalance("shop-1")).toBe(12);
  });

  it("grantCredits inserts a ledger row with the right shape", async () => {
    const { ledgerInsertSpy } = setupSupabase({});
    await grantCredits({
      shopId: "shop-1",
      source: "topup",
      packs: 10,
      reference: "topup_10",
    });
    expect(ledgerInsertSpy).toHaveBeenCalledWith({
      shop_id: "shop-1",
      source: "topup",
      packs: 10,
      expires_at: null,
      reference: "topup_10",
    });
  });

  it("grantCredits accepts optional expiresAt for trial credits", async () => {
    const { ledgerInsertSpy } = setupSupabase({});
    const expiry = "2026-12-31T00:00:00Z";
    await grantCredits({
      shopId: "shop-1",
      source: "trial",
      packs: TRIAL_INCLUDED_PACKS,
      expiresAt: expiry,
    });
    expect(ledgerInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ expires_at: expiry, source: "trial" }),
    );
  });
});
