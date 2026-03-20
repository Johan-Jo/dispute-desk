import { describe, it, expect } from "vitest";
import { pickAutomationAction } from "../pickAutomationAction";
import type { Rule } from "../types";

const baseRule = (overrides: Partial<Rule>): Rule =>
  ({
    id: "r1",
    shop_id: "s1",
    enabled: true,
    match: {},
    action: { mode: "manual" },
    priority: 0,
    created_at: "",
    updated_at: "",
    ...overrides,
  }) as Rule;

describe("pickAutomationAction", () => {
  it("returns manual when no rules match", () => {
    const rules = [
      baseRule({
        id: "a",
        match: { reason: ["OTHER"] },
        action: { mode: "auto_pack", pack_template_id: "t1" },
        priority: 10,
      }),
    ];
    const r = pickAutomationAction(rules, {
      id: "d1",
      shop_id: "s1",
      reason: "FRAUDULENT",
      status: null,
      amount: 50,
    });
    expect(r.action.mode).toBe("manual");
    expect(r.matchedRule).toBeNull();
  });

  it("tier 0: high-amount review overrides tier 1 fraud auto", () => {
    const rules = [
      baseRule({
        id: "fraud",
        match: { reason: ["FRAUDULENT"] },
        action: { mode: "auto_pack", pack_template_id: "t-f" },
        priority: 20,
      }),
      baseRule({
        id: "hv",
        match: { amount_range: { min: 500 } },
        action: { mode: "review" },
        priority: 5,
      }),
    ];
    const r = pickAutomationAction(rules, {
      id: "d1",
      shop_id: "s1",
      reason: "FRAUDULENT",
      status: null,
      amount: 600,
    });
    expect(r.matchedRule?.id).toBe("hv");
    expect(r.action.mode).toBe("review");
  });

  it("tier 1: per-reason rule wins over tier 2 catch-all for that reason", () => {
    const rules = [
      baseRule({
        id: "fraud",
        match: { reason: ["FRAUDULENT"] },
        action: { mode: "auto_pack", pack_template_id: "t-f" },
        priority: 20,
      }),
      baseRule({
        id: "catch",
        match: {},
        action: { mode: "review" },
        priority: 100,
      }),
    ];
    const r = pickAutomationAction(rules, {
      id: "d1",
      shop_id: "s1",
      reason: "FRAUDULENT",
      status: null,
      amount: 50,
    });
    expect(r.matchedRule?.id).toBe("fraud");
    expect(r.action.mode).toBe("auto_pack");
  });

  it("tier 2 catch-all applies when no reason rule", () => {
    const rules = [
      baseRule({
        id: "catch",
        match: {},
        action: { mode: "review" },
        priority: 100,
      }),
    ];
    const r = pickAutomationAction(rules, {
      id: "d1",
      shop_id: "s1",
      reason: "SUBSCRIPTION_CANCELED",
      status: null,
      amount: 20,
    });
    expect(r.matchedRule?.id).toBe("catch");
    expect(r.action.mode).toBe("review");
  });
});
