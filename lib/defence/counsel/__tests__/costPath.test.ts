/**
 * The cost refactor's call budget (docs/plans/counsel-v2-cost-refactor.plan.md):
 * 2 model calls when the first summary passes, at most 4 otherwise, the
 * static prompt cached, the review on COUNSEL_REVIEW_MODEL, and no call at all
 * when a rebuild's inputs are unchanged.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/shopify/makeAuthedRequest", () => ({ makeAuthedRequest: vi.fn(async () => ({ data: null })) }));
const callClaudeMessages = vi.fn();
vi.mock("../../anthropicClient", () => ({ callClaudeMessages: (...a: unknown[]) => callClaudeMessages(...a) }));
vi.mock("../claimLedger", async (orig) => ({
  ...(await orig<typeof import("../claimLedger")>()),
  buildItemNotReceivedLedger: () => LEDGER,
}));

import { COUNSEL_COST_BUDGET_USD, quantile, runCostUsd } from "../cost";
import { writeCounselLetter, type ModelCall } from "../generate";
import { ITEM_NOT_RECEIVED } from "../playbooks";
import { SUMMARY_SYSTEM } from "../prompts";
import { COUNSEL_REVIEW_MODEL, runCounsel } from "../run";
import { CHECK, FACTS, LEDGER, V12_SUMMARY } from "./fixture352543";

const reply = (raw: string, usage: Partial<{ promptTokens: number; completionTokens: number; cachedTokens: number; cacheWriteTokens: number }> = {}) => ({
  raw,
  promptTokens: 1000,
  completionTokens: 150,
  cachedTokens: 0,
  cacheWriteTokens: 0,
  durationMs: 1,
  error: null,
  ...usage,
});
const summaryJson = (s: string) => JSON.stringify({ summary: [s], claimIds: ["carrier_delivered"] });
const CLEAN = JSON.stringify({ errors: [], unclear: [] });
const LONG = `${V12_SUMMARY} The carrier's own scan shows the complete order arrived on time and that everything was in order for the customer.`;

afterEach(() => callClaudeMessages.mockReset());

function scripted(replies: string[]): { call: ModelCall; stages: string[] } {
  const stages: string[] = [];
  const queue = [...replies];
  return {
    stages,
    call: async ({ stage }) => {
      stages.push(stage);
      const r = queue.shift();
      if (r === undefined) throw new Error(`unexpected ${stage} call`);
      return r;
    },
  };
}
const write = (call: ModelCall) =>
  writeCounselLetter({ ledger: LEDGER, playbook: ITEM_NOT_RECEIVED, merchantName: "Blume", pageContext: "Header: …", check: CHECK, call });

describe("counsel call budget", () => {
  it("is two calls (write, review) when the first summary passes", async () => {
    const s = scripted([summaryJson(V12_SUMMARY), CLEAN]);
    const r = await write(s.call);
    expect(s.stages).toEqual(["write", "review"]);
    expect(r.ok).toBe(true);
    expect(r.draft.summary.paragraphs).toEqual([V12_SUMMARY]);
    expect(r.draft.conclusion.paragraphs[0]).toMatch(/^The carrier recorded delivery of the entire order\./);
  });

  it("skips the review when the code checks fail, then makes ONE correction", async () => {
    const s = scripted([summaryJson(LONG), summaryJson(V12_SUMMARY), CLEAN]);
    const r = await write(s.call);
    expect(s.stages).toEqual(["write", "correction", "review"]);
    expect(r.firstIssues.some((i) => i.startsWith("summary:"))).toBe(true);
    expect(r.ok).toBe(true);
  });

  it("corrects once on a review finding and gives up after that (template writer files)", async () => {
    const flagged = JSON.stringify({ errors: [], unclear: [{ sentence: "x", problem: "read twice" }] });
    const s = scripted([summaryJson(V12_SUMMARY), flagged, summaryJson(V12_SUMMARY), flagged]);
    const r = await write(s.call);
    expect(s.stages).toEqual(["write", "review", "correction", "review"]);
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatch(/^unclear:/);
  });
});

const runArgs = {
  shopId: "shop",
  moduleKey: "inr_product_not_received",
  facts: FACTS,
  packSections: [],
  orderName: "#352543",
  orderGid: null,
  disputeGid: "gid://shopify/ShopifyPaymentsDispute/11213897921",
  disputeOpenedAt: "2026-09-19T02:52:00Z",
  disputeAmount: 120.75,
  disputeCurrency: "CAD",
  amountDisplay: "CAD 120.75",
  cardLast4: "3627",
  merchantName: "Blume",
};

describe("runCounsel", () => {
  it("caches the static summary prompt, reviews on the review model, and records per-call usage", async () => {
    callClaudeMessages
      .mockResolvedValueOnce(reply(summaryJson(V12_SUMMARY), { promptTokens: 1400, cacheWriteTokens: 1200 }))
      .mockResolvedValueOnce(reply(CLEAN, { promptTokens: 900, completionTokens: 20 }));
    const onSpend = vi.fn(async () => {});
    const res = await runCounsel({ ...runArgs, onSpend });
    expect(res?.reused).toBe(false);
    const [writeReq, reviewReq] = callClaudeMessages.mock.calls.map((c) => c[0]);
    expect(writeReq.system).toEqual([{ type: "text", text: SUMMARY_SYSTEM, cache_control: { type: "ephemeral" } }]);
    expect(writeReq.model).toBe("claude-sonnet-4-6");
    expect(reviewReq.model).toBe(COUNSEL_REVIEW_MODEL);
    expect(reviewReq.system[0].cache_control).toBeUndefined();
    // The case is in the user message, never in the cached block.
    expect(writeReq.messages[0].content).toContain("sixty-one");
    expect(SUMMARY_SYSTEM).not.toContain("Blume");

    const spend = (onSpend.mock.calls[0] as unknown[])[0] as { stages: Array<{ stage: string; model: string }>; reused: boolean };
    expect(spend.reused).toBe(false);
    expect(spend.stages.map((s) => `${s.stage}:${s.model}`)).toEqual(["write:claude-sonnet-4-6", `review:${COUNSEL_REVIEW_MODEL}`]);
    expect(res?.narrative.counsel?.summary).toEqual([V12_SUMMARY]);
    expect(res?.narrative.executiveSummary.text).toBe(V12_SUMMARY);
    expect(res?.narrative.fulfillmentArgument.text).toMatch(/\n\nCarrier tracking record: https:\/\/track\.northwind\.example\/NW123456789$/);
  });

  it("reuses the previous letter when the inputs are unchanged: no model call", async () => {
    callClaudeMessages
      .mockResolvedValueOnce(reply(summaryJson(V12_SUMMARY)))
      .mockResolvedValueOnce(reply(CLEAN));
    const first = await runCounsel(runArgs);
    const hash = first!.narrative.counsel!.inputHash;
    callClaudeMessages.mockReset();

    const findReusable = vi.fn(async (h: string) => (h === hash ? first!.narrative.counsel!.summary : null));
    const onSpend = vi.fn(async () => {});
    const again = await runCounsel({ ...runArgs, findReusable, onSpend });
    expect(callClaudeMessages).not.toHaveBeenCalled();
    expect(again?.reused).toBe(true);
    expect(again?.narrative.executiveSummary.text).toBe(V12_SUMMARY);
    expect(again?.narrative.counsel?.inputHash).toBe(hash);
    expect((onSpend.mock.calls[0] as unknown[])[0]).toMatchObject({ reused: true, stages: [] });
  });

  it("writes a new letter when anything the letter depends on changed", async () => {
    callClaudeMessages.mockResolvedValueOnce(reply(summaryJson(V12_SUMMARY))).mockResolvedValueOnce(reply(CLEAN));
    const first = await runCounsel(runArgs);
    callClaudeMessages.mockResolvedValueOnce(reply(summaryJson(V12_SUMMARY))).mockResolvedValueOnce(reply(CLEAN));
    const renamed = await runCounsel({ ...runArgs, merchantName: "Blume Box", findReusable: async () => null });
    expect(renamed?.narrative.counsel?.inputHash).not.toBe(first?.narrative.counsel?.inputHash);
    expect(renamed?.reused).toBe(false);
  });

  it("does not reuse a stored summary that fails today's checks", async () => {
    callClaudeMessages.mockResolvedValueOnce(reply(summaryJson(V12_SUMMARY))).mockResolvedValueOnce(reply(CLEAN));
    const res = await runCounsel({ ...runArgs, findReusable: async () => ["The order shipped. Blume Blume."] });
    expect(res?.reused).toBe(false);
    expect(callClaudeMessages).toHaveBeenCalledTimes(2);
  });

  it("records the spend of a run that errors before the job falls back", async () => {
    callClaudeMessages.mockResolvedValueOnce(reply(summaryJson(V12_SUMMARY))).mockResolvedValueOnce({ ...reply(""), raw: null, error: "529" });
    const onSpend = vi.fn(async () => {});
    await expect(runCounsel({ ...runArgs, onSpend })).rejects.toThrow("529");
    expect((onSpend.mock.calls[0] as unknown[])[0]).toMatchObject({ ok: false, reused: false });
  });
});

describe("counsel cost", () => {
  it("prices a typical run inside the budget", () => {
    const usd = runCostUsd([
      { stage: "write", model: "claude-sonnet-4-6", input: 1300, output: 200, cacheRead: 1200, cacheWrite: 0 },
      { stage: "review", model: "claude-haiku-4-5", input: 1200, output: 80, cacheRead: 0, cacheWrite: 0 },
    ]);
    expect(usd).toBeCloseTo(0.0039 + 0.003 + 0.00036 + 0.0012 + 0.0004, 6);
    expect(usd).toBeLessThan(COUNSEL_COST_BUDGET_USD);
  });

  it("prices an unknown model as the writer model, never as free", () => {
    expect(runCostUsd([{ stage: "write", model: "claude-opus-5", input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }])).toBe(3);
  });

  it("takes quantiles by nearest rank", () => {
    expect(quantile([], 0.5)).toBe(0);
    expect(quantile([0.4, 0.01, 0.02], 0.5)).toBe(0.02);
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
  });
});
