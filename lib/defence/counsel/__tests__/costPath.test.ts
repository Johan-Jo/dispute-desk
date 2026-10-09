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
import { WRITER_SYSTEM } from "../constitution";
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
// The single writer returns the whole argument; the shipping section here is
// the approved #352543 sentence.
const summaryJson = (s: string) =>
  JSON.stringify({
    summary: [s],
    summaryClaimIds: ["carrier_delivered"],
    sections: { shipping: { text: "The delivery on the card above is the carrier's own scan.", claimIds: ["carrier_delivered"] } },
    conclusion: { text: "The carrier recorded delivery of the order. The non-receipt claim is not supported by the record.", claimIds: ["carrier_delivered"] },
  });
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

// Over the length limit and wrong in no other way.
const LONG_ONLY = `${V12_SUMMARY} The carrier's record and the order record agree with each other, and the record of the later order agrees with both of them.`;

describe("runCounsel", () => {
  it("shortens the summary in one extra call when only its length is still wrong (#100705)", async () => {
    const long = summaryJson(LONG_ONLY);
    callClaudeMessages
      .mockResolvedValueOnce(reply(long))
      .mockResolvedValueOnce(reply(long))
      .mockResolvedValueOnce(reply(long))
      .mockResolvedValueOnce(reply(V12_SUMMARY))
      .mockResolvedValueOnce(reply(CLEAN));
    const res = await runCounsel(runArgs);
    expect(callClaudeMessages).toHaveBeenCalledTimes(5);
    expect(res?.narrative.executiveSummary.text).toBe(V12_SUMMARY);
  });

  it("keeps the refusal when the shortened summary still fails", async () => {
    const long = summaryJson(LONG_ONLY);
    callClaudeMessages
      .mockResolvedValueOnce(reply(long))
      .mockResolvedValueOnce(reply(long))
      .mockResolvedValueOnce(reply(long))
      .mockResolvedValueOnce(reply(LONG_ONLY));
    const res = await runCounsel(runArgs);
    expect(callClaudeMessages).toHaveBeenCalledTimes(4);
    expect(res).toBeNull();
  });

  it("caches the static constitution, reviews on the review model, and records per-call usage", async () => {
    callClaudeMessages
      .mockResolvedValueOnce(reply(summaryJson(V12_SUMMARY), { promptTokens: 1400, cacheWriteTokens: 1200 }))
      .mockResolvedValueOnce(reply(CLEAN, { promptTokens: 900, completionTokens: 20 }));
    const onSpend = vi.fn(async () => {});
    const res = await runCounsel({ ...runArgs, onSpend });
    expect(res?.reused).toBe(false);
    const [writeReq, reviewReq] = callClaudeMessages.mock.calls.map((c) => c[0]);
    expect(writeReq.system).toEqual([{ type: "text", text: WRITER_SYSTEM, cache_control: { type: "ephemeral" } }]);
    expect(writeReq.model).toBe("claude-sonnet-4-6");
    expect(reviewReq.model).toBe(COUNSEL_REVIEW_MODEL);
    expect(reviewReq.system[0].cache_control).toBeUndefined();
    // The case is in the user message, never in the cached block.
    expect(writeReq.messages[0].content).toContain("sixty-one");
    expect(WRITER_SYSTEM).not.toContain("Blume");

    const spend = (onSpend.mock.calls[0] as unknown[])[0] as { stages: Array<{ stage: string; model: string }>; reused: boolean };
    expect(spend.reused).toBe(false);
    expect(spend.stages.map((s) => `${s.stage}:${s.model}`)).toEqual(["write:claude-sonnet-4-6", `review:${COUNSEL_REVIEW_MODEL}`]);
    expect(res?.narrative.counsel?.summary).toEqual([V12_SUMMARY]);
    expect(res?.narrative.executiveSummary.text).toBe(V12_SUMMARY);
    expect(res?.narrative.fulfillmentArgument.text).toMatch(/\n\nCarrier tracking record: https:\/\/track\.northwind\.example\/NW123456789$/);
  });

  it("does not reuse a stored summary: the single writer writes every part (plan §2.7)", async () => {
    callClaudeMessages
      .mockResolvedValueOnce(reply(summaryJson(V12_SUMMARY)))
      .mockResolvedValueOnce(reply(CLEAN))
      .mockResolvedValueOnce(reply(summaryJson(V12_SUMMARY)))
      .mockResolvedValueOnce(reply(CLEAN));
    const first = await runCounsel(runArgs);
    const findReusable = vi.fn(async () => first!.narrative.counsel!.summary);
    const again = await runCounsel({ ...runArgs, findReusable });
    expect(findReusable).not.toHaveBeenCalled();
    expect(again?.reused).toBe(false);
    expect(callClaudeMessages).toHaveBeenCalledTimes(4);
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

/* The run reports what it decided from and why it stopped, letter or not, so
 * the job can store it (plan: defence-package-failure-classes, Phase 0a). */
describe("runCounsel trace", () => {
  it("reports the letter's inputs when a letter is written", async () => {
    callClaudeMessages.mockResolvedValueOnce(reply(summaryJson(V12_SUMMARY))).mockResolvedValueOnce(reply(CLEAN));
    const onTrace = vi.fn();
    const res = await runCounsel({ ...runArgs, onTrace });
    expect(res).not.toBeNull();
    expect(onTrace).toHaveBeenCalledTimes(1);
    const trace = onTrace.mock.calls[0][0];
    expect(trace.outcome).toBe("letter");
    expect(trace.issues).toEqual([]);
    expect(trace.replay.brief).toBe("item_not_received");
    expect(trace.replay.argued).toContain("shipping");
    expect(trace.replay.ledger.map((c: { id: string }) => c.id)).toContain("carrier_delivered");
    expect(trace.replay.lastDraft.summary.paragraphs).toEqual([V12_SUMMARY]);
    expect(trace.replay.inputHash).toMatch(/^[0-9a-f]{16,}$/);
  });

  it("reports the issues that withheld the letter", async () => {
    const long = summaryJson(LONG_ONLY);
    callClaudeMessages
      .mockResolvedValueOnce(reply(long))
      .mockResolvedValueOnce(reply(long))
      .mockResolvedValueOnce(reply(long))
      .mockResolvedValueOnce(reply(LONG_ONLY));
    const onTrace = vi.fn();
    const res = await runCounsel({ ...runArgs, onTrace });
    expect(res).toBeNull();
    const trace = onTrace.mock.calls[0][0];
    expect(trace.outcome).toBe("checks_failed");
    expect(trace.corrected).toBe(true);
    expect(trace.issues.some((i: string) => /words, the limit is/.test(i))).toBe(true);
    expect(trace.replay.lastDraft.summary.paragraphs.join(" ")).toContain("agree with each other");
  });
});
