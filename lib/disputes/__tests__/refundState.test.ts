/**
 * `resolveRefundState`: the shapes below are the ones read live from Shopify on 2026-11-12
 * (whj8db-1q #25054 pending, #24999 settled, cay-collective #17210 gift-card reversal, ...).
 * The property that matters most: `unknown` is never `none`.
 */
import { describe, expect, it } from "vitest";
import { hasOpenOrReceivedReturn, isNoRefundState, resolveRefundState, STALLED_PENDING_HOURS } from "../refundState";
import type { RawOrderRefundState, RawRefundEntry } from "@/lib/shopify/queries/orderRefundState";

const NOW = "2026-11-12T14:00:00Z";
const money = (amount: string) => ({ shopMoney: { amount, currencyCode: "SEK" } });

const tx = (id: string, kind: string, status: string, amount: string) => ({
  id: `gid://shopify/OrderTransaction/${id}`,
  kind,
  status,
  processedAt: "2026-11-11T13:35:48Z",
  amountSet: money(amount),
});

function refund(
  id: string,
  opts: { total?: string; createdAt?: string; updatedAt?: string; txs?: ReturnType<typeof tx>[]; hasNextPage?: boolean },
): RawRefundEntry {
  return {
    id: `gid://shopify/Refund/${id}`,
    createdAt: opts.createdAt ?? "2026-11-11T13:35:49Z",
    updatedAt: opts.updatedAt ?? opts.createdAt ?? "2026-11-11T13:35:49Z",
    totalRefundedSet: money(opts.total ?? "0.0"),
    transactions: { pageInfo: { hasNextPage: opts.hasNextPage ?? false }, nodes: opts.txs ?? [] },
  };
}

function order(patch: Partial<RawOrderRefundState> = {}): RawOrderRefundState {
  return {
    id: "gid://shopify/Order/1",
    displayFinancialStatus: "PAID",
    returnStatus: "IN_PROGRESS",
    paymentGatewayNames: ["shopify_payments"],
    totalRefundedSet: money("0.0"),
    refunds: [],
    transactions: [tx("1", "SALE", "SUCCESS", "668.0")],
    ...patch,
  };
}

/** Order-level transactions must list the refund transactions too, as Shopify does. */
const withRefunds = (refunds: RawRefundEntry[], total: string, extra: Partial<RawOrderRefundState> = {}) =>
  order({
    refunds,
    totalRefundedSet: money(total),
    transactions: [
      tx("1", "SALE", "SUCCESS", "668.0"),
      ...refunds.flatMap((r) => (r.transactions?.nodes ?? []).filter((t) => t.kind === "REFUND")),
    ],
    ...extra,
  });

describe("resolveRefundState", () => {
  it("none: no refund at all (#24697 shape)", () => {
    const s = resolveRefundState(order(), NOW);
    expect(s.kind).toBe("none");
    expect(isNoRefundState(s)).toBe(true);
    expect(s.returnStatus).toBe("IN_PROGRESS");
  });

  it("none: a Refund with no transactions is a record with no money (order edit / cancellation)", () => {
    const s = resolveRefundState(withRefunds([refund("9", { total: "0.0", txs: [] })], "0.0"), NOW);
    expect(s.kind).toBe("none");
    expect(s.firstRefundAt).toBeNull();
  });

  it("pending: the refund shows 0.0 but its transaction is PENDING (#25054)", () => {
    const r = refund("1220189847877", { total: "0.0", txs: [tx("15174367281477", "REFUND", "PENDING", "529.0")] });
    const s = resolveRefundState(withRefunds([r], "0.0"), NOW);
    expect(s.kind).toBe("pending");
    expect(isNoRefundState(s)).toBe(false);
    expect(s.pendingAmount).toBe(529);
    expect(s.currency).toBe("SEK");
    expect(s.firstRefundAt).toBe("2026-11-11T13:35:49Z");
    expect(s.stalledPending).toBe(false);
  });

  it("settled: transaction SUCCESS, totals carry the amount; settledAt is Refund.updatedAt, not processedAt", () => {
    const r = refund("2", {
      total: "529.0",
      createdAt: "2026-11-11T13:35:49Z",
      updatedAt: "2026-11-12T13:47:04Z",
      txs: [tx("2", "REFUND", "SUCCESS", "529.0")],
    });
    const s = resolveRefundState(withRefunds([r], "529.0", { displayFinancialStatus: "PARTIALLY_REFUNDED" }), NOW);
    expect(s.kind).toBe("settled");
    expect(s.settledAmount).toBe(529);
    expect(s.settledAt).toBe("2026-11-12T13:47:04Z");
    expect(s.firstRefundAt).toBe("2026-11-11T13:35:49Z");
  });

  it("mixed: one refund settled, another still pending (#24393)", () => {
    const a = refund("a", { total: "499.0", updatedAt: "2026-11-05T10:00:00Z", createdAt: "2026-11-04T10:00:00Z", txs: [tx("a", "REFUND", "SUCCESS", "499.0")] });
    const b = refund("b", { total: "0.0", createdAt: "2026-11-12T09:00:00Z", txs: [tx("b", "REFUND", "PENDING", "1329.0")] });
    const s = resolveRefundState(withRefunds([a, b], "499.0"), NOW);
    expect(s.kind).toBe("mixed");
    expect(s.settledAmount).toBe(499);
    expect(s.pendingAmount).toBe(1329);
    expect(s.firstRefundAt).toBe("2026-11-04T10:00:00Z");
  });

  it("failed: every REFUND transaction failed", () => {
    const r = refund("3", { total: "0.0", txs: [tx("3", "REFUND", "FAILURE", "22.77")] });
    const s = resolveRefundState(withRefunds([r], "0.0"), NOW);
    expect(s.kind).toBe("failed");
    expect(s.failedAmount).toBeCloseTo(22.77);
    expect(isNoRefundState(s)).toBe(false);
  });

  describe("unknown is never none (fail closed)", () => {
    it("no order", () => {
      for (const raw of [null, undefined]) {
        const s = resolveRefundState(raw, NOW);
        expect(s.kind).toBe("unknown");
        expect(s.reason).toBe("no_order");
        expect(isNoRefundState(s)).toBe(false);
      }
    });

    it("a REFUND transaction no Refund owns (cay-collective #17210: gift-card reversal of a failed checkout)", () => {
      const raw = order({
        totalRefundedSet: money("500.0"),
        transactions: [tx("1", "SALE", "SUCCESS", "668.0"), tx("77", "REFUND", "SUCCESS", "500.0")],
      });
      const s = resolveRefundState(raw, NOW);
      expect(s.kind).toBe("unknown");
      expect(s.reason).toBe("unattributed_refund_transaction");
    });

    it("a list that reached its cap may hide a refund", () => {
      const ten = Array.from({ length: 10 }, (_, i) => refund(String(i), { txs: [] }));
      expect(resolveRefundState(withRefunds(ten, "0.0"), NOW).reason).toBe("truncated");
      const more = refund("x", { txs: [tx("x", "REFUND", "PENDING", "1.0")], hasNextPage: true });
      expect(resolveRefundState(withRefunds([more], "0.0"), NOW).reason).toBe("truncated");
      const thirty = Array.from({ length: 30 }, (_, i) => tx(String(i), "SALE", "SUCCESS", "1.0"));
      expect(resolveRefundState(order({ transactions: thirty }), NOW).reason).toBe("truncated");
    });

    it("a status we have not observed", () => {
      for (const status of ["ERROR", "AWAITING_RESPONSE", "UNKNOWN"]) {
        const r = refund("4", { txs: [tx("4", "REFUND", status, "10.0")] });
        expect(resolveRefundState(withRefunds([r], "0.0"), NOW).reason).toBe("unrecognised_status");
      }
    });

    it("an unparseable amount", () => {
      const r = refund("5", { txs: [{ ...tx("5", "REFUND", "PENDING", "x"), amountSet: money("not-a-number") }] });
      expect(resolveRefundState(withRefunds([r], "0.0"), NOW).reason).toBe("malformed_amount");
      expect(resolveRefundState(order({ totalRefundedSet: null }), NOW).reason).toBe("malformed_amount");
    });

    it("a refunded total with no transaction behind it", () => {
      const s = resolveRefundState(order({ totalRefundedSet: money("100.0") }), NOW);
      expect(s.kind).toBe("unknown");
      expect(s.reason).toBe("total_without_transaction");
    });

    it("a settled transaction while the order total still reads 0 (a read taken as the refund settles)", () => {
      const r = refund("6", { total: "0.0", txs: [tx("6", "REFUND", "SUCCESS", "529.0")] });
      const s = resolveRefundState(withRefunds([r], "0.0"), NOW);
      expect(s.kind).toBe("unknown");
      expect(s.reason).toBe("inconsistent_read");
    });
  });

  it("stalledPending: pending beyond 72 h is flagged, normal ~24 h is not", () => {
    const old = new Date(Date.parse(NOW) - (STALLED_PENDING_HOURS + 8) * 3_600_000).toISOString();
    const fresh = new Date(Date.parse(NOW) - 24 * 3_600_000).toISOString();
    const stalled = refund("7", { createdAt: old, txs: [tx("7", "REFUND", "PENDING", "41.31")] });
    const normal = refund("8", { createdAt: fresh, txs: [tx("8", "REFUND", "PENDING", "41.31")] });
    expect(resolveRefundState(withRefunds([stalled], "0.0"), NOW).stalledPending).toBe(true);
    expect(resolveRefundState(withRefunds([normal], "0.0"), NOW).stalledPending).toBe(false);
  });

  it("carries the return status and gateways for the send rule", () => {
    const s = resolveRefundState(order({ returnStatus: "RETURNED", paymentGatewayNames: ["shopify_payments", "klarna"] }), NOW);
    expect(hasOpenOrReceivedReturn(s)).toBe(true);
    expect(s.paymentGateways).toEqual(["shopify_payments", "klarna"]);
    for (const returnStatus of ["NO_RETURN", "RETURN_REQUESTED", "RETURN_FAILED", null]) {
      expect(hasOpenOrReceivedReturn(resolveRefundState(order({ returnStatus }), NOW))).toBe(false);
    }
  });
});
