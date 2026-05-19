/**
 * Bank-inclusion invariant — narrative writer must not introduce its
 * own bank-inclusion predicates. Every fact that reaches the LLM
 * payload as `approvedFacts` must satisfy the classifier's contract:
 *
 *   submissionRisk === false  OR  includeInBankNarrative === true
 *
 * If a future change adds a new "should this reach the bank?" check
 * inside `narrativeWriter.ts`, this test stays green only by accident.
 * The contract is: encode bank-inclusion logic in
 * `lib/defence/factClassifier.ts`, never in the narrative writer.
 *
 * See JSDoc on `buildLlmFactPayload` for the rationale.
 */

import { describe, it, expect } from "vitest";
import { buildLlmFactPayload } from "../narrativeWriter";
import { resolveReasonCodeModule } from "../reasonCodes/registry";
import type { EvidenceFact, NarrativeInput } from "../types";

function fact(overrides: Partial<EvidenceFact> = {}): EvidenceFact {
  return {
    id: "f0",
    category: "payment_authentication",
    label: "Payment authentication",
    value: { avsResult: "Y", cvvResult: "M" },
    source: "shopify_order",
    sourceRef: null,
    strength: "strong",
    bankEligible: true,
    merchantVisible: true,
    internalOnly: false,
    includeInBankNarrative: true,
    submissionRisk: false,
    confidence: null,
    ...overrides,
  };
}

function baseInput(overrides: Partial<NarrativeInput> = {}): NarrativeInput {
  return {
    packageId: "pkg-1",
    disputeId: "disp-1",
    reasonCode: "10.4",
    reasonCodeModule: resolveReasonCodeModule("10.4"),
    packageMode: "full",
    caseStrength: "moderate",
    approvedFacts: [fact()],
    manualEvidence: [],
    internalOnlyFactIds: [],
    missingEvidence: [],
    ...overrides,
  };
}

describe("narrativeWriter — bank-inclusion invariant", () => {
  it("a safe fact (submissionRisk=false) reaches the payload", () => {
    const payload = buildLlmFactPayload(baseInput());
    const approved = payload.approvedFacts as { id: string }[];
    expect(approved).toHaveLength(1);
    expect(approved[0]?.id).toBe("f0");
  });

  it("a submissionRisk fact WITHOUT the override is filtered out", () => {
    const risky = fact({
      id: "risky",
      submissionRisk: true,
      includeInBankNarrative: false,
    });
    const payload = buildLlmFactPayload(baseInput({ approvedFacts: [risky] }));
    const approved = payload.approvedFacts as { id: string }[];
    expect(approved).toHaveLength(0);
  });

  it("a submissionRisk fact WITH the override reaches the payload", () => {
    const overridden = fact({
      id: "overridden",
      submissionRisk: true,
      includeInBankNarrative: true,
    });
    const payload = buildLlmFactPayload(
      baseInput({ approvedFacts: [overridden] }),
    );
    const approved = payload.approvedFacts as { id: string }[];
    expect(approved).toHaveLength(1);
    expect(approved[0]?.id).toBe("overridden");
  });

  it("INVARIANT — every fact in the payload satisfies the classifier contract", () => {
    // Mix safe + risky + overridden + a fact that's marked internal-only.
    // The internal-only fact has submissionRisk=true (the classifier
    // sets these together), so it must NOT appear in the payload.
    const facts: EvidenceFact[] = [
      fact({ id: "safe", submissionRisk: false, includeInBankNarrative: true }),
      fact({ id: "risky", submissionRisk: true, includeInBankNarrative: false }),
      fact({
        id: "overridden",
        submissionRisk: true,
        includeInBankNarrative: true,
      }),
      fact({
        id: "internal",
        category: "ip_location",
        bankEligible: false,
        merchantVisible: true,
        internalOnly: true,
        includeInBankNarrative: false,
        submissionRisk: true,
      }),
    ];
    const payload = buildLlmFactPayload(baseInput({ approvedFacts: facts }));
    const approved = payload.approvedFacts as { id: string }[];

    // The risky + internal-only facts must be excluded.
    const ids = approved.map((f) => f.id);
    expect(ids).toContain("safe");
    expect(ids).toContain("overridden");
    expect(ids).not.toContain("risky");
    expect(ids).not.toContain("internal");

    // Direct invariant: scan the input by the same predicate the
    // classifier uses, and assert the payload is exactly that subset.
    const expectedIds = facts
      .filter((f) => !f.submissionRisk || f.includeInBankNarrative)
      .map((f) => f.id);
    expect(ids.sort()).toEqual(expectedIds.sort());
  });
});
