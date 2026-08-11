import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { categorizeEvidenceField } from "@/lib/argument/canonicalEvidence";
import { deriveEvidenceLineItems } from "@/lib/argument/evidenceLineItem";
import { runClaimGuards } from "@/lib/defence/claimGuards";
import {
  classifyFacts,
  isFieldBankEligible,
  isUnciteablePaymentVerificationFact,
  type ClassifyFactsInput,
} from "@/lib/defence/factClassifier";
import { FACT_PREDICATES } from "@/lib/defence/factPredicates";
import { THESIS_TOKENS } from "@/lib/defence/pdf/thesisTokens";
import { buildEvidenceBasisRows } from "@/lib/defence/pdf/evidenceBasisRows";
import type { EvidenceFact, NarrativeSectionKey } from "@/lib/defence/types";
import { deriveCaseEvidenceModel } from "@/lib/evidence/model/derive";

/**
 * PR-C2 / C-12, DECISION 1 — a CVV-only match is a valid internal merchant
 * fact and is NOT issuer-citable.
 *
 * This file asserts the containment on the FACT LAYER at every boundary that
 * can reach an issuer, not on generated prose. Prose checks catch the
 * phrasings you thought of; a fact that is never citable cannot be phrased
 * into the letter at all.
 *
 * The population this protects is real: `avs_cvv_match` grades `moderate` on
 * a CVV-only match, and `moderate` was bank-eligible, so the security-code
 * match travelled into the LLM payload, the Evidence Basis table and the
 * thesis as if it corroborated the address — under a Visa CE rule (register
 * R-E) that is about the address specifically.
 */

const CVV_ONLY = { avsResultCode: "N", cvvResultCode: "M" } as const;
const CVV_ONLY_NO_AVS = { cvvResultCode: "M" } as const;
const BOTH = { avsResultCode: "Y", cvvResultCode: "M", cardCompany: "Visa" } as const;
const AVS_ONLY = { avsResultCode: "Y", cvvResultCode: "N", cardCompany: "Visa" } as const;

function sectionsFor(payload: Record<string, unknown>) {
  return [
    {
      type: "payment",
      label: "Payment authentication",
      source: "shopify_order",
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

describe("decision 1 — the grade is untouched", () => {
  it("a CVV-only match still grades moderate, so scoring and completeness do not move", () => {
    expect(categorizeEvidenceField("avs_cvv_match", CVV_ONLY)).toBe("moderate");
    expect(categorizeEvidenceField("avs_cvv_match", CVV_ONLY_NO_AVS)).toBe("moderate");
  });
});

describe("decision 1 — bank eligibility", () => {
  it("withholds a CVV-only match", () => {
    expect(isUnciteablePaymentVerificationFact("avs_cvv_match", CVV_ONLY)).toBe(true);
    expect(isFieldBankEligible("avs_cvv_match", CVV_ONLY)).toBe(false);
    expect(isFieldBankEligible("avs_cvv_match", CVV_ONLY_NO_AVS)).toBe(false);
  });

  it("leaves the address cases exactly as they were", () => {
    expect(isFieldBankEligible("avs_cvv_match", BOTH)).toBe(true);
    expect(isFieldBankEligible("avs_cvv_match", AVS_ONLY)).toBe(true);
  });

  it("does not touch other fields", () => {
    expect(isUnciteablePaymentVerificationFact("tds_authentication", CVV_ONLY)).toBe(false);
  });
});

describe("decision 1 — the classified fact", () => {
  it("is approved, merchant-visible, and excluded from every bank surface", () => {
    const result = classifyFacts(classifyInput(CVV_ONLY));
    const fact = result.approved.find(
      (f) => (f.value as { fieldKey?: string }).fieldKey === "avs_cvv_match",
    );
    expect(fact).toBeDefined();
    expect(fact?.merchantVisible).toBe(true);
    expect(fact?.strength).toBe("moderate");
    expect(fact?.bankEligible).toBe(false);
    expect(fact?.includeInBankNarrative).toBe(false);
  });

  it("carries NO quotable codes or summary — nothing to misuse downstream", () => {
    const result = classifyFacts(classifyInput(CVV_ONLY));
    const value = result.approved.find(
      (f) => (f.value as { fieldKey?: string }).fieldKey === "avs_cvv_match",
    )?.value as Record<string, unknown>;
    expect(value.verificationSummary).toBeNull();
    expect(value.avsResult).toBeNull();
    expect(value.cvvResult).toBeNull();
    expect(value.securityCodeVerified).toBe(true);
    expect(value.addressVerified).toBe(false);
  });

  it("keeps the both-matched fact citable, with its summary intact", () => {
    const result = classifyFacts(classifyInput(BOTH));
    const fact = result.approved.find(
      (f) => (f.value as { fieldKey?: string }).fieldKey === "avs_cvv_match",
    );
    expect(fact?.bankEligible).toBe(true);
    expect((fact?.value as Record<string, unknown>).verificationSummary).toContain(
      "billing address matched",
    );
  });
});

describe("decision 1 — the Evidence Basis table", () => {
  const factOf = (value: Record<string, unknown>): EvidenceFact => ({
    id: "f0",
    category: "payment_authentication",
    label: "Payment authentication",
    value,
    source: "shopify_order",
    sourceRef: null,
    strength: "moderate",
    bankEligible: true,
    merchantVisible: true,
    internalOnly: false,
    includeInBankNarrative: true,
    submissionRisk: false,
    confidence: null,
  });

  it("cannot print a bare CVV match, even when handed a legacy fact that carries the codes", () => {
    const rows = buildEvidenceBasisRows([factOf({ avsResult: "N", cvvResult: "M" })]);
    const printed = rows.map((r) => r.value).join(" | ");
    expect(printed).not.toMatch(/CVV/i);
    expect(printed).not.toMatch(/verification code/i);
  });

  it("still prints the address match", () => {
    const rows = buildEvidenceBasisRows([factOf({ network: "visa", avsResult: "Y", cvvResult: "M" })]);
    expect(rows.map((r) => r.value).join(" | ")).toMatch(/billing address matched/i);
  });
});

describe("decision 1 — claim guards and thesis tokens", () => {
  const authFact = (value: Record<string, unknown>): EvidenceFact => ({
    id: "f0",
    category: "payment_authentication",
    label: "Payment authentication",
    value,
    source: "shopify_order",
    sourceRef: null,
    strength: "moderate",
    bankEligible: false,
    merchantVisible: true,
    internalOnly: false,
    includeInBankNarrative: false,
    submissionRisk: false,
    confidence: null,
  });

  const sections = (text: string) =>
    ({ paymentAuthenticationArgument: { text } }) as unknown as Record<
      NarrativeSectionKey,
      { text: string }
    >;

  it("an address claim FAILS on a CVV-only case", () => {
    const { failures } = runClaimGuards({
      narrativeSections: sections(
        "AVS confirmed the billing address against the issuer's records.",
      ),
      approvedFacts: [authFact({ avsResult: "N", cvvResult: "M" })],
    });
    expect(failures.map((f) => f.guardId)).toContain("avs_address_verified_claim");
  });

  it("an address claim FAILS when AVS was merely present and did not match", () => {
    const { failures } = runClaimGuards({
      narrativeSections: sections("The billing address matched the issuer's records."),
      approvedFacts: [authFact({ avsResult: "N" })],
    });
    expect(failures.map((f) => f.guardId)).toContain("avs_address_verified_claim");
  });

  it("an address claim PASSES on a real AVS match", () => {
    const { failures } = runClaimGuards({
      narrativeSections: sections("AVS confirmed the billing address."),
      approvedFacts: [authFact({ network: "visa", avsResult: "Y" })],
    });
    expect(failures).toHaveLength(0);
  });

  it("the thesis token stays null on a CVV-only case", () => {
    const token = THESIS_TOKENS.paymentAuthMethod;
    expect(token.extract([authFact({ avsResult: "N", cvvResult: "M" })])).toBeNull();
  });

  it("the two predicates never substitute for each other", () => {
    const facts = [authFact({ cvvResult: "M" })];
    expect(FACT_PREDICATES.cvv_verified.evaluate(facts)).toBe(true);
    expect(FACT_PREDICATES.avs_address_verified.evaluate(facts)).toBe(false);
    expect(FACT_PREDICATES.avs_and_cvv_match.evaluate(facts)).toBe(false);
  });
});

describe("decision 1 — the canonical evidence model agrees", () => {
  it("marks a CVV-only record valid but withheld from citation", () => {
    const { model } = deriveCaseEvidenceModel({
      disputeId: "d1",
      reason: "FRAUDULENT",
      sections: sectionsFor(CVV_ONLY),
    });
    const field = model.fields.avs_cvv_match;
    expect(field?.records[0]?.validity.state).toBe("valid");
    expect(field?.records[0]?.citation.eligibility).toBe("withheld_risk");
  });

  it("keeps an address match eligible", () => {
    const { model } = deriveCaseEvidenceModel({
      disputeId: "d1",
      reason: "FRAUDULENT",
      sections: sectionsFor(BOTH),
    });
    expect(model.fields.avs_cvv_match?.records[0]?.citation.eligibility).toBe("eligible");
  });
});

describe("decision 1 — the merchant still sees it", () => {
  it("renders the row with the internal-only reason, not silence", () => {
    const items = deriveEvidenceLineItems({
      checklist: [
        { field: "avs_cvv_match", label: "Payment authentication", status: "available" },
      ] as never,
      facts: [],
      payloadByField: new Map<string, unknown>([["avs_cvv_match", CVV_ONLY]]),
      contributions: { strong: [], moderate: [] },
      packSavedToShopify: false,
      excludedFields: new Set<string>(),
      attachmentUploadFailures: new Map<string, string>(),
      inclusionOverrides: new Map(),
      reasonFamily: "fraud",
    });
    const row = items.find((i) => i.field === "avs_cvv_match");
    expect(row).toBeDefined();
    expect(row?.bankEligible).toBe(false);
    expect(JSON.stringify(row)).toContain("cvvOnlyInternal");
  });
});

describe("decision 2 — one grouped payment-verification requirement", () => {
  it("no reason template gained a second payment-verification row", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "lib/automation/completeness.ts"),
      "utf8",
    );
    // The split lives under the existing row, not beside it. A new
    // `avs_result` / `cvv_result` checklist field would change the
    // completeness denominator P-7 later calibrates on.
    expect(source).not.toMatch(/field:\s*"avs_result"/);
    expect(source).not.toMatch(/field:\s*"cvv_result"/);
    const rows = source.match(/field:\s*"avs_cvv_match"/g) ?? [];
    expect(rows.length).toBe(2); // one per template, unchanged by PR-C2
  });
});
