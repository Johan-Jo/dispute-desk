/**
 * The #347617 leak, pinned at the LLM PAYLOAD boundary.
 *
 * `paymentVerificationBankProjection.test.ts` pins the projection function in
 * isolation. This pins what actually reaches the model: the serialized
 * bank-facing payload `buildLlmFactPayload` hands to Claude.
 *
 * That distinction matters — the unit test would still pass if the call site
 * dropped the `category` argument, stopped calling the projection, or a future
 * fact shape omitted `fieldKey`. Only a payload-level assertion catches those.
 *
 * The persisted fact must survive untouched: the address signal is real and
 * internal scoring depends on it. What must not survive is any address-bearing
 * key reaching the model, which is what licensed
 * "both address verification and security-code verification were completed"
 * into the filed PDF for dispute #347617 in three places.
 */
import { describe, expect, it } from "vitest";

import { buildLlmFactPayload } from "../narrativeWriter";
import type { EvidenceFact, NarrativeInput } from "../types";

/** The production fact from #347617 v6, field-for-field. */
function fact347617(): EvidenceFact {
  return {
    id: "f9",
    category: "payment_authentication",
    label: "Payment authentication",
    value: {
      network: "mastercard",
      fieldKey: "avs_cvv_match",
      avsResult: null,
      cvvResult: null,
      addressVerified: true,
      verificationSummary: null,
      securityCodeVerified: true,
    },
    source: "shopify_transactions",
    sourceRef: null,
    strength: "strong",
    bankEligible: false,
    merchantVisible: true,
    internalOnly: false,
    submissionRisk: false,
    includeInBankNarrative: false,
    confidence: null,
  } as EvidenceFact;
}

/** Same fact with no `fieldKey` — category must still drive the projection. */
function fact347617WithoutFieldKey(): EvidenceFact {
  const f = fact347617();
  const value = { ...f.value };
  delete (value as Record<string, unknown>).fieldKey;
  return { ...f, value } as EvidenceFact;
}

function inputWith(facts: EvidenceFact[]): NarrativeInput {
  return {
    packageId: "pkg-347617",
    disputeId: "e1ffa26d-0c7e-40d4-b560-6327b2be826a",
    reasonCode: "4837",
    packageMode: "narrow",
    caseStrength: "weak",
    approvedFacts: facts,
    manualEvidence: [],
    missingEvidence: [],
    internalOnlyFactIds: [],
    reasonCodeModule: {
      key: "visa_10_4_fraud",
      allowedFactCategories: ["payment_authentication"],
      criticalCategories: [],
      prioritize: [],
      avoid: [],
      mustNotClaim: [],
      promptBody: "",
      version: 1,
    },
  } as unknown as NarrativeInput;
}

const ADDRESS_TOKENS = ["addressverified", "avsresult", "avs_result_code"];

describe("LLM fact payload — no address/AVS leak (#347617)", () => {
  it("serializes with neither an AVS nor an address key", () => {
    const payload = buildLlmFactPayload(inputWith([fact347617()]));
    const blob = JSON.stringify(payload).toLowerCase();

    for (const token of ADDRESS_TOKENS) {
      expect(blob).not.toContain(token);
    }
  });

  it("still excludes them when the value carries no fieldKey", () => {
    const payload = buildLlmFactPayload(
      inputWith([fact347617WithoutFieldKey()]),
    );
    const blob = JSON.stringify(payload).toLowerCase();

    for (const token of ADDRESS_TOKENS) {
      expect(blob).not.toContain(token);
    }
  });

  it("preserves the gateway-backed CVV signal", () => {
    const payload = buildLlmFactPayload(inputWith([fact347617()]));
    const blob = JSON.stringify(payload);

    expect(blob).toContain("securityCodeVerified");
  });

  it("leaves the persisted fact unmutated", () => {
    const fact = fact347617();
    const before = JSON.parse(JSON.stringify(fact));

    buildLlmFactPayload(inputWith([fact]));

    expect(fact).toEqual(before);
    expect((fact.value as Record<string, unknown>).addressVerified).toBe(true);
  });
});
