/**
 * The admission test, one case per member:
 *
 *     Can citing this read AGAINST us under any claim type?
 *
 * Only "no" gets in. A fact that is merely WEAK elsewhere does not qualify —
 * weak evidence invites the issuer to answer it.
 *
 * Measured on prod 2026-08-03 (scripts/report-label-suppressed-facts.mjs):
 * 6 open disputes had `payment_authentication` excluded by the label their
 * bank chose, and 81 had `no_return_initiated` excluded because it is listed
 * in exactly one module and dropped by every other.
 */

import { describe, it, expect } from "vitest";
import { alwaysAdmissibleCategories, ALWAYS_ADMISSIBLE_RULES } from "../alwaysAdmissible";
import { buildLlmFactPayload } from "../narrativeWriter";
import { resolveReasonCodeModule } from "../reasonCodes/registry";
import type { EvidenceFact } from "../types";

function fact(overrides: Partial<EvidenceFact> & { value: Record<string, unknown> }): EvidenceFact {
  return {
    id: "f0",
    category: "payment_authentication",
    label: "Payment authentication",
    source: "shopify_transactions",
    sourceRef: null,
    strength: "moderate",
    bankEligible: true,
    merchantVisible: true,
    internalOnly: false,
    includeInBankNarrative: true,
    submissionRisk: false,
    confidence: null,
    ...overrides,
  } as EvidenceFact;
}

describe("every rule states why it cannot read against us", () => {
  it.each(ALWAYS_ADMISSIBLE_RULES.map((r) => [r.fieldKey, r] as const))(
    "%s carries a rationale",
    (_key, rule) => {
      expect(rule.rationale.length).toBeGreaterThan(40);
    },
  );
});

describe("3-D Secure", () => {
  it("admits a liability-shifted authentication", () => {
    const f = fact({ value: { fieldKey: "tds_authentication", liabilityShift: true, eci: "02" } });
    expect(alwaysAdmissibleCategories([f])).toEqual(["payment_authentication"]);
  });

  it("does NOT admit an attempted or exempted authentication", () => {
    // ECI 01/06 means authentication never completed; an exemption means it
    // was skipped and we kept the liability. Both read against us.
    const attempted = fact({
      value: { fieldKey: "tds_authentication", liabilityShift: false, eci: "06" },
    });
    expect(alwaysAdmissibleCategories([attempted])).toEqual([]);
  });
});

describe("AVS + CVV", () => {
  it("admits a both-matched result (strength strong)", () => {
    const f = fact({
      strength: "strong",
      value: { fieldKey: "avs_cvv_match", avsResult: "Y", cvvResult: "M" },
    });
    expect(alwaysAdmissibleCategories([f])).toEqual(["payment_authentication"]);
  });

  it("does NOT admit a partial match", () => {
    // Half a match invites the issuer to point at the other half. #352552's
    // own AVS came back N with CVV M — moderate, not strong.
    const partial = fact({
      strength: "moderate",
      value: { fieldKey: "avs_cvv_match", avsResult: "N", cvvResult: "M" },
    });
    expect(alwaysAdmissibleCategories([partial])).toEqual([]);
  });
});

describe("no_return_initiated", () => {
  it("is always admitted — orderSource emits it only in the positive state", () => {
    // orderSource.ts:219 emits it ONLY when returnStatus is NO_RETURN and no
    // refund was issued, so there is no adverse reading to protect against.
    const f = fact({
      category: "no_return_initiated",
      label: "No return initiated",
      source: "shopify_order",
      value: { fieldKey: "no_return_initiated", returnStatus: "NO_RETURN" },
    });
    expect(alwaysAdmissibleCategories([f])).toEqual(["no_return_initiated"]);
  });
});

describe("nothing is admitted for facts outside the set", () => {
  it("ignores ip_location and device_session", () => {
    const ip = fact({
      category: "ip_location",
      value: { fieldKey: "ip_location_check", locationMatch: "same_city" },
    });
    const device = fact({
      category: "device_session",
      value: { fieldKey: "device_session_consistency", consistent: true },
    });
    expect(alwaysAdmissibleCategories([ip, device])).toEqual([]);
  });
});

describe("the label can no longer suppress an admitted category", () => {
  const payloadFor = (moduleKey: string, facts: EvidenceFact[]) =>
    buildLlmFactPayload({
      packageId: "pkg0",
      disputeId: "d0",
      reasonCode: moduleKey,
      packageMode: "full",
      caseStrength: "moderate",
      reasonCodeModule: resolveReasonCodeModule(moduleKey),
      approvedFacts: facts,
      manualEvidence: [],
      internalOnlyFactIds: [],
      missingEvidence: [],
      strategies: [],
    } as never) as { reasonCodeGuidance: { allowedFactCategories: string[] } };

  it("product_unacceptable gains payment_authentication on a both-matched AVS/CVV", () => {
    expect(resolveReasonCodeModule("13.3").allowedFactCategories).not.toContain(
      "payment_authentication",
    );
    const payload = payloadFor("13.3", [
      fact({ strength: "strong", value: { fieldKey: "avs_cvv_match" } }),
    ]);
    expect(payload.reasonCodeGuidance.allowedFactCategories).toContain("payment_authentication");
  });

  it("inr_product_not_received gains no_return_initiated", () => {
    const payload = payloadFor("13.1", [
      fact({
        category: "no_return_initiated",
        value: { fieldKey: "no_return_initiated" },
      }),
    ]);
    expect(payload.reasonCodeGuidance.allowedFactCategories).toContain("no_return_initiated");
  });

  it("leaves the module untouched when nothing qualifies", () => {
    const payload = payloadFor("13.3", [
      fact({ strength: "moderate", value: { fieldKey: "avs_cvv_match" } }),
    ]);
    expect(payload.reasonCodeGuidance.allowedFactCategories).toEqual(
      resolveReasonCodeModule("13.3").allowedFactCategories,
    );
  });
});
