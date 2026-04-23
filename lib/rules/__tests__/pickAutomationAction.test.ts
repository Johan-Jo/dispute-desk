import { describe, it, expect } from "vitest";
import { pickAutomationAction } from "../pickAutomationAction";
import type { Rule } from "../types";

/**
 * The automation model only exposes two merchant-facing modes: "auto" and
 * "review". Legacy stored values (auto_pack, notify, manual, old review) must
 * be normalized on read:
 *   auto_pack -> auto
 *   notify    -> review
 *   manual    -> review
 *   review    -> review
 * When no rule matches, we default to "review" so the merchant always
 * gets a prepared pack and a notification (never a silent drop).
 */

/**
 * These tests feed legacy mode strings (auto_pack, notify, manual) on purpose
 * to exercise the normalization layer. The factory accepts a widened override
 * shape so we don't have to `as unknown as Rule` on every case.
 */
type RuleOverride = Omit<Partial<Rule>, "action"> & {
  action?: { mode: string; pack_template_id?: string | null };
};

const baseRule = (overrides: RuleOverride): Rule =>
  ({
    id: "r1",
    shop_id: "s1",
    enabled: true,
    match: {},
    action: { mode: "review" },
    priority: 0,
    created_at: "",
    updated_at: "",
    ...overrides,
  }) as unknown as Rule;

describe("pickAutomationAction", () => {
  it("returns review when no rules match (never silently drops)", () => {
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
    expect(r.action.mode).toBe("review");
    expect(r.matchedRule).toBeNull();
  });

  it("normalizes legacy auto_pack to auto on match", () => {
    const rules = [
      baseRule({
        id: "fraud",
        match: { reason: ["FRAUDULENT"] },
        action: { mode: "auto_pack", pack_template_id: "t-f" },
        priority: 20,
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
    expect(r.action.mode).toBe("auto");
    expect(r.packTemplateId).toBe("t-f");
  });

  it("normalizes legacy notify to review (notify is no longer a mode)", () => {
    const rules = [
      baseRule({
        id: "fraud-notify",
        match: { reason: ["FRAUDULENT"] },
        action: { mode: "notify" },
        priority: 20,
      }),
    ];
    const r = pickAutomationAction(rules, {
      id: "d1",
      shop_id: "s1",
      reason: "FRAUDULENT",
      status: null,
      amount: 50,
    });
    expect(r.matchedRule?.id).toBe("fraud-notify");
    expect(r.action.mode).toBe("review");
  });

  it("normalizes legacy manual to review", () => {
    const rules = [
      baseRule({
        id: "fraud-manual",
        match: { reason: ["FRAUDULENT"] },
        action: { mode: "manual" },
        priority: 20,
      }),
    ];
    const r = pickAutomationAction(rules, {
      id: "d1",
      shop_id: "s1",
      reason: "FRAUDULENT",
      status: null,
      amount: 50,
    });
    expect(r.matchedRule?.id).toBe("fraud-manual");
    expect(r.action.mode).toBe("review");
  });

  it("tier 0: high-amount review overrides tier 1 auto-pack", () => {
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
    expect(r.action.mode).toBe("auto");
  });

  describe("phase matching", () => {
    it("phase-specific rule only matches its phase", () => {
      const rules = [
        baseRule({
          id: "fraud-inq",
          match: { reason: ["FRAUDULENT"], phase: ["inquiry"] },
          action: { mode: "auto_pack", pack_template_id: "t-fraud-inq" },
          priority: 20,
        }),
      ];
      const onChargeback = pickAutomationAction(rules, {
        id: "d1",
        shop_id: "s1",
        reason: "FRAUDULENT",
        status: null,
        amount: 50,
        phase: "chargeback",
      });
      expect(onChargeback.matchedRule).toBeNull();
      expect(onChargeback.action.mode).toBe("review");

      const onInquiry = pickAutomationAction(rules, {
        id: "d2",
        shop_id: "s1",
        reason: "FRAUDULENT",
        status: null,
        amount: 50,
        phase: "inquiry",
      });
      expect(onInquiry.matchedRule?.id).toBe("fraud-inq");
      expect(onInquiry.action.mode).toBe("auto");
      expect(onInquiry.packTemplateId).toBe("t-fraud-inq");
    });

    it("phase-blind rule still matches both phases (back-compat)", () => {
      const rules = [
        baseRule({
          id: "fraud-blind",
          match: { reason: ["FRAUDULENT"] },
          action: { mode: "auto_pack", pack_template_id: "t-fraud" },
          priority: 20,
        }),
      ];
      const r1 = pickAutomationAction(rules, {
        id: "d1",
        shop_id: "s1",
        reason: "FRAUDULENT",
        status: null,
        amount: 50,
        phase: "inquiry",
      });
      expect(r1.matchedRule?.id).toBe("fraud-blind");
      const r2 = pickAutomationAction(rules, {
        id: "d2",
        shop_id: "s1",
        reason: "FRAUDULENT",
        status: null,
        amount: 50,
        phase: "chargeback",
      });
      expect(r2.matchedRule?.id).toBe("fraud-blind");
    });

    it("phase-specific rule beats phase-blind at the same priority", () => {
      const rules = [
        baseRule({
          id: "fraud-blind",
          match: { reason: ["FRAUDULENT"] },
          action: { mode: "auto_pack", pack_template_id: "t-fraud" },
          priority: 20,
        }),
        baseRule({
          id: "fraud-inq",
          match: { reason: ["FRAUDULENT"], phase: ["inquiry"] },
          action: { mode: "auto_pack", pack_template_id: "t-fraud-inq" },
          priority: 20,
        }),
      ];
      const r = pickAutomationAction(rules, {
        id: "d1",
        shop_id: "s1",
        reason: "FRAUDULENT",
        status: null,
        amount: 50,
        phase: "inquiry",
      });
      expect(r.matchedRule?.id).toBe("fraud-inq");
      expect(r.packTemplateId).toBe("t-fraud-inq");
    });
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
