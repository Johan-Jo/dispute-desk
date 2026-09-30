/**
 * The generation budget knows counsel's daily run cap, and a bulk re-queue is
 * sized to it. Mein Maison 2026-09-30: the returns-outside-Shopify toggle
 * queued ~20 rebuilds, counsel's 25-run cap ran out, and two packages failed
 * `daily_cap_reached` while the budget read (template-writer caps only, and
 * counting counsel's tokens against the template token cap) was wrong both ways.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({}) }));

import { budgetFromUsage, fitBatchToBudget } from "../generationBudget";
import { COUNSEL_DAILY_RUN_CAP } from "../counsel/run";
import { deferredRunAt } from "@/lib/disputes/requeueOpenPackBuilds";

describe("budgetFromUsage", () => {
  it("binds on counsel runs when counsel has used its day", () => {
    const b = budgetFromUsage({ generations: COUNSEL_DAILY_RUN_CAP, inputTokens: 0, counselRuns: COUNSEL_DAILY_RUN_CAP });
    expect(b.exhausted).toBe(true);
    expect(b.bindingLimit).toBe("counsel_runs");
  });

  it("leaves exactly the counsel runs that remain", () => {
    const b = budgetFromUsage({ generations: 5, inputTokens: 0, counselRuns: 5 });
    expect(b.remaining).toBe(COUNSEL_DAILY_RUN_CAP - 5);
    expect(fitBatchToBudget(Array.from({ length: 30 }, (_, i) => i), b).batch).toHaveLength(COUNSEL_DAILY_RUN_CAP - 5);
  });

  it("has headroom on a fresh day", () => {
    const b = budgetFromUsage({ generations: 0, inputTokens: 0, counselRuns: 0 });
    expect(b.exhausted).toBe(false);
    expect(b.remaining).toBe(COUNSEL_DAILY_RUN_CAP);
  });
});

describe("deferredRunAt", () => {
  const now = new Date("2026-09-30T12:08:56Z");

  it("puts the first day's share just after the next cap reset", () => {
    expect(deferredRunAt(now, 0, 25)).toBe("2026-10-01T00:30:00.000Z");
    expect(deferredRunAt(now, 24, 25)).toBe("2026-10-01T00:30:00.000Z");
  });

  it("spills past one day's cap onto the next day", () => {
    expect(deferredRunAt(now, 25, 25)).toBe("2026-10-02T00:30:00.000Z");
  });
});
