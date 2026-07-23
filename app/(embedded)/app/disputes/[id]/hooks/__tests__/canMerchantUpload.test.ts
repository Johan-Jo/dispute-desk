import { describe, it, expect } from "vitest";
import { canMerchantUpload } from "../useDisputeWorkspace";

/**
 * Guard: the "Add this evidence" / red Missing-card nag must never fire
 * for a field that can NEVER change case strength (supportingOnly).
 * Prod dispute 8f90a8f0 (not-as-described) surfaced a red
 * "Missing · Add product listing" nag for product_description, which is
 * weight-0 — uploading it leaves the case exactly as weak. 2026-07-23.
 */
describe("canMerchantUpload — supportingOnly fields never nag", () => {
  it("refuses product_description (supportingOnly, was double-listed)", () => {
    expect(canMerchantUpload({ field: "product_description" })).toBe(false);
  });

  it("refuses order_confirmation (supportingOnly)", () => {
    expect(canMerchantUpload({ field: "order_confirmation" })).toBe(false);
  });

  it("refuses duplicate_explanation (supportingOnly)", () => {
    expect(canMerchantUpload({ field: "duplicate_explanation" })).toBe(false);
  });

  it("still allows conditionally-upgradable merchant uploads", () => {
    // These CAN reach strong given the right payload, so the upload nag
    // is legitimate — the guard must not over-reach and suppress them.
    expect(canMerchantUpload({ field: "customer_communication" })).toBe(true);
    expect(canMerchantUpload({ field: "supporting_documents" })).toBe(true);
  });

  it("still refuses system-derived fields", () => {
    expect(canMerchantUpload({ field: "avs_cvv_match" })).toBe(false);
    expect(canMerchantUpload({ field: "ip_location_check" })).toBe(false);
  });

  it("honors collectionType for off-registry fields", () => {
    expect(canMerchantUpload({ field: "unknown_x", collectionType: "manual" })).toBe(true);
    expect(canMerchantUpload({ field: "unknown_x", collectionType: "auto" })).toBe(false);
  });
});
