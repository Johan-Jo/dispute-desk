import { describe, it, expect } from "vitest";
import {
  AUTOMATION_GROUPS,
  ALL_GROUP_RULE_NAMES,
  GROUP_RULE_PRIORITY,
  groupRuleName,
  parseGroupRuleName,
  findGroup,
} from "../automationGroups";
import { DISPUTE_TYPES } from "../disputeTypes";
import { ALL_DISPUTE_REASONS } from "../disputeReasons";
import { evaluateAutoSubmitGuards } from "@/lib/automation/autoSubmitGuards";
import { SETUP_RULE_PREFIX } from "../storeAutomationNames";

describe("automation group model", () => {
  it("every group's reasons are real Shopify enum values", () => {
    for (const group of AUTOMATION_GROUPS) {
      expect(group.reasons.length).toBeGreaterThan(0);
      for (const reason of group.reasons) {
        expect(ALL_DISPUTE_REASONS).toContain(reason);
      }
    }
  });

  it("fraud carries UNRECOGNIZED as well as FRAUDULENT", () => {
    // UNRECOGNIZED is scored with the fraud formula and is missing from the
    // custom-rule reason list, so a merchant cannot cover it themselves.
    // Dropping it here strands every such dispute on the catch-all silently.
    expect(findGroup("fraud")!.reasons).toEqual(["FRAUDULENT", "UNRECOGNIZED"]);
  });

  it("no group claims DIGITAL — it is a product signal, not a reason code", () => {
    expect(DISPUTE_TYPES).toContain("DIGITAL");
    for (const group of AUTOMATION_GROUPS) {
      expect(group.reasons).not.toContain("DIGITAL");
    }
  });

  it("group reason sets are pairwise disjoint", () => {
    // Two groups matching one dispute would both be tier-1 at priority 50, so
    // the outcome would hinge on a tiebreak rather than on merchant intent.
    const seen = new Map<string, string>();
    for (const group of AUTOMATION_GROUPS) {
      for (const reason of group.reasons) {
        expect(
          seen.has(reason),
          `${reason} is claimed by both ${seen.get(reason)} and ${group.id}`,
        ).toBe(false);
        seen.set(reason, group.id);
      }
    }
  });

  it("not_as_described is no longer locked, and the engine agrees", () => {
    // Both halves in ONE test, deliberately. The flag and the guard must move
    // together — a lock the engine no longer enforces is a control we're
    // needlessly withholding, and an unlocked group the engine still parks is
    // a UI that lies. The product-family park was removed 2026-07-30 because
    // Shopify files its own evidence when we file none, so parking swapped our
    // pack for a worse one rather than withholding a rebuttal.
    const group = findGroup("not_as_described")!;
    expect(group.locked).toBe(false);

    const verdict = evaluateAutoSubmitGuards({
      coverageState: "not_covered",
      fatalLoss: null,
      caseStrength: "strong",
    });
    expect(verdict.decision).toBe("proceed");
  });

  it("no group is silently un-automatable", () => {
    // An unlocked group must actually be able to auto-submit a Strong case, or
    // the control promises something it can't deliver. Every group is unlocked
    // as of 2026-07-30, so this now covers all of them.
    for (const group of AUTOMATION_GROUPS) {
      expect(group.locked, `${group.id} is locked`).toBe(false);
      const verdict = evaluateAutoSubmitGuards({
        coverageState: "not_covered",
        fatalLoss: null,
        caseStrength: "strong",
      });
      expect(verdict.decision, group.id).toBe("proceed");
    }
  });

  it("locked groups still get a name, so a stray row can be swept", () => {
    expect(ALL_GROUP_RULE_NAMES).toContain(groupRuleName("not_as_described"));
    expect(ALL_GROUP_RULE_NAMES).toHaveLength(AUTOMATION_GROUPS.length);
  });

  it("group rule names live under the setup prefix (so the custom-rules list hides them)", () => {
    for (const name of ALL_GROUP_RULE_NAMES) {
      expect(name.startsWith(SETUP_RULE_PREFIX)).toBe(true);
    }
  });

  it("round-trips a group id through its rule name", () => {
    for (const group of AUTOMATION_GROUPS) {
      expect(parseGroupRuleName(groupRuleName(group.id))).toBe(group.id);
    }
    expect(parseGroupRuleName("__dd_setup__:fallback:default")).toBeNull();
    expect(parseGroupRuleName("__dd_setup__:group:nonsense")).toBeNull();
    expect(parseGroupRuleName("my own rule")).toBeNull();
    expect(parseGroupRuleName(null)).toBeNull();
  });

  it("sits between the safeguard and the fallback in priority", () => {
    // Tiers beat priority in pickAutomationAction, so this number only breaks
    // ties against other reason rules — but it must still read sanely.
    expect(GROUP_RULE_PRIORITY).toBeGreaterThan(5);
    expect(GROUP_RULE_PRIORITY).toBeLessThan(100_000);
  });
});
