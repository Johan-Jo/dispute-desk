import { describe, it, expect, vi } from "vitest";
import { compareWeekOverWeek } from "@/lib/signal-radar/trends";
import { SIGNAL_CATEGORIES } from "@/lib/signal-radar/schema";

function mockSb(byCategory: Record<string, { current: number; prior: number }>) {
  function makeChain() {
    const state: { category: string | null; usePrior: boolean } = {
      category: null,
      usePrior: false,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((k: string, v: string) => {
      if (k === "category") state.category = v;
      return chain;
    });
    chain.gt = vi.fn(() => {
      const result = chain;
      // Once gt fires, the chain is awaitable (current path) AND extendable via lte (prior path).
      // Add then() so awaiting gt resolves to current; .lte() switches to prior and re-defines then.
      chain.then = (resolve: (r: { count: number }) => unknown) => {
        if (state.usePrior) {
          resolve({ count: byCategory[state.category!]?.prior ?? 0 });
        } else {
          resolve({ count: byCategory[state.category!]?.current ?? 0 });
        }
        return undefined;
      };
      return result;
    });
    chain.lte = vi.fn(() => {
      state.usePrior = true;
      return chain;
    });
    return chain;
  }
  return {
    from: vi.fn(() => makeChain()),
  };
}

describe("compareWeekOverWeek", () => {
  it("computes percentage delta and direction", async () => {
    const sb = mockSb({
      transparency_frustration: { current: 38, prior: 24 },
      reserve_fear: { current: 22, prior: 18 },
      migration_intent: { current: 0, prior: 0 },
    });
    // @ts-expect-error mock sb
    const result = await compareWeekOverWeek(sb);
    const transparency = result.find((r) => r.category === "transparency_frustration");
    expect(transparency).toBeDefined();
    expect(transparency!.current_7d).toBe(38);
    expect(transparency!.prior_7d).toBe(24);
    expect(transparency!.direction).toBe("up");
    expect(transparency!.delta_pct).toBeGreaterThan(0);
  });

  it("flags zero-prior categories as 'new'", async () => {
    const sb = mockSb({
      reserve_fear: { current: 5, prior: 0 },
    });
    // @ts-expect-error mock sb
    const result = await compareWeekOverWeek(sb);
    const r = result.find((row) => row.category === "reserve_fear");
    expect(r).toBeDefined();
    expect(r!.direction).toBe("new");
  });

  it("filters out categories with zero current AND zero prior", async () => {
    const sb = mockSb({});
    // @ts-expect-error mock sb
    const result = await compareWeekOverWeek(sb);
    expect(result.length).toBe(0);
  });

  it("returns at most 10 entries", async () => {
    const all: Record<string, { current: number; prior: number }> = {};
    for (const c of SIGNAL_CATEGORIES) {
      all[c] = { current: 5, prior: 1 };
    }
    const sb = mockSb(all);
    // @ts-expect-error mock sb
    const result = await compareWeekOverWeek(sb);
    expect(result.length).toBeLessThanOrEqual(10);
  });

  it("classifies small deltas as flat", async () => {
    const sb = mockSb({ reserve_fear: { current: 10, prior: 10 } });
    // @ts-expect-error mock sb
    const result = await compareWeekOverWeek(sb);
    const r = result.find((row) => row.category === "reserve_fear");
    expect(r!.direction).toBe("flat");
  });
});
