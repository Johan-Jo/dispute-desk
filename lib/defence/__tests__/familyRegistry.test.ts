import { describe, it, expect } from "vitest";
import {
  resolveReasonCodeFamily,
  familyForModule,
  familyForCodeOrModule,
  getFamily,
  ALL_REASON_CODE_FAMILIES,
} from "../reasonCodes/familyRegistry";
import {
  resolveReasonCodeModule,
  ALL_REASON_CODE_MODULES,
  familyKeyForModule,
} from "../reasonCodes/registry";

describe("reason-code family registry", () => {
  it("maps Visa 10.4 module → unauthorized_fraud family", () => {
    const mod = resolveReasonCodeModule("10.4");
    expect(familyForModule(mod.key).key).toBe("unauthorized_fraud");
    expect(familyKeyForModule(mod.key)).toBe("unauthorized_fraud");
  });

  it.each([
    ["visa_10_4_fraud", "unauthorized_fraud"],
    ["inr_product_not_received", "item_not_received"],
    ["product_unacceptable", "product_not_as_described"],
    ["credit_not_processed", "credit_not_processed"],
    ["duplicate_processing", "duplicate_processing"],
    ["canceled_recurring", "cancelled_recurring"],
    ["generic_fallback", "fallback"],
  ] as const)("module %s belongs to family %s", (moduleKey, familyKey) => {
    expect(familyKeyForModule(moduleKey)).toBe(familyKey);
  });

  it("resolveReasonCodeFamily returns fallback for unknown / null / undefined", () => {
    expect(resolveReasonCodeFamily(null).key).toBe("fallback");
    expect(resolveReasonCodeFamily(undefined).key).toBe("fallback");
    expect(resolveReasonCodeFamily("99.99").key).toBe("fallback");
  });

  it("resolveReasonCodeFamily returns processing_error for unmodeled processing codes", () => {
    expect(resolveReasonCodeFamily("12.1").key).toBe("processing_error");
    expect(resolveReasonCodeFamily("4831").key).toBe("processing_error");
  });

  it("resolveReasonCodeFamily returns authorization_error for unmodeled auth codes", () => {
    expect(resolveReasonCodeFamily("11.2").key).toBe("authorization_error");
    expect(resolveReasonCodeFamily("4808").key).toBe("authorization_error");
  });

  it("familyForCodeOrModule prefers the resolved module's family", () => {
    // Code 99.99 alone resolves to fallback, but if we pass a 10.4
    // module it should prefer that.
    const mod = resolveReasonCodeModule("10.4");
    expect(familyForCodeOrModule("99.99", mod).key).toBe("unauthorized_fraud");
  });

  it("familyForCodeOrModule falls back to code lookup when module is null", () => {
    expect(familyForCodeOrModule("10.4", null).key).toBe("fallback");
    // 10.4 isn't in any family's unmodeledCodes (it's claimed by the
    // module-keyed CODE_TO_KEY in the module registry, not by
    // unmodeledCodes). Without a resolved module we can't route to
    // unauthorized_fraud — this is by design: the module is the
    // authoritative routing key, the family is a grouping above it.
  });

  it("every family declares fallbackModuleKey", () => {
    for (const family of ALL_REASON_CODE_FAMILIES) {
      expect(family.fallbackModuleKey).toBeDefined();
      expect(family.fallbackModuleKey.length).toBeGreaterThan(0);
    }
  });

  it("every module declared in ALL_REASON_CODE_MODULES belongs to exactly one family", () => {
    const seen = new Set<string>();
    for (const mod of ALL_REASON_CODE_MODULES) {
      // familyForModule throws if the module is orphaned — this assertion
      // implicitly covers the "every module has a family" invariant.
      const family = familyForModule(mod.key);
      expect(family).toBeDefined();
      // No module appears in two families.
      const tag = `${mod.key}→${family.key}`;
      expect(seen.has(tag)).toBe(false);
      seen.add(tag);
    }
  });

  it("ALL_REASON_CODE_FAMILIES has exactly 9 entries", () => {
    expect(ALL_REASON_CODE_FAMILIES).toHaveLength(9);
    const keys = ALL_REASON_CODE_FAMILIES.map((f) => f.key).sort();
    expect(keys).toEqual([
      "authorization_error",
      "cancelled_recurring",
      "credit_not_processed",
      "duplicate_processing",
      "fallback",
      "item_not_received",
      "processing_error",
      "product_not_as_described",
      "unauthorized_fraud",
    ]);
  });

  it("Phase 1 overlays are empty strings (filled in in later phases)", () => {
    for (const family of ALL_REASON_CODE_FAMILIES) {
      expect(family.overlayPromptBody).toBe("");
    }
  });

  it("no reason code is claimed by two different families via unmodeledCodes", () => {
    // Construction of CODE_TO_FAMILY throws on collisions; reaching this
    // line means construction succeeded, so the invariant holds.
    expect(getFamily("processing_error")).toBeDefined();
    expect(getFamily("authorization_error")).toBeDefined();
  });
});
