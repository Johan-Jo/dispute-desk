/**
 * Bank-claim plan F2: the letter build and the filing-time plan check must
 * resolve the SAME module for a GENERAL dispute the bank's claim re-typed.
 * The module's allowed categories feed `plan_input_hash`; resolving it from
 * Shopify's reason at filing made every claim-typed letter read stale.
 */
import { describe, it, expect } from "vitest";
import { derivePlanIdentityForPack } from "@/lib/defence/package";
import { resolveCaseReasonCodeModule } from "@/lib/defence/reasonCodes/registry";
import { healthyPackJson } from "@/tests/fixtures/defencePackageShapes";

const identity = (packJson: Record<string, unknown>) =>
  derivePlanIdentityForPack({
    caseId: "case-1",
    packId: "pack-1",
    packJson,
    evidenceItems: [],
    checklist: [],
    disputeReason: "GENERAL",
    networkReasonCode: null,
  });

describe("claim-typed case: build and filing agree on the module", () => {
  it("the filing check uses the reason the pack was assessed under", () => {
    const planned = identity(healthyPackJson({ case_assessment_reason: "PRODUCT_UNACCEPTABLE" }));
    expect(planned.plan.reasonModuleId).toBe("product_unacceptable");
  });

  it("without a claim it stays on Shopify's reason", () => {
    expect(identity(healthyPackJson()).plan.reasonModuleId).toBe("generic_fallback");
  });

  it("the hash differs between the two, so reading the wrong reason is detectable", () => {
    const claimTyped = identity(healthyPackJson({ case_assessment_reason: "PRODUCT_UNACCEPTABLE" }));
    const shopify = identity(healthyPackJson());
    expect(claimTyped.planInputHash).not.toBe(shopify.planInputHash);
  });

  it("the build's resolver gives the same module for the same inputs", () => {
    const m = resolveCaseReasonCodeModule({
      networkReasonCode: null,
      shopifyReason: "GENERAL",
      caseReason: "PRODUCT_UNACCEPTABLE",
    });
    expect(m.key).toBe("product_unacceptable");
  });

  it("a network reason code always wins over the claim", () => {
    const m = resolveCaseReasonCodeModule({
      networkReasonCode: "10.4",
      shopifyReason: "GENERAL",
      caseReason: "PRODUCT_UNACCEPTABLE",
    });
    expect(m.key).toBe("visa_10_4_fraud");
  });

  it("a card dispute with no network code routes on Shopify's reason, not generic_fallback", () => {
    // Prod order #353605: Amex via Shopify Payments, network_reason_code NULL,
    // reason PRODUCT_NOT_RECEIVED. It was argued as "Generic representment /
    // Unmapped chargeback claim" because enum routing was non-card only.
    const m = resolveCaseReasonCodeModule({
      networkReasonCode: null,
      shopifyReason: "PRODUCT_NOT_RECEIVED",
      caseReason: "PRODUCT_NOT_RECEIVED",
    });
    expect(m.key).toBe("inr_product_not_received");
  });

  it("GENERAL with no network code stays on generic_fallback", () => {
    const m = resolveCaseReasonCodeModule({
      networkReasonCode: null,
      shopifyReason: "GENERAL",
      caseReason: "GENERAL",
    });
    expect(m.key).toBe("generic_fallback");
  });
});
