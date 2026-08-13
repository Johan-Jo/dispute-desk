/**
 * The daily generation budget is readable BEFORE work is enqueued.
 *
 * ── WHAT IT PREVENTS ──────────────────────────────────────────────────
 *
 * `narrativeWriter` has always enforced the per-shop daily cap, but only at
 * the moment of generation — by which point a `build_pack` has rebuilt the
 * pack, inserted a defence-package draft and chained a
 * `build_defence_package`. The refusal lands as a `failed` row sitting ABOVE
 * the case's last good package.
 *
 * Nothing upstream could see the budget, so a bulk rebuild was a blind bet.
 * Measured on production 2026-08-12/13, three batches were enqueued against an
 * already-spent budget:
 *
 *   43 packs  exhausted the day's tokens (51 026 / 50 000) partway through
 *    6 packs  the capped disputes, re-enqueued — failed again
 *   11 packs  the post-v14 rebuild — 10 of 11 died without generating
 *
 * ── THE ARITHMETIC THAT MATTERS ───────────────────────────────────────
 *
 * Two limits bind independently, and the TOKEN limit is the one that bit: on
 * 2026-08-12 the shop was at 44/100 generations — nowhere near the generation
 * cap — while already 1 026 tokens OVER the token cap. A guard that checked
 * only the generation count would have waved all three batches through.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));

import { getServiceClient } from "@/lib/supabase/server";
import {
  readGenerationBudget,
  describeBudget,
  fitBatchToBudget,
  DAILY_GENERATION_CAP,
  DAILY_TOKEN_CAP,
} from "@/lib/defence/generationBudget";

const mockSb = vi.mocked(getServiceClient);

/** Stub `defence_package_runs` with N rows of `tokensEach` prompt tokens. */
function withRuns(rows: Array<{ prompt_tokens: number }> | null, error?: string) {
  mockSb.mockReturnValue({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ data: rows, error: error ? { message: error } : null }),
        }),
      }),
    }),
  } as never);
}

beforeEach(() => mockSb.mockReset());

describe("a fresh day", () => {
  it("reports the full budget", async () => {
    withRuns([]);
    const b = await readGenerationBudget("shop-1");
    expect(b.generationsUsed).toBe(0);
    expect(b.tokensUsed).toBe(0);
    expect(b.exhausted).toBe(false);
    expect(b.remaining).toBeGreaterThan(0);
  });
});

describe("the token limit binds before the generation limit", () => {
  it("THE PRODUCTION CASE: 44/100 generations but over the token cap", async () => {
    /* The exact shape that let three batches through. A generation-count
     * check alone reads this as 56 builds of headroom. */
    withRuns(Array.from({ length: 44 }, () => ({ prompt_tokens: 1160 })));
    const b = await readGenerationBudget("shop-1");
    expect(b.generationsUsed).toBe(44);
    expect(b.tokensUsed).toBeGreaterThan(DAILY_TOKEN_CAP);
    expect(b.exhausted, "must be exhausted despite 56 generations of nominal headroom").toBe(true);
    expect(b.remaining).toBe(0);
    expect(b.bindingLimit).toBe("tokens");
  });

  it("names tokens as the binding limit while headroom remains", async () => {
    // Heavy prompts: few generations, most of the token budget gone.
    withRuns(Array.from({ length: 10 }, () => ({ prompt_tokens: 4000 })));
    const b = await readGenerationBudget("shop-1");
    expect(b.exhausted).toBe(false);
    expect(b.bindingLimit).toBe("tokens");
    expect(b.remaining).toBeLessThan(DAILY_GENERATION_CAP - 10);
  });

  it("names generations when THAT is the binding limit", async () => {
    // Cheap prompts: the generation count runs out first.
    withRuns(Array.from({ length: DAILY_GENERATION_CAP - 3 }, () => ({ prompt_tokens: 1 })));
    const b = await readGenerationBudget("shop-1");
    expect(b.remaining).toBe(3);
    expect(b.bindingLimit).toBe("generations");
  });
});

describe("it never reports a negative budget", () => {
  it("clamps at zero when both limits are blown", async () => {
    withRuns(Array.from({ length: DAILY_GENERATION_CAP + 20 }, () => ({ prompt_tokens: 5000 })));
    const b = await readGenerationBudget("shop-1");
    expect(b.remaining).toBe(0);
    expect(b.exhausted).toBe(true);
  });

  it("tolerates null prompt_tokens rather than producing NaN", async () => {
    withRuns([{ prompt_tokens: null }, { prompt_tokens: 500 }] as never);
    const b = await readGenerationBudget("shop-1");
    expect(Number.isFinite(b.tokensUsed)).toBe(true);
    expect(b.tokensUsed).toBe(500);
    expect(Number.isFinite(b.remaining)).toBe(true);
  });
});

describe("a failed read fails OPEN", () => {
  it("does not block a rebuild — narrativeWriter still enforces the real cap", async () => {
    withRuns(null, "connection reset");
    const b = await readGenerationBudget("shop-1");
    expect(b.exhausted).toBe(false);
    expect(b.remaining).toBe(DAILY_GENERATION_CAP);
  });
});

describe("fitBatchToBudget reports the deferral rather than truncating silently", () => {
  const ten = Array.from({ length: 10 }, (_, i) => `pack-${i}`);

  it("splits the batch at the remaining budget", () => {
    const { batch, deferred } = fitBatchToBudget(ten, {
      generationsUsed: 0, tokensUsed: 0, remaining: 4, exhausted: false, bindingLimit: "tokens",
    });
    expect(batch).toHaveLength(4);
    expect(deferred).toHaveLength(6);
    // Nothing is lost — a caller can report exactly what was held back.
    expect([...batch, ...deferred]).toEqual(ten);
  });

  it("defers everything when the budget is exhausted", () => {
    const { batch, deferred } = fitBatchToBudget(ten, {
      generationsUsed: 44, tokensUsed: 51026, remaining: 0, exhausted: true, bindingLimit: "tokens",
    });
    expect(batch).toEqual([]);
    expect(deferred).toEqual(ten);
  });
});

describe("describeBudget says the number out loud", () => {
  it("an exhausted budget states the consequence, not just the state", async () => {
    /* The failure mode looked like silence — packages failing one at a time
     * with no operator signal — so the message has to say what happens next. */
    const msg = describeBudget({
      generationsUsed: 44, tokensUsed: 51026, remaining: 0, exhausted: true, bindingLimit: "tokens",
    });
    expect(msg).toMatch(/exhausted/i);
    expect(msg).toMatch(/fail without generating/i);
    expect(msg).toMatch(/00:00 UTC/);
  });

  it("a healthy budget names the count and the binding limit", () => {
    const msg = describeBudget({
      generationsUsed: 5, tokensUsed: 6000, remaining: 31, exhausted: false, bindingLimit: "tokens",
    });
    expect(msg).toContain("31");
    expect(msg).toContain("tokens");
  });
});
