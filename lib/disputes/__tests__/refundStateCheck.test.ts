/**
 * The sequencing of the refund-state check: read, store, decide, re-read, send, record.
 * The properties that keep the email honest: a failed read sends nothing; a send is confirmed by a second read;
 * dry-run writes and sends nothing; a repeat email is worse than a late one.
 */
import { describe, expect, it } from "vitest";
import { runRefundStateCheck, type RefundCheckCandidate, type RefundCheckDeps, type RefundCheckOptions } from "../refundStateCheck";
import type { RefundState } from "../refundState";

const state = (kind: RefundState["kind"], patch: Partial<RefundState> = {}): RefundState => ({
  kind,
  reason: kind === "unknown" ? "truncated" : null,
  pendingAmount: 0,
  settledAmount: 0,
  failedAmount: 0,
  currency: "SEK",
  firstRefundAt: null,
  settledAt: null,
  stalledPending: false,
  settlements: [],
  returnStatus: "IN_PROGRESS",
  paymentGateways: ["shopify_payments"],
  financialStatus: "PAID",
  ...patch,
});

const cand = (id: string, patch: Partial<RefundCheckCandidate> = {}): RefundCheckCandidate => ({
  disputeId: id,
  shopId: "shop-1",
  shopDomain: "whj8db-1q.myshopify.com",
  orderGid: `gid://shopify/Order/${id}`,
  orderName: `#${id}`,
  phase: "inquiry",
  status: "needs_response",
  reason: "CREDIT_NOT_PROCESSED",
  amount: 599,
  currencyCode: "SEK",
  dueAt: "2026-11-27T23:00:00Z",
  responseCycle: 1,
  paymentMethod: "klarna",
  optedOut: false,
  teamEmail: "team@example.com",
  locale: "sv",
  alreadySent: false,
  lastCheckedAt: null,
  ...patch,
});

const OPTS: RefundCheckOptions = { emailsEnabled: true, dryRun: false, budgetMs: 1_000_000, perShopCap: 5, minRecheckMs: 90 * 60_000 };

function harness(reads: Record<string, Array<RefundState | Error>>, over: Partial<RefundCheckDeps> = {}) {
  const log = { saved: [] as string[], sent: [] as string[], recorded: [] as string[] };
  const idx: Record<string, number> = {};
  const deps: RefundCheckDeps = {
    now: () => 1_000_000,
    readState: async (c) => {
      const list = reads[c.disputeId];
      const i = Math.min(idx[c.disputeId] ?? 0, list.length - 1);
      idx[c.disputeId] = (idx[c.disputeId] ?? 0) + 1;
      const r = list[i];
      if (r instanceof Error) throw r;
      return r;
    },
    saveState: async (c, s) => void log.saved.push(`${c.disputeId}:${s.kind}`),
    send: async (c, variant) => (log.sent.push(`${c.disputeId}:${variant}`), { ok: true }),
    recordSent: async (c) => void log.recorded.push(c.disputeId),
    ...over,
  };
  return { deps, log };
}

describe("runRefundStateCheck", () => {
  it("sends once for a no-refund case and records the dedupe row", async () => {
    const { deps, log } = harness({ a: [state("none")] });
    const s = await runRefundStateCheck([cand("a")], deps, OPTS);
    expect(s.sent).toBe(1);
    expect(log.sent).toEqual(["a:none"]);
    expect(log.recorded).toEqual(["a"]);
    expect(log.saved).toContain("a:none");
  });

  it("does not send for a refund that is pending, and stores the state for the page", async () => {
    const { deps, log } = harness({ a: [state("pending", { pendingAmount: 529 })] });
    const s = await runRefundStateCheck([cand("a")], deps, OPTS);
    expect(s.sent).toBe(0);
    expect(s.skips.state_pending).toBe(1);
    expect(log.saved).toEqual(["a:pending"]);
    expect(log.sent).toEqual([]);
  });

  it("confirms with a second read: a merchant who refunds in between is not emailed", async () => {
    const { deps, log } = harness({ a: [state("none"), state("pending", { pendingAmount: 599 })] });
    const s = await runRefundStateCheck([cand("a")], deps, OPTS);
    expect(s.sent).toBe(0);
    expect(s.racedBeforeSend).toBe(1);
    expect(log.sent).toEqual([]);
    expect(log.saved).toEqual(["a:none", "a:pending"]);
  });

  it("a failed read sends nothing and stores nothing for that dispute; the others still run", async () => {
    const { deps, log } = harness({ a: [new Error("throttled")], b: [state("none")] });
    const s = await runRefundStateCheck([cand("a"), cand("b")], deps, OPTS);
    expect(s.readErrors).toEqual([{ disputeId: "a", error: "throttled" }]);
    expect(log.saved).toEqual(["b:none"]);
    expect(log.sent).toEqual(["b:none"]);
  });

  it("dry run reads and decides but writes and sends nothing", async () => {
    const { deps, log } = harness({ a: [state("none")] });
    const s = await runRefundStateCheck([cand("a")], deps, { ...OPTS, dryRun: true });
    expect(s.wouldSend).toEqual([{ disputeId: "a", orderName: "#a", variant: "none" }]);
    expect(log.saved).toEqual([]);
    expect(log.sent).toEqual([]);
    expect(log.recorded).toEqual([]);
  });

  it("the kill switch stops sends but not the state snapshots", async () => {
    const { deps, log } = harness({ a: [state("none")] });
    const s = await runRefundStateCheck([cand("a")], deps, { ...OPTS, emailsEnabled: false });
    expect(s.skips.disabled).toBe(1);
    expect(log.saved).toEqual(["a:none"]);
    expect(log.sent).toEqual([]);
  });

  it("caps sends per shop and counts the deferred ones", async () => {
    const ids = ["a", "b", "c"];
    const reads = Object.fromEntries(ids.map((i) => [i, [state("none")]]));
    const { deps, log } = harness(reads);
    const s = await runRefundStateCheck(ids.map((i) => cand(i)), deps, { ...OPTS, perShopCap: 2 });
    expect(s.sent).toBe(2);
    expect(s.deferredByShopCap).toBe(1);
    expect(log.sent).toHaveLength(2);
  });

  it("a failed send is not recorded, so the next run retries it", async () => {
    const { deps, log } = harness({ a: [state("none")] }, { send: async () => ({ ok: false, error: "resend 500" }) });
    const s = await runRefundStateCheck([cand("a")], deps, OPTS);
    expect(s.failedSends).toBe(1);
    expect(log.recorded).toEqual([]);
  });

  it("if the dedupe row cannot be written, it retries once and then halts further sends", async () => {
    let attempts = 0;
    const { deps, log } = harness(
      { a: [state("none")], b: [state("none")] },
      {
        recordSent: async () => {
          attempts++;
          throw new Error("db down");
        },
      },
    );
    const s = await runRefundStateCheck([cand("a"), cand("b")], deps, OPTS);
    expect(attempts).toBe(2);
    expect(s.dedupeWriteFailures).toEqual(["a"]);
    expect(log.sent).toEqual(["a:none"]);
    expect(s.deferredByShopCap).toBe(1);
  });

  it("skips a recent read and counts what the time budget did not reach", async () => {
    const { deps } = harness({ a: [state("none")], b: [state("none")] });
    const recent = new Date(1_000_000 - 60_000).toISOString();
    const s1 = await runRefundStateCheck([cand("a", { lastCheckedAt: recent })], deps, OPTS);
    expect(s1.skippedRecent).toBe(1);
    expect(s1.checked).toBe(0);

    let t = 0;
    const slow = harness({ a: [state("none")], b: [state("none")] }, { now: () => (t += 600) });
    const s2 = await runRefundStateCheck([cand("a"), cand("b")], slow.deps, { ...OPTS, budgetMs: 500 });
    expect(s2.skippedByBudget).toBeGreaterThan(0);
    expect(s2.checked + s2.skippedByBudget).toBe(2);
  });

  it("an opted-out shop, a missing team email and an earlier send are all skipped after the snapshot", async () => {
    const { deps, log } = harness({ a: [state("none")], b: [state("none")], c: [state("none")] });
    const s = await runRefundStateCheck(
      [cand("a", { optedOut: true }), cand("b", { teamEmail: null }), cand("c", { alreadySent: true })],
      deps,
      OPTS,
    );
    expect(s.skips).toMatchObject({ opted_out: 1, no_team_email: 1, already_sent: 1 });
    expect(log.saved).toHaveLength(3);
    expect(log.sent).toEqual([]);
  });
});
