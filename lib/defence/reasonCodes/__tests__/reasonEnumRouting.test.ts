/**
 * Tests for resolveReasonCodeModuleForContext — the BNPL reason-enum
 * routing fallback. Klarna/Affirm disputes carry no network reason code,
 * so the module must be routed off the Shopify reason enum into the
 * existing per-reason modules rather than collapsing to generic_fallback.
 */

import { describe, it, expect } from "vitest";
import {
  resolveReasonCodeModule,
  resolveReasonCodeModuleForContext,
} from "@/lib/defence/reasonCodes/registry";

describe("resolveReasonCodeModuleForContext — BNPL (no network code)", () => {
  it("routes CREDIT_NOT_PROCESSED → credit_not_processed module", () => {
    const mod = resolveReasonCodeModuleForContext(null, "CREDIT_NOT_PROCESSED");
    expect(mod.key).toBe("credit_not_processed");
  });

  it("routes PRODUCT_NOT_RECEIVED → inr_product_not_received module", () => {
    const mod = resolveReasonCodeModuleForContext(null, "PRODUCT_NOT_RECEIVED");
    expect(mod.key).toBe("inr_product_not_received");
  });

  it("is case-insensitive on the Shopify reason enum", () => {
    const mod = resolveReasonCodeModuleForContext(null, "credit_not_processed");
    expect(mod.key).toBe("credit_not_processed");
  });

  it("falls through to generic_fallback for an unmapped reason", () => {
    const mod = resolveReasonCodeModuleForContext(null, "SOME_UNKNOWN_REASON");
    expect(mod.key).toBe("generic_fallback");
  });

  it("routes FRAUDULENT → visa_10_4_fraud rather than generic_fallback", () => {
    // A wallet/BNPL "fraudulent" claim is an unauthorized-transaction claim.
    // It fell to generic_fallback until 2026-09-01.
    const mod = resolveReasonCodeModuleForContext(null, "FRAUDULENT");
    expect(mod.key).toBe("visa_10_4_fraud");
  });

  it("leaves the unauthorized module hedged on a non-card rail", () => {
    // `payment_authentication` and `billing_match` have no members off the
    // card rail, so this module can never satisfy its own critical
    // categories there. That is the intended outcome: we do not assert an
    // authorization we cannot evidence.
    const mod = resolveReasonCodeModuleForContext(null, "FRAUDULENT");
    expect(mod.criticalCategories).toEqual(["payment_authentication", "billing_match"]);
  });

  it("leaves GENERAL on generic_fallback — its correct module, not a miss", () => {
    expect(resolveReasonCodeModuleForContext(null, "GENERAL").key).toBe("generic_fallback");
  });

  it("prefers the network code when one IS present (card path unchanged)", () => {
    // With a real Visa fraud code, the network code wins even if a
    // Shopify reason is also supplied.
    const mod = resolveReasonCodeModuleForContext("10.4", "PRODUCT_NOT_RECEIVED");
    expect(mod.key).toBe(resolveReasonCodeModule("10.4").key);
    expect(mod.key).toBe("visa_10_4_fraud");
  });
});
