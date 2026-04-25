import { describe, expect, it } from "vitest";
import { resolveChecklistFieldForManualItem } from "../manualUploadChecklistFromAudit";

describe("resolveChecklistFieldForManualItem", () => {
  it("prefers payload.checklistField over audit", () => {
    const audit = new Map([["u1", "customer_communication"]]);
    expect(
      resolveChecklistFieldForManualItem("u1", { checklistField: "delivery_proof" }, audit),
    ).toBe("delivery_proof");
  });

  it("falls back to audit map by evidence item id", () => {
    const audit = new Map([["u1", "customer_communication"]]);
    expect(resolveChecklistFieldForManualItem("u1", { fileName: "x.png" }, audit)).toBe(
      "customer_communication",
    );
  });

  it("returns null when neither source has a field", () => {
    expect(resolveChecklistFieldForManualItem("u1", {}, new Map())).toBeNull();
  });
});
