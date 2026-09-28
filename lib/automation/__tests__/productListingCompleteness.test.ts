/**
 * Not-as-described plan PR 3 — the checklist follows the collector only when
 * the flag is ON; OFF is unchanged (templated packs b…0004 / b…0013 still
 * score product_description against order_confirmation).
 */
import { describe, it, expect, afterEach } from "vitest";
import { evaluateCompletenessV2, templateCollectorKey } from "../completeness";

const TEMPLATE_ITEM = { key: "product_description", label: "Product description", required: false, collector_key: "order_confirmation" };
const prev = process.env.PRODUCT_LISTING_EVIDENCE_ENABLED;
afterEach(() => {
  process.env.PRODUCT_LISTING_EVIDENCE_ENABLED = prev;
});

describe("product description in the checklist", () => {
  it("flag OFF: the templated item still scores against order_confirmation", () => {
    process.env.PRODUCT_LISTING_EVIDENCE_ENABLED = "false";
    expect(templateCollectorKey(TEMPLATE_ITEM)).toBe("order_confirmation");
  });

  it("flag ON: the templated item scores against the collected listing", () => {
    process.env.PRODUCT_LISTING_EVIDENCE_ENABLED = "true";
    expect(templateCollectorKey(TEMPLATE_ITEM)).toBe("product_description");
    expect(templateCollectorKey({ key: "shipping_policy", collector_key: "shipping_policy" })).toBe("shipping_policy");
  });

  it("flag ON: the built-in template expects it from Shopify, not an upload", () => {
    process.env.PRODUCT_LISTING_EVIDENCE_ENABLED = "true";
    const on = evaluateCompletenessV2("PRODUCT_UNACCEPTABLE", new Set(["product_description"]));
    const row = on.checklist.find((c) => c.field === "product_description");
    expect(row?.status).toBe("available");
    expect(row?.source).toBe("auto_shopify");
    expect(row?.collectionType).toBe("auto");
    process.env.PRODUCT_LISTING_EVIDENCE_ENABLED = "false";
    const off = evaluateCompletenessV2("PRODUCT_UNACCEPTABLE", new Set());
    expect(off.checklist.find((c) => c.field === "product_description")?.source).toBe("manual_upload");
  });
});
