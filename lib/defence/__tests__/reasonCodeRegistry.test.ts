import { describe, it, expect } from "vitest";
import {
  resolveReasonCodeModule,
  ALL_REASON_CODE_MODULES,
} from "../reasonCodes/registry";

describe("reason-code registry", () => {
  it("maps Visa 10.4 → visa_10_4_fraud", () => {
    expect(resolveReasonCodeModule("10.4").key).toBe("visa_10_4_fraud");
  });

  it("maps MC 4837 → visa_10_4_fraud (same module)", () => {
    expect(resolveReasonCodeModule("4837").key).toBe("visa_10_4_fraud");
  });

  it.each([
    ["13.1", "inr_product_not_received"],
    ["4855", "inr_product_not_received"],
    ["13.3", "product_unacceptable"],
    ["4853", "product_unacceptable"],
    ["13.6", "credit_not_processed"],
    ["4860", "credit_not_processed"],
    ["12.6", "duplicate_processing"],
    ["4834", "duplicate_processing"],
    ["13.2", "canceled_recurring"],
    ["4841", "canceled_recurring"],
  ])("maps %s → %s", (code, expectedKey) => {
    expect(resolveReasonCodeModule(code).key).toBe(expectedKey);
  });

  it("falls back to generic_fallback for unknown codes", () => {
    expect(resolveReasonCodeModule("99.99").key).toBe("generic_fallback");
    expect(resolveReasonCodeModule(null).key).toBe("generic_fallback");
    expect(resolveReasonCodeModule(undefined).key).toBe("generic_fallback");
  });

  it("DB override beats file default field-by-field", () => {
    const base = resolveReasonCodeModule("10.4");
    const overridden = resolveReasonCodeModule("10.4", {
      promptBody: "OVERRIDDEN PROMPT",
      guidanceJson: {
        prioritize: ["custom_category" as never],
      },
      version: 9,
    });
    expect(overridden.promptBody).toBe("OVERRIDDEN PROMPT");
    expect(overridden.prioritize).toEqual(["custom_category"]);
    expect(overridden.version).toBe(9);
    // Fields not overridden inherit the base.
    expect(overridden.avoid).toEqual(base.avoid);
    expect(overridden.mustNotClaim).toEqual(base.mustNotClaim);
    expect(overridden.criticalCategories).toEqual(base.criticalCategories);
  });

  it("ALL_REASON_CODE_MODULES has exactly 7 modules", () => {
    expect(ALL_REASON_CODE_MODULES).toHaveLength(7);
    const keys = ALL_REASON_CODE_MODULES.map((m) => m.key).sort();
    expect(keys).toEqual([
      "canceled_recurring",
      "credit_not_processed",
      "duplicate_processing",
      "generic_fallback",
      "inr_product_not_received",
      "product_unacceptable",
      "visa_10_4_fraud",
    ]);
  });

  it("every module declares at least one allowedFactCategory", () => {
    for (const mod of ALL_REASON_CODE_MODULES) {
      expect(mod.allowedFactCategories.length).toBeGreaterThan(0);
    }
  });
});
