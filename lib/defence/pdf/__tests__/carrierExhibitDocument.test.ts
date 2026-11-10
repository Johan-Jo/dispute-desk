/**
 * The document shows the carrier record the letter cites (whj8db-1q #24285,
 * 2026-11-10, credit not processed): carrier name, tracking number, the
 * carrier's delivery date and the tracking link, as the same shipment card the
 * other families print — and nothing of the kind when the letter argues no
 * delivery.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { PDFDocument, PDFArray, PDFRef, decodePDFRawStream } from "pdf-lib";
import type { PDFRawStream } from "pdf-lib";
import * as fs from "node:fs";
import { renderDefencePdf } from "../../renderDefencePdf";
import { DefencePackageDocument, type DefencePackageDocumentData } from "../DefencePackageDocument";
import { composePdfBlocks } from "../composePdfBlocks";
import type { DefenceNarrativeOutput, EvidenceFact } from "../../types";
import { carrierExhibitFacts } from "../../counsel/carrierExhibit";
import { ledgerForBrief } from "../../counsel/run";
import { CREDIT_NOT_PROCESSED_BRIEF } from "../../counsel/briefs";

const DELIVERY = {
  id: "f-delivery",
  category: "delivery_proof",
  label: "Delivery confirmation",
  value: {
    fieldKey: "delivery_proof",
    proofType: "delivered_confirmed",
    carrier: "DHL Freight (Sweden) AB",
    trackingNumber: "4134605023",
    trackingUrl: "https://track.example/4134605023",
    deliveredAt: "2026-10-22T16:07:00Z",
  },
  source: "shopify_fulfillments",
  sourceRef: null,
  strength: "strong",
  bankEligible: true,
  merchantVisible: true,
  internalOnly: false,
  includeInBankNarrative: true,
  submissionRisk: false,
  confidence: null,
} as unknown as EvidenceFact;

const fact = (id: string, category: string, value: Record<string, unknown>) =>
  ({ ...DELIVERY, id, category, label: category, value }) as unknown as EvidenceFact;

const ORDER = fact("f-order", "order_record", { fieldKey: "order_confirmation" });
const NO_RETURN = fact("f-noret", "no_return_initiated", { returnStatus: "NO_RETURN" });
const POLICY = fact("f-policy", "policy_refund", { fieldKey: "refund_policy", publishedOnStore: true });

const SECTIONS = [
  { type: "order", source: "shopify_order", data: { orderName: "#24285", createdAt: "2026-10-18T10:00:00Z" } },
  { type: "order", source: "shopify_order", data: { returnStatus: "NO_RETURN" } },
  {
    type: "shipping",
    source: "shopify_fulfillments",
    data: {
      fulfillments: [
        {
          createdAt: "2026-10-19T09:00:00Z",
          deliveredAt: "2026-10-22T16:07:00Z",
          shipmentProofType: "delivered_confirmed",
          tracking: [{ number: "4134605023", carrier: "DHL Freight (Sweden) AB" }],
        },
      ],
    },
  },
];

function dataFor(approvedFacts: EvidenceFact[], body?: string): DefencePackageDocumentData {
  const empty = { text: "", usedFactIds: [] };
  const narrative: DefenceNarrativeOutput = {
    executiveSummary: { text: body ?? "The record shows the order and its policy.", usedFactIds: ["f-order"] },
    transactionOverviewArgument: empty,
    chronologyArgument: empty,
    paymentAuthenticationArgument: empty,
    fulfillmentArgument: empty,
    communicationArgument: empty,
    policyArgument: empty,
    manualEvidenceArgument: empty,
    conclusion: { text: body ?? "The record is consistent.", usedFactIds: ["f-order"] },
    omittedSections: [],
    warnings: [],
  };
  const meta = {
    packageId: "pkg-1",
    disputeGid: "gid://shopify/Dispute/99",
    orderName: "#24285",
    reasonCode: "13.6",
    reasonCodeDisplay: "Visa 13.6 / Mastercard 4860",
    claimType: "Credit not processed claim",
    shopName: "Shop",
    merchantName: "Shop AB",
    amountDisplay: "SEK 1000",
    cardNetwork: "Visa",
    transactionDate: "2026-10-18T10:00:00Z",
    generatedAt: "2026-11-10T08:00:00Z",
    version: 19,
    packageMode: "full" as const,
    promptVersion: 2,
    modelUsed: "claude-sonnet-4-6",
    reasonCodeFamilyKey: "credit_not_processed",
    timelineEvents: [{ at: "2026-10-18T10:00:00Z", text: "The customer placed this order." }],
  };
  const composedBlocks = composePdfBlocks({
    narrative,
    approvedFacts,
    packageMode: meta.packageMode,
    familyKey: "credit_not_processed",
    moduleKey: "credit_not_processed",
    fulfillmentStatus: null,
  });
  return { meta, composedBlocks, approvedFacts, manualEvidence: [] } as DefencePackageDocumentData;
}

/** Every string and link target the document draws, in tree order. */
function textOf(node: React.ReactNode): string[] {
  if (node == null || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(textOf);
  const el = node as React.ReactElement<{ children?: React.ReactNode; src?: unknown }>;
  if (typeof el.type === "function") {
    return textOf((el.type as (p: unknown) => React.ReactNode)(el.props));
  }
  const own = typeof el.props?.src === "string" ? [el.props.src] : [];
  return [...own, ...textOf(el.props?.children)];
}

function render(approvedFacts: EvidenceFact[]): string {
  return textOf(React.createElement(DefencePackageDocument, { data: dataFor(approvedFacts) })).join("\n");
}

describe("credit not processed, the #24285 shape: the carrier record is in the document", () => {
  const plan = [ORDER, NO_RETURN, POLICY];
  const ledger = ledgerForBrief(
    CREDIT_NOT_PROCESSED_BRIEF,
    { moduleKey: "credit_not_processed", facts: [...plan, DELIVERY], packSections: SECTIONS, orderName: "#24285", disputeOpenedAt: "2026-11-05T08:00:00Z", disputeAmount: 1000, disputeCurrency: "SEK", customerOrders: [] },
    null,
  )!.ledger;

  it("prints carrier, tracking number, delivery date and tracking link", () => {
    const text = render([...plan, ...carrierExhibitFacts(ledger, plan, [DELIVERY])]);
    expect(text).toContain("DHL Freight (Sweden) AB");
    expect(text).toContain("4134605023");
    expect(text).toContain("https://track.example/4134605023");
    expect(text).toMatch(/Oct 22, 2026/);
    // Chronology row for the carrier's delivery.
    expect(text).toContain("Carrier recorded the shipment as delivered.");
  });

  it("before the fix (carrier record left out) the same letter showed none of it", () => {
    const text = render(plan);
    expect(text).not.toContain("DHL Freight (Sweden) AB");
    expect(text).not.toContain("4134605023");
  });

  it("a letter whose ledger argues no delivery shows no shipment card", () => {
    const noShipping = SECTIONS.filter((s) => s.type !== "shipping");
    const bare = ledgerForBrief(
      CREDIT_NOT_PROCESSED_BRIEF,
      { moduleKey: "credit_not_processed", facts: plan, packSections: noShipping, orderName: "#24285", disputeOpenedAt: "2026-11-05T08:00:00Z", disputeAmount: 1000, disputeCurrency: "SEK", customerOrders: [] },
      null,
    )!.ledger;
    const text = render([...plan, ...carrierExhibitFacts(bare, plan, [DELIVERY])]);
    expect(text).not.toContain("DHL Freight (Sweden) AB");
    expect(text).not.toContain("4134605023");
  });
});

describe("with the card and a long tracking URL the document still renders inside the PDF coordinate range", () => {
  it("emits no coordinate above 10000 on a 4+ page document", async () => {
    const longUrl = `https://track.example/${"segment/".repeat(25)}4134605023?ref=${"x".repeat(60)}`;
    const long = Array.from({ length: 16 }, (_, i) => `Paragraph ${i + 1}: the record shows the order and its policy, and the carrier's delivery.`).join("\n\n");
    const facts = [ORDER, NO_RETURN, POLICY, { ...DELIVERY, value: { ...(DELIVERY.value as object), trackingUrl: longUrl } } as EvidenceFact];
    const data = dataFor(facts, long);
    const { buffer } = await renderDefencePdf(data);
    if (process.env.SAMPLE_PDF_OUT) fs.writeFileSync(process.env.SAMPLE_PDF_OUT, buffer);
    const doc = await PDFDocument.load(buffer);
    const pages = doc.getPages();
    expect(pages.length).toBeGreaterThanOrEqual(4);
    for (const page of pages) {
      const contents = page.node.Contents();
      const refs = contents instanceof PDFArray ? Array.from({ length: contents.size() }, (_, i) => doc.context.lookup(contents.get(i) as PDFRef)) : [contents];
      const stream = refs.map((r) => Buffer.from(decodePDFRawStream(r as PDFRawStream).decode()).toString("latin1")).join("\n");
      const nums = (stream.replace(/<[0-9a-fA-F\s]*>/g, " ").match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
      expect(Math.max(0, ...nums.map(Math.abs))).toBeLessThanOrEqual(10000);
    }
  }, 120000);
});
