import { describe, expect, it } from "vitest";
import type { Pack } from "@/lib/types/packs";
import {
  disputeTypeToPrimaryReason,
  validatePackModes,
} from "@/lib/rules/packHandlingAutomation";

describe("disputeTypeToPrimaryReason", () => {
  it("maps FRAUD to FRAUDULENT", () => {
    expect(disputeTypeToPrimaryReason("FRAUD")).toBe("FRAUDULENT");
  });
  it("defaults unknown to GENERAL", () => {
    expect(disputeTypeToPrimaryReason("UNKNOWN_X")).toBe("GENERAL");
  });
});

describe("validatePackModes", () => {
  const basePack = (overrides: Partial<Pack>): Pack => ({
    id: "p1",
    shop_id: "s",
    name: "Test",
    code: null,
    dispute_type: "FRAUD",
    status: "ACTIVE",
    source: "TEMPLATE",
    template_id: "tpl1",
    documents_count: 0,
    usage_count: 0,
    last_used_at: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  });

  it("returns null when valid", () => {
    expect(
      validatePackModes(
        [basePack({})],
        { p1: "auto" },
        new Set(["tpl1"])
      )
    ).toBeNull();
  });

  it("errors when auto without template", () => {
    expect(
      validatePackModes(
        [basePack({ template_id: null })],
        { p1: "auto" },
        new Set()
      )
    ).toBe("pack_auto_requires_template");
  });
});
