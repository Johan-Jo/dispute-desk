import { describe, it, expect } from "vitest";
import { buildLlmFactPayload } from "../narrativeWriter";
import { resolveReasonCodeModule } from "../reasonCodes/registry";
import type {
  EvidenceFact,
  NarrativeInput,
  ManualEvidenceRecord,
} from "../types";

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
    uploadedBy: null,
    uploadedAt: "2026-05-15T12:00:00Z",
    description: null,
    bankEligible: true,
    includeInPackage: true,
    includeInBankNarrative: false,
    evidenceCategory: "manual_evidence",
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

describe("buildLlmFactPayload", () => {
  it("includes normalised EvidenceFact records only", () => {
    const payload = buildLlmFactPayload(baseInput());
    expect(payload.approvedFacts).toBeDefined();
    expect(Array.isArray(payload.approvedFacts)).toBe(true);
    expect(payload.approvedFacts).toHaveLength(1);
  });

  it("does NOT include raw Shopify keys anywhere in the payload", () => {
    const synthRawShopifyFact = fact({
      value: {
        avsResult: "Y",
        cvvResult: "M",
        // Even if a classifier bug leaked these, the payload builder
        // forwards `value` as-is — so this test verifies the BUILDER
        // doesn't add raw-Shopify wrapping itself.
      },
    });
    const payload = buildLlmFactPayload(
      baseInput({ approvedFacts: [synthRawShopifyFact] }),
    );
    const json = JSON.stringify(payload);
    const FORBIDDEN_KEYS = [
      "pack_json",
      "order_gid",
      "paymentDetails",
      "fulfillments",
      "customerJourney",
      "shopifyProtect",
      "lineItems",
      "billingAddress",
      "shippingAddress",
      "receiptJson",
    ];
    for (const k of FORBIDDEN_KEYS) {
      expect(json).not.toContain(k);
    }
  });

  it("excludes submissionRisk facts unless includeInBankNarrative is true", () => {
    const payload = buildLlmFactPayload(
      baseInput({
        approvedFacts: [
          fact({ id: "f0" }),
          fact({ id: "f1", category: "ip_location", submissionRisk: true, includeInBankNarrative: false }),
        ],
      }),
    );
    const ids = (payload.approvedFacts as Array<{ id: string }>).map((f) => f.id);
    expect(ids).toContain("f0");
    expect(ids).not.toContain("f1");
  });

  it("respects ops override of includeInBankNarrative on submissionRisk facts", () => {
    const payload = buildLlmFactPayload(
      baseInput({
        approvedFacts: [
          fact({ id: "f0" }),
          fact({ id: "f1", category: "ip_location", submissionRisk: true, includeInBankNarrative: true }),
        ],
      }),
    );
    const ids = (payload.approvedFacts as Array<{ id: string }>).map((f) => f.id);
    expect(ids).toContain("f1");
  });

  it("forwards internalOnlyFactIds as ids only (no values)", () => {
    const payload = buildLlmFactPayload(
      baseInput({ internalOnlyFactIds: ["ip0", "device0"] }),
    );
    expect(payload.internalOnlyFactIds).toEqual(["ip0", "device0"]);
  });

  it("excludes manual evidence rows where includeInPackage=false", () => {
    const payload = buildLlmFactPayload(
      baseInput({
        manualEvidence: [
          manual({ id: "m1", includeInPackage: true }),
          manual({ id: "m2", includeInPackage: false }),
        ],
      }),
    );
    const ids = (payload.manualEvidence as Array<{ id: string }>).map((m) => m.id);
    expect(ids).toEqual(["m1"]);
  });

  it("includes packageMode + caseStrength + reasonCodeGuidance for the model to read", () => {
    const payload = buildLlmFactPayload(baseInput({ packageMode: "narrow" }));
    expect(payload.packageMode).toBe("narrow");
    expect(payload.caseStrength).toBe("moderate");
    expect((payload.reasonCodeGuidance as { key: string }).key).toBe("visa_10_4_fraud");
  });
});
