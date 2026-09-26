import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({}) }));
import { checkDailyCap } from "../../narrativeWriter";

const fakeSb = (rows: Array<{ prompt_tokens: number; strategy_keys: string[] }>) =>
  ({
    from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: rows, error: null }) }) }) }),
  }) as never;

describe("daily cap with counsel v2 runs", () => {
  it("counts counsel runs as generations but not against the template token cap", async () => {
    const cap = await checkDailyCap(
      fakeSb([
        { prompt_tokens: 180_000, strategy_keys: ["counsel_v2"] },
        { prompt_tokens: 700, strategy_keys: ["item_not_received_delivery_proof_stack"] },
      ]),
      "shop",
    );
    expect(cap).toEqual({ capReached: false, generations: 2, inputTokens: 700, counselRuns: 1 });
  });
});
