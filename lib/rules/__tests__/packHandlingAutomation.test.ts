import { describe, expect, it } from "vitest";
import type { Pack } from "@/lib/types/packs";
import {
  disputeTypeToPrimaryReason,
  validatePackModes,
} from "@/lib/rules/packHandlingAutomation";

describe("disputeTypeToPrimaryReason", () => {
  it("passes through Shopify reason codes unchanged", () => {
    expect(disputeTypeToPrimaryReason("FRAUDULENT")).toBe("FRAUDULENT");
    expect(disputeTypeToPrimaryReason("PRODUCT_NOT_RECEIVED")).toBe("PRODUCT_NOT_RECEIVED");
  });
  it("maps legacy DIGITAL to GENERAL", () => {
    expect(disputeTypeToPrimaryReason("DIGITAL")).toBe("GENERAL");
  });
  it("defaults empty to GENERAL", () => {
    expect(disputeTypeToPrimaryReason("")).toBe("GENERAL");
  });
});

describe("validatePackModes", () => {
  const basePack = (overrides: Partial<Pack>): Pack => ({
    id: "p1",
    shop_id: "s",
    name: "Test",
    code: null,
    dispute_type: "FRAUDULENT",
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
