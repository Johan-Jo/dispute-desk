import { describe, expect, it } from "vitest";
import { runFinalReads } from "../refundFinalReads";
import type { RefundState } from "../refundState";

const state = (kind: RefundState["kind"]): RefundState => ({
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
  returnStatus: "RETURNED",
  paymentGateways: [],
  financialStatus: "PAID",
});
const c = (id: string) => ({ disputeId: id, shopId: "s", orderGid: `gid://shopify/Order/${id}` });

describe("runFinalReads", () => {
  it("stores each readable result", async () => {
    const saved: string[] = [];
    const s = await runFinalReads([c("a"), c("b")], { now: () => 0, readState: async () => state("settled"), saveFinal: async (x) => void saved.push(x.disputeId) }, { budgetMs: 1000 });
    expect(saved).toEqual(["a", "b"]);
    expect(s.read).toBe(2);
  });

  it("an unknown read or a thrown one stores nothing, so the dispute is retried and stays out of the figures", async () => {
    const saved: string[] = [];
    const s = await runFinalReads(
      [c("a"), c("b"), c("c")],
      {
        now: () => 0,
        readState: async (x) => {
          if (x.disputeId === "a") return state("unknown");
          if (x.disputeId === "b") throw new Error("throttled");
          return state("none");
        },
        saveFinal: async (x) => void saved.push(x.disputeId),
      },
      { budgetMs: 1000 },
    );
    expect(saved).toEqual(["c"]);
    expect(s.errors.map((e) => e.disputeId)).toEqual(["a", "b"]);
  });

  it("counts what the time budget did not reach", async () => {
    let t = 0;
    const s = await runFinalReads([c("a"), c("b"), c("c")], { now: () => (t += 600), readState: async () => state("none"), saveFinal: async () => {} }, { budgetMs: 1000 });
    expect(s.read + s.skippedByBudget).toBe(3);
    expect(s.skippedByBudget).toBeGreaterThan(0);
  });
});
