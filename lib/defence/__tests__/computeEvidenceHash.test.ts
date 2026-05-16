import { describe, it, expect } from "vitest";
import { computeEvidenceHash } from "../computeEvidenceHash";
import type { EvidenceFact, ManualEvidenceRecord } from "../types";

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

function manual(overrides: Partial<ManualEvidenceRecord> = {}): ManualEvidenceRecord {
  return {
    id: "m0",
    packageId: "pkg0",
    evidenceItemId: "ei0",
    filename: "receipt.pdf",
    fileUrl: null,
    fileType: "application/pdf",
    uploadedBy: "merchant",
    uploadedAt: "2026-05-15T12:00:00Z",
    description: null,
    bankEligible: true,
    includeInPackage: true,
    includeInBankNarrative: false,
    evidenceCategory: null,
    ...overrides,
  };
}

describe("computeEvidenceHash", () => {
  it("is deterministic across calls with identical input", () => {
    const a = computeEvidenceHash({
      approvedFacts: [fact(), fact({ id: "f1", category: "delivery_proof" })],
      manualEvidence: [manual()],
      reasonCode: "10.4",
    });
    const b = computeEvidenceHash({
      approvedFacts: [fact(), fact({ id: "f1", category: "delivery_proof" })],
      manualEvidence: [manual()],
      reasonCode: "10.4",
    });
    expect(a).toBe(b);
  });

  it("is insensitive to fact ordering", () => {
    const a = computeEvidenceHash({
      approvedFacts: [
        fact({ id: "a" }),
        fact({ id: "b", category: "delivery_proof" }),
      ],
      manualEvidence: [],
      reasonCode: "10.4",
    });
    const b = computeEvidenceHash({
      approvedFacts: [
        fact({ id: "b", category: "delivery_proof" }),
        fact({ id: "a" }),
      ],
      manualEvidence: [],
      reasonCode: "10.4",
    });
    expect(a).toBe(b);
  });

  it("is insensitive to timestamp drift on manual rows", () => {
    const a = computeEvidenceHash({
      approvedFacts: [fact()],
      manualEvidence: [manual({ uploadedAt: "2026-05-15T12:00:00Z" })],
      reasonCode: "10.4",
    });
    const b = computeEvidenceHash({
      approvedFacts: [fact()],
      manualEvidence: [manual({ uploadedAt: "2026-05-15T13:30:00Z" })],
      reasonCode: "10.4",
    });
    expect(a).toBe(b);
  });

  it("changes when a fact's value mutates", () => {
    const a = computeEvidenceHash({
      approvedFacts: [fact()],
      manualEvidence: [],
      reasonCode: "10.4",
    });
    const b = computeEvidenceHash({
      approvedFacts: [fact({ value: { avsResult: "N", cvvResult: "M" } })],
      manualEvidence: [],
      reasonCode: "10.4",
    });
    expect(a).not.toBe(b);
  });

  it("changes when reason code changes", () => {
    const a = computeEvidenceHash({
      approvedFacts: [fact()],
      manualEvidence: [],
      reasonCode: "10.4",
    });
    const b = computeEvidenceHash({
      approvedFacts: [fact()],
      manualEvidence: [],
      reasonCode: "13.1",
    });
    expect(a).not.toBe(b);
  });

  it("changes when manual evidence changes bank-eligibility", () => {
    const a = computeEvidenceHash({
      approvedFacts: [fact()],
      manualEvidence: [manual({ bankEligible: true })],
      reasonCode: "10.4",
    });
    const b = computeEvidenceHash({
      approvedFacts: [fact()],
      manualEvidence: [manual({ bankEligible: false })],
      reasonCode: "10.4",
    });
    expect(a).not.toBe(b);
  });
});
