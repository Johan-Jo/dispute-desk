import { describe, it, expect } from "vitest";
import { classifyBillingState, summarizeBilling, type EntitlementEvidence } from "../paidSubscriptions";
import { fetchAllRows } from "../fetchAllRows";

const ent = (over: Partial<EntitlementEvidence> = {}): EntitlementEvidence => ({
  shop_id: "s",
  plan_key: "growth",
  subscription_state: "active",
  first_paid_cycle_started_at: "2026-10-01T00:00:00Z",
  ...over,
});
const shop = (over = {}) => ({ id: "s", plan: "growth", uninstalled_at: null, ...over });

describe("classifyBillingState", () => {
  it("paid = active + first paid cycle + non-free plan", () => {
    expect(classifyBillingState(shop(), ent())).toBe("paid");
  });
  it("a paid plan label with no entitlement row is unconfirmed, not paid", () => {
    expect(classifyBillingState(shop(), null)).toBe("unconfirmed");
  });
  it("active subscription without a first paid cycle is unconfirmed", () => {
    expect(classifyBillingState(shop(), ent({ first_paid_cycle_started_at: null }))).toBe("unconfirmed");
  });
  it("trialing and grace are reported as such", () => {
    expect(classifyBillingState(shop(), ent({ subscription_state: "trialing", first_paid_cycle_started_at: null }))).toBe("trialing");
    expect(classifyBillingState(shop(), ent({ subscription_state: "grace" }))).toBe("grace");
  });
  it("cancelled free shop is free", () => {
    expect(
      classifyBillingState(shop({ plan: "free" }), ent({ plan_key: "free", subscription_state: "cancelled", first_paid_cycle_started_at: null })),
    ).toBe("free");
  });
  it("uninstalled always wins", () => {
    expect(classifyBillingState(shop({ uninstalled_at: "2026-11-01" }), ent())).toBe("uninstalled");
  });
});

describe("summarizeBilling (2026-11-12 prod shapes)", () => {
  it("counts only actually-paid shops toward MRR", () => {
    const shops = [
      { id: "a", plan: "growth", uninstalled_at: null },
      { id: "b", plan: "growth", uninstalled_at: null },
      { id: "c", plan: "growth", uninstalled_at: null }, // no entitlement row
      { id: "d", plan: "growth", uninstalled_at: null }, // active, never paid a cycle
      { id: "e", plan: "free", uninstalled_at: null },
    ];
    const ents = [
      ent({ shop_id: "a" }),
      ent({ shop_id: "b" }),
      ent({ shop_id: "d", first_paid_cycle_started_at: null }),
      ent({ shop_id: "e", plan_key: "free", subscription_state: "cancelled", first_paid_cycle_started_at: null }),
    ];
    const out = summarizeBilling(shops, ents);
    expect(out.paid).toBe(2);
    expect(out.unconfirmed).toBe(2);
    expect(out.mrr).toBe(258); // 2 × Growth ($129)
    expect(out.labelMrr).toBe(516); // what the plan labels alone claimed
  });
});

describe("fetchAllRows", () => {
  it("pages past the 1000-row PostgREST cap", async () => {
    const calls: [number, number][] = [];
    const rows = await fetchAllRows<number>(async (from, to) => {
      calls.push([from, to]);
      const n = Math.max(0, Math.min(to + 1, 2500) - from);
      return { data: Array.from({ length: n }, (_, i) => from + i), error: null };
    });
    expect(rows).toHaveLength(2500);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it("throws on a query error instead of returning partial data", async () => {
    await expect(fetchAllRows(async () => ({ data: null, error: { message: "boom" } }))).rejects.toThrow("boom");
  });
});
