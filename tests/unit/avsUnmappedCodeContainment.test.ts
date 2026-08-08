import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { categorizeEvidenceField } from "@/lib/argument/canonicalEvidence";
import { buildInternalSignalsByField } from "@/lib/argument/internalSignals";
import { runClaimGuards } from "@/lib/defence/claimGuards";
import {
  classifyFacts,
  isFieldBankEligible,
  type ClassifyFactsInput,
} from "@/lib/defence/factClassifier";
import { FACT_PREDICATES } from "@/lib/defence/factPredicates";
import { buildEvidenceBasisRows } from "@/lib/defence/pdf/evidenceBasisRows";
import type { EvidenceFact, NarrativeSectionKey } from "@/lib/defence/types";
import { deriveCaseEvidenceModel } from "@/lib/evidence/model/derive";

/**
 * PR-C3 / C-13 — an unknown, missing or unmapped AVS code is RECORDED, and
 * that is all.
 *
 * Two halves, asserted separately because they pull in opposite directions:
 *
 *   RECORDED — no grade, no citation, no completeness credit, an internal
 *   diagnostic the merchant can see, and never an assertion against the
 *   cardholder.
 *
 *   NOT PARKED — holding such a code does not put the dispute into review.
 *   Escalation happens only when a package tries to RELY on it, and then the
 *   claim guard refuses the claim. Conflating the two would park every case
 *   whose issuer answered with a letter our map does not carry, which on this
 *   fleet would be a silent freeze on a population we cannot enumerate in
 *   advance.
 */

const UNMAPPED = { avsResultCode: "Q", cvvResultCode: "N", cardCompany: "Visa" } as const;
const UNMAPPED_WITH_CVV = { avsResultCode: "Q", cvvResultCode: "M" } as const;
const CITABLE = { avsResultCode: "Y", cvvResultCode: "M", cardCompany: "Visa" } as const;
const PARTIAL = { avsResultCode: "W", cvvResultCode: "N", cardCompany: "Mastercard" } as const;

function sectionsFor(payload: Record<string, unknown>) {
  return [
    {
      type: "payment",
      label: "Payment authentication",
      source: "shopify_transactions",
      data: payload,
      fieldsProvided: ["avs_cvv_match"],
    },
  ];
}

function classifyInput(payload: Record<string, unknown>): ClassifyFactsInput {
  return {
    packageId: "pkg_1",
    sections: sectionsFor(payload),
    evidenceItems: [],
    checklist: [],
    coverage: { state: "not_covered" },
    fatalLoss: { triggered: false, reason: null },
    caseStrength: "moderate",
    manualRows: [],
    reasonCodeModule: {
      allowedFactCategories: ["payment_authentication"],
      criticalCategories: [],
    } as unknown as ClassifyFactsInput["reasonCodeModule"],
  };
}

const authFact = (value: Record<string, unknown>): EvidenceFact => ({
  id: "f0",
  category: "payment_authentication",
  label: "Payment authentication",
  value,
  source: "shopify_transactions",
  sourceRef: null,
  strength: "moderate",
  bankEligible: true,
  merchantVisible: true,
  internalOnly: false,
  includeInBankNarrative: true,
  submissionRisk: false,
  confidence: null,
});

const sections = (text: string) =>
  ({ paymentAuthenticationArgument: { text } }) as unknown as Record<
    NarrativeSectionKey,
    { text: string }
  >;

describe("an unmapped AVS code earns nothing, on every consumer", () => {
  it("grade: invalid (no address credit)", () => {
    expect(categorizeEvidenceField("avs_cvv_match", UNMAPPED)).toBe("invalid");
  });

  it("citation: not bank-eligible", () => {
    expect(isFieldBankEligible("avs_cvv_match", UNMAPPED_WITH_CVV)).toBe(false);
  });

  it("completeness: the canonical model records no valid address evidence", () => {
    const { model } = deriveCaseEvidenceModel({
      disputeId: "d1",
      reason: "FRAUDULENT",
      sections: sectionsFor(UNMAPPED),
    });
    const field = model.fields.avs_cvv_match;
    expect(field?.records[0]?.validity.state).not.toBe("valid");
  });

  it("PDF: no Evidence Basis row, even from a fact with stale citable flags", () => {
    const rows = buildEvidenceBasisRows([authFact({ avsResult: "Q", cvvResult: "M" })]);
    expect(rows).toHaveLength(0);
  });

  it("merchant: an internal diagnostic that says what happened and claims nothing", () => {
    const signals = buildInternalSignalsByField(
      new Map<string, unknown>([["avs_cvv_match", UNMAPPED]]),
    );
    const diagnostic = (signals.get("avs_cvv_match") ?? []).find(
      (s) => s.id === "internal:avs_code_unmapped",
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.severity).toBe("info");
    expect(diagnostic?.reason).toContain("AVS Q");
    // It must not read as a verification failure, and must not imply a hold.
    expect(diagnostic?.reason).not.toMatch(/did not match|failed|on hold\b(?! because)/i);
    expect(diagnostic?.reason).toMatch(/not used as evidence/i);
  });

  it("a recognised code raises no such diagnostic", () => {
    for (const payload of [CITABLE, PARTIAL, { avsResultCode: "N" }, {}]) {
      const signals = buildInternalSignalsByField(
        new Map<string, unknown>([["avs_cvv_match", payload]]),
      );
      const diagnostic = (signals.get("avs_cvv_match") ?? []).find(
        (s) => s.id === "internal:avs_code_unmapped",
      );
      expect(diagnostic).toBeUndefined();
    }
  });
});

describe("recorded, NOT parked", () => {
  it("holding an unmapped code does not park a case that has other evidence", () => {
    // A real case carries more than one fact. The unmapped code sits beside
    // a delivery confirmation: the package proceeds on the delivery evidence,
    // the AVS row is merchant-visible and cites nothing, and no part of the
    // classification asks for review.
    const input = classifyInput(UNMAPPED_WITH_CVV);
    input.sections = [
      ...input.sections,
      {
        type: "fulfillment",
        label: "Delivery confirmation",
        source: "shopify_order",
        data: { proofType: "delivered_confirmed", deliveredAt: "2026-07-06T18:16:00Z" },
        fieldsProvided: ["delivery_proof"],
      },
    ];

    const result = classifyFacts(input);
    expect(result.eligible).toBe(true);
    expect(result.ineligibilityReason).toBeNull();

    const fact = result.approved.find(
      (f) => (f.value as { fieldKey?: string }).fieldKey === "avs_cvv_match",
    );
    expect(fact?.merchantVisible).toBe(true);
    expect(fact?.bankEligible).toBe(false);
    expect(buildEvidenceBasisRows(result.approved).some((r) => r.category === "payment_authentication")).toBe(
      false,
    );
  });

  it("an unmapped code ALONE leaves the ordinary no-bank-evidence outcome, not a new one", () => {
    // With nothing else on the case there is genuinely nothing to file, and
    // the classifier says so through its existing reason — the same answer it
    // gives for any case whose facts are all internal. C-13 adds no new
    // ineligibility state and no review flag.
    const result = classifyFacts(classifyInput(UNMAPPED_WITH_CVV));
    expect(result.eligible).toBe(false);
    expect(result.ineligibilityReason).toBe("no_bank_eligible_facts");
  });

  it("no code path turns an unmapped code into a review_required parking", () => {
    // Absence proven against the sources that CAN park a dispute, rather than
    // by observing one fixture not parking.
    const sources = [
      "lib/argument/paymentVerification.ts",
      "lib/argument/avsCodeMap.ts",
      "lib/argument/internalSignals.ts",
      "lib/defence/factClassifier.ts",
    ].map((rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8"));
    for (const src of sources) {
      expect(src).not.toMatch(/attention_reason/);
      expect(src).not.toMatch(/package_review_required/);
      expect(src).not.toMatch(/review_required/);
    }
  });

  it("a package that RELIES on the code is refused", () => {
    const { failures } = runClaimGuards({
      narrativeSections: sections(
        "AVS confirmed the billing address against the issuer's records.",
      ),
      approvedFacts: [authFact({ avsResult: "Q" })],
    });
    expect(failures.map((f) => f.guardId)).toContain("avs_address_verified_claim");
  });

  it("the predicate that authorizes an address claim is false for it", () => {
    expect(FACT_PREDICATES.avs_address_verified.evaluate([authFact({ avsResult: "Q" })])).toBe(
      false,
    );
  });
});

describe("decision 3 across the consumers — partial matches display, only Y/M cite", () => {
  it("a postal-only match stays merchant-visible and scored, and leaves no bank trace", () => {
    expect(categorizeEvidenceField("avs_cvv_match", PARTIAL)).toBe("moderate");
    expect(isFieldBankEligible("avs_cvv_match", PARTIAL)).toBe(false);
    expect(buildEvidenceBasisRows([authFact({ avsResult: "W" })])).toHaveLength(0);
    expect(FACT_PREDICATES.avs_address_verified.evaluate([authFact({ avsResult: "W" })])).toBe(
      false,
    );
  });

  it("a primary-sourced match still reaches the bank on every surface", () => {
    expect(isFieldBankEligible("avs_cvv_match", CITABLE)).toBe(true);
    const rows = buildEvidenceBasisRows([authFact({ avsResult: "Y", cvvResult: "M" })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toMatch(/billing address matched/i);
    expect(FACT_PREDICATES.avs_address_verified.evaluate([authFact({ avsResult: "Y" })])).toBe(
      true,
    );

    const { model } = deriveCaseEvidenceModel({
      disputeId: "d1",
      reason: "FRAUDULENT",
      sections: sectionsFor(CITABLE),
    });
    expect(model.fields.avs_cvv_match?.records[0]?.citation.eligibility).toBe("eligible");
  });
});
