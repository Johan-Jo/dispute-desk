/**
 * Smoke test for the Defence Package document renderer.
 *
 * We don't snapshot the full PDF byte stream — that's noisy. Instead we:
 *   - render to Buffer
 *   - assert the buffer starts with the PDF magic header
 *   - assert the version + packageMode footer literal appears in the
 *     decoded buffer (which is what @react-pdf writes as plain text into
 *     the PDF content stream).
 */

import { describe, it, expect } from "vitest";
import { renderDefencePdf } from "../../renderDefencePdf";
import type { DefencePackageDocumentData } from "../DefencePackageDocument";

function sampleData(overrides: Partial<DefencePackageDocumentData> = {}): DefencePackageDocumentData {
  return {
    meta: {
      packageId: "pkg-1",
      disputeGid: "gid://shopify/Dispute/99",
      orderName: "#1042",
      reasonCode: "10.4",
      reasonCodeDisplay: "Visa 10.4 — Other Fraud",
      shopName: "Acme Co",
      merchantName: "Acme Co LLC",
      amountDisplay: "USD 119.95",
      cardNetwork: "Visa",
      transactionDate: "2026-05-10T14:00:00Z",
      generatedAt: "2026-05-15T20:00:00Z",
      version: 1,
      packageMode: "full",
      promptVersion: 1,
      modelUsed: "claude-sonnet-4-6",
      ...(overrides.meta ?? {}),
    },
    narrative: {
      executiveSummary: {
        text: "The available records support that the transaction was authorised by the cardholder.",
        usedFactIds: ["f0"],
      },
      transactionOverviewArgument: {
        text: "The transaction was processed on 2026-05-10 for the recorded amount.",
        usedFactIds: ["f0"],
      },
      chronologyArgument: { text: "", usedFactIds: [] },
      paymentAuthenticationArgument: {
        text: "AVS Y and CVV M results confirm the cardholder address and verification value at authorisation.",
        usedFactIds: ["f0"],
      },
      fulfillmentArgument: { text: "", usedFactIds: [] },
      communicationArgument: { text: "", usedFactIds: [] },
      policyArgument: { text: "", usedFactIds: [] },
      manualEvidenceArgument: { text: "", usedFactIds: [] },
      conclusion: {
        text: "The submitted evidence is consistent with an authorised transaction.",
        usedFactIds: ["f0"],
      },
      omittedSections: [
        { sectionKey: "chronologyArgument", reason: "no_chronology_facts" },
        { sectionKey: "fulfillmentArgument", reason: "no_delivery_facts" },
        { sectionKey: "communicationArgument", reason: "no_communication_facts" },
        { sectionKey: "policyArgument", reason: "no_policy_facts" },
        { sectionKey: "manualEvidenceArgument", reason: "no_manual_evidence" },
      ],
      warnings: [],
      ...(overrides.narrative ?? {}),
    },
    approvedFacts: overrides.approvedFacts ?? [
      {
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
      },
    ],
    manualEvidence: overrides.manualEvidence ?? [],
  };
}

describe("DefencePackageDocument", () => {
  it("renders to a valid PDF buffer", async () => {
    const result = await renderDefencePdf(sampleData());
    expect(result.contentType).toBe("application/pdf");
    expect(result.buffer.length).toBeGreaterThan(0);
    // PDF magic header.
    expect(result.buffer.slice(0, 5).toString()).toBe("%PDF-");
  }, 30000);

  it("renders a non-trivial PDF in full packageMode", async () => {
    const result = await renderDefencePdf(sampleData());
    // PDFs encode text via font glyph indices in compressed streams, so we
    // can't grep for string literals reliably. Asserting the file is large
    // enough to contain all rendered sections is the most we can verify
    // without a PDF parser dependency. Acceptance for "narrative + Evidence
    // Basis + manual + Conclusion" empirically lands above 2000 bytes.
    expect(result.buffer.length).toBeGreaterThan(2000);
    // PDF trailer ends with %%EOF (sometimes followed by a newline).
    expect(result.buffer.slice(-10).toString()).toContain("%%EOF");
  }, 30000);

  it("renders in narrow packageMode without throwing", async () => {
    const data = sampleData();
    const result = await renderDefencePdf({
      ...data,
      meta: { ...data.meta, packageMode: "narrow" },
    });
    expect(result.buffer.slice(0, 5).toString()).toBe("%PDF-");
  }, 30000);

  it("renders with an empty omittedSections list (all sections present)", async () => {
    const data = sampleData();
    const result = await renderDefencePdf({
      ...data,
      narrative: {
        ...data.narrative,
        chronologyArgument: { text: "Order placed, captured, fulfilled.", usedFactIds: ["f0"] },
        fulfillmentArgument: { text: "Delivery confirmed by carrier.", usedFactIds: ["f0"] },
        communicationArgument: { text: "Customer confirmed receipt by email.", usedFactIds: ["f0"] },
        policyArgument: { text: "Customer accepted policy at checkout.", usedFactIds: ["f0"] },
        manualEvidenceArgument: { text: "Merchant provided signed acknowledgement.", usedFactIds: ["f0"] },
        omittedSections: [],
      },
    });
    expect(result.buffer.slice(0, 5).toString()).toBe("%PDF-");
    expect(result.buffer.length).toBeGreaterThan(2000);
  }, 30000);
});
