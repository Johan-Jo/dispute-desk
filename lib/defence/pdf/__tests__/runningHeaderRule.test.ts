/**
 * Regression: the running header's rule must stay inside the PDF coordinate
 * range.
 *
 * Since ~mid-October 2026 the header on pages 2+ drew its 0.75pt bottom border
 * from a garbage height that grew ~100x per page (page 4 reached 1.45e10).
 * Shopify's `dispute_file_uploads.json` validator rejects any PDF with a
 * coordinate outside the signed 32-bit range with HTTP 422 "There's a problem
 * with the uploaded file" — so every defence PDF of 4+ pages failed to upload.
 *
 * Asserts on the rendered content streams, not on the React tree.
 */

import { describe, it, expect } from "vitest";
import { PDFDocument, PDFArray, PDFRef, decodePDFRawStream } from "pdf-lib";
import type { PDFRawStream } from "pdf-lib";
import { renderDefencePdf } from "../../renderDefencePdf";
import type { DefenceNarrativeOutput } from "../../types";
import type { DefencePackageDocumentData } from "../DefencePackageDocument";
import { composePdfBlocks } from "../composePdfBlocks";

const LONG = Array.from(
  { length: 16 },
  (_, i) =>
    `Paragraph ${i + 1}: the available records support that the transaction was authorised by the cardholder, and the order was fulfilled to the address on file.`,
).join("\n\n");

function longData(): DefencePackageDocumentData {
  const section = { text: LONG, usedFactIds: ["f0"] };
  const empty = { text: "", usedFactIds: [] };
  const narrative: DefenceNarrativeOutput = {
    executiveSummary: section,
    transactionOverviewArgument: section,
    chronologyArgument: empty,
    paymentAuthenticationArgument: section,
    fulfillmentArgument: empty,
    communicationArgument: empty,
    policyArgument: empty,
    manualEvidenceArgument: empty,
    conclusion: section,
    omittedSections: [],
    warnings: [],
  };
  const approvedFacts = [
    {
      id: "f0",
      category: "payment_authentication" as const,
      label: "Payment authentication",
      value: { avsResult: "Y", cvvResult: "M" },
      source: "shopify_order" as const,
      sourceRef: null,
      strength: "strong" as const,
      bankEligible: true,
      merchantVisible: true,
      internalOnly: false,
      includeInBankNarrative: true,
      submissionRisk: false,
      confidence: null,
    },
  ];
  const meta = {
    packageId: "pkg-1",
    disputeGid: "gid://shopify/Dispute/99",
    orderName: "#1042",
    reasonCode: "10.4",
    reasonCodeDisplay: "Visa 10.4 / Mastercard 4837",
    claimType: "Unauthorized transaction claim",
    shopName: "Acme Co",
    merchantName: "Acme Co LLC",
    amountDisplay: "USD 119.95",
    cardNetwork: "Visa",
    transactionDate: "2026-05-10T14:00:00Z",
    generatedAt: "2026-05-15T20:00:00Z",
    version: 1,
    packageMode: "full" as const,
    promptVersion: 2,
    modelUsed: "claude-sonnet-4-6",
  };
  const composedBlocks = composePdfBlocks({
    narrative,
    approvedFacts,
    packageMode: meta.packageMode,
    familyKey: "unauthorized_fraud",
    moduleKey: null,
    fulfillmentStatus: null,
  });
  return { meta, composedBlocks, approvedFacts, manualEvidence: [] };
}

async function pageStreams(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const contents = page.node.Contents();
    const streams: unknown[] = [];
    if (contents instanceof PDFArray) {
      for (let i = 0; i < contents.size(); i++) {
        streams.push(doc.context.lookup(contents.get(i) as PDFRef));
      }
    } else {
      streams.push(contents);
    }
    return streams
      .map((s) => Buffer.from(decodePDFRawStream(s as PDFRawStream).decode()).toString("latin1"))
      .join("\n");
  });
}

/** Numeric operands only: hex strings `<...>` carry glyph ids, not coordinates. */
function numbers(stream: string): number[] {
  const stripped = stream.replace(/<[0-9a-fA-F\s]*>/g, " ");
  return (stripped.match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
}

describe("running header rule stays inside the PDF coordinate range", () => {
  it("emits no coordinate above 10000 on any page of a 6+ page document", async () => {
    const { buffer } = await renderDefencePdf(longData());
    const pages = await pageStreams(buffer);
    expect(pages.length).toBeGreaterThanOrEqual(6);
    for (const [i, s] of pages.entries()) {
      const worst = Math.max(0, ...numbers(s).map(Math.abs));
      expect(worst, `page ${i + 1} max |operand|`).toBeLessThanOrEqual(10000);
    }
  }, 120000);

  it("still draws the header rule on pages 2+ and not on page 1", async () => {
    const { buffer } = await renderDefencePdf(longData());
    const pages = await pageStreams(buffer);
    // The header is drawn in the top band (y = 28 for the two texts, 45 for
    // the rule). Page 1 must stay empty there; pages 2+ carry the title,
    // the case reference and one hairline-coloured rule.
    const HAIRLINE_FILL = "0.8980392156862745 0.9058823529411765 0.9215686274509803 scn";
    const header = pages.map((s) => ({
      texts: (s.match(/1 0 0 1 [\d.]+ 28 cm\nq\n1 0 0 1 0 [\d.]+ cm/g) ?? []).length,
      rules: (s.match(/1 0 0 1 45 45 cm[\s\S]{0,300}?0\.8980392156862745 0\.9058823529411765 0\.9215686274509803 scn/g) ?? []).length,
      // Guard the pattern itself: the colour literal must be the real hairline.
      hairlineFills: s.split(HAIRLINE_FILL).length - 1,
    }));
    expect(header[0]).toMatchObject({ texts: 0, rules: 0 });
    for (const h of header.slice(1)) {
      expect(h.texts).toBe(2); // title left, case reference right
      expect(h.rules).toBe(1);
      expect(h.hairlineFills).toBeGreaterThanOrEqual(1);
    }
  }, 120000);
});
