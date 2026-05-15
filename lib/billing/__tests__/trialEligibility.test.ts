/**
 * Tests for `checkTrialEligibility`. The function is load-bearing —
 * a bug here would either award a second free trial (revenue leak)
 * or deny a real first-time customer (UX-bad). The matrix:
 *
 *   - First-time shop (no entitlement, no ledger): eligible.
 *   - plan_entitlements.trial_started_at set: NOT eligible.
 *   - Pre-Phase-4a: trial-source credit row exists but
 *     trial_started_at is null: NOT eligible.
 *   - DB error: NOT eligible (fail closed).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { checkTrialEligibility } from "../trialEligibility";

const mockGetClient = vi.mocked(getServiceClient);

interface SbConfig {
  entitlement?: { trial_started_at: string | null } | null;
  priorTrialCredit?: { id: string } | null;
  throwOn?: "entitlement" | "ledger";
}

function buildSb(cfg: SbConfig) {
  return {
    from: vi.fn((table: string) => {
      if (table === "plan_entitlements") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockImplementation(async () => {
                if (cfg.throwOn === "entitlement") throw new Error("db down");
                return { data: cfg.entitlement ?? null, error: null };
              }),
            }),
          }),
        };
      }
      if (table === "pack_credits_ledger") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockImplementation(async () => {
                    if (cfg.throwOn === "ledger") throw new Error("db down");
                    return { data: cfg.priorTrialCredit ?? null, error: null };
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return {} as never;
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkTrialEligibility", () => {
  it("first-time shop (no entitlement, no ledger) → eligible", async () => {
    mockGetClient.mockReturnValue(
      buildSb({ entitlement: null, priorTrialCredit: null }) as never,
    );
    const res = await checkTrialEligibility("shop-new");
    expect(res.eligible).toBe(true);
    expect(res.reason).toBe("first_time_subscription");
  });

  it("plan_entitlements.trial_started_at set → NOT eligible", async () => {
    mockGetClient.mockReturnValue(
      buildSb({
        entitlement: { trial_started_at: "2026-04-04T19:14:56Z" },
      }) as never,
    );
    const res = await checkTrialEligibility("shop-trialed");
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("trial_started_at_set");
  });

  it("pre-Phase-4a shop with prior trial credit → NOT eligible", async () => {
    mockGetClient.mockReturnValue(
      buildSb({
        entitlement: { trial_started_at: null },
        priorTrialCredit: { id: "ledger-row" },
      }) as never,
    );
    const res = await checkTrialEligibility("shop-legacy");
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("prior_trial_credit");
  });

  it("entitlement exists but trial_started_at null AND no ledger row → eligible", async () => {
    // Edge case: someone created the row directly without setting
    // trial_started_at and didn't grant credits. Should still be
    // treated as a fresh shop.
    mockGetClient.mockReturnValue(
      buildSb({
        entitlement: { trial_started_at: null },
        priorTrialCredit: null,
      }) as never,
    );
    const res = await checkTrialEligibility("shop-edge");
    expect(res.eligible).toBe(true);
    expect(res.reason).toBe("first_time_subscription");
  });

  it("DB error on entitlement lookup → NOT eligible (fail closed)", async () => {
    mockGetClient.mockReturnValue(
      buildSb({ throwOn: "entitlement" }) as never,
    );
    const res = await checkTrialEligibility("shop-x");
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("lookup_failed");
  });

  it("DB error on ledger lookup → NOT eligible (fail closed)", async () => {
    mockGetClient.mockReturnValue(
      buildSb({
        entitlement: { trial_started_at: null },
        throwOn: "ledger",
      }) as never,
    );
    const res = await checkTrialEligibility("shop-y");
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("lookup_failed");
  });
});
