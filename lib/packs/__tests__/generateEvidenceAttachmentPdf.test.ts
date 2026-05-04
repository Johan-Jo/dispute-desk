/**
 * `generateEvidenceAttachmentPdf` smoke tests.
 *
 * Each `attachmentType` produces non-empty PDF bytes that:
 *   - start with the PDF magic header (`%PDF-`)
 *   - exit cleanly within the size cap (Phase 0c: 2,097,152 bytes)
 *
 * We keep these intentionally minimal — the layout is exercised
 * end-to-end only when an integration test renders against a real
 * Shopify dispute. Pinning content-byte expectations would lock the
 * suite to font metrics + react-pdf internals, both of which drift.
 */
import { describe, expect, it } from "vitest";
import { generateEvidenceAttachmentPdf } from "../generateEvidenceAttachmentPdf";
import { MAX_FILE_SIZE_BYTES } from "@/lib/shopify/disputeFileUpload";
import type { AttachmentType } from "@/lib/shopify/decideFileAttachments";
import type { RawPackSection } from "@/lib/shopify/fieldMapping";

function pdfStartsWithHeader(buf: Buffer): boolean {
  return buf.slice(0, 5).toString("utf8") === "%PDF-";
}

const SHIPPING_SECTION: RawPackSection = {
  type: "shipping",
  label: "Shipping",
  source: "shopify",
  data: {
    overallStatus: "DELIVERED",
    fulfillments: [
      {
        status: "FULFILLED",
        createdAt: "2026-04-11T10:00:00Z",
        deliveredAt: "2026-04-13T14:00:00Z",
        tracking: [{ carrier: "UPS", number: "1Z999AA10123456784" }],
      },
    ],
  },
};

const CASES: Array<{ type: AttachmentType; fieldKey: string; label: string; sections: RawPackSection[]; payload: Record<string, unknown> | null }> = [
  {
    type: "delivery",
    fieldKey: "delivery_proof",
    label: "Carrier signature",
    sections: [SHIPPING_SECTION],
    payload: { proofType: "signature_confirmed" },
  },
  {
    type: "communication",
    fieldKey: "customer_communication",
    label: "Customer email thread",
    sections: [],
    payload: { customerConfirmsOrder: true },
  },
  {
    type: "service",
    fieldKey: "activity_log",
    label: "Service usage log",
    sections: [],
    payload: { digitalAccessUsed: true, lastAccessedAt: "2026-04-15T09:00:00Z" },
  },
  {
    type: "policy",
    fieldKey: "refund_policy",
    label: "Refund policy acceptance",
    sections: [],
    payload: {
      acceptedAtCheckout: true,
      acceptanceTimestamp: "2026-01-15T00:00:00Z",
      text: "All sales final after 30 days. Buyer accepts these terms at checkout.",
    },
  },
  {
    type: "other",
    fieldKey: "supporting_documents",
    label: "Signed agreement",
    sections: [],
    payload: { signedContract: true },
  },
];

describe("generateEvidenceAttachmentPdf", () => {
  for (const c of CASES) {
    it(`${c.type} → produces valid PDF bytes under the 2 MiB cap`, async () => {
      const buf = await generateEvidenceAttachmentPdf({
        attachmentType: c.type,
        evidenceFieldKey: c.fieldKey,
        reason: `Test reason for ${c.type} — strong signal; attached natively to amplify visibility.`,
        shopDomain: "shop.myshopify.com",
        disputeId: "10519937081",
        sections: c.sections,
        label: c.label,
        payload: c.payload,
        generatedAtIso: "2026-05-03T19:00:00.000Z",
      });
      expect(pdfStartsWithHeader(buf)).toBe(true);
      expect(buf.length).toBeGreaterThan(500);
      expect(buf.length).toBeLessThan(MAX_FILE_SIZE_BYTES);
    }, 30_000);
  }

  it("delivery PDF with rich fulfillment data is larger than one without", async () => {
    // @react-pdf renders text via font glyph maps, so we cannot grep
    // for literal strings in the binary output. Instead compare byte
    // sizes — a fact-rich document is reliably larger than a sparse
    // one even after font-stream compression.
    const rich = await generateEvidenceAttachmentPdf({
      attachmentType: "delivery",
      evidenceFieldKey: "delivery_proof",
      reason: "Carrier signature evidence",
      shopDomain: "shop.myshopify.com",
      disputeId: "10519937081",
      sections: [SHIPPING_SECTION],
      label: "Carrier signature",
      payload: { proofType: "signature_confirmed" },
    });
    const sparse = await generateEvidenceAttachmentPdf({
      attachmentType: "delivery",
      evidenceFieldKey: "delivery_proof",
      reason: "Carrier signature evidence",
      shopDomain: "shop.myshopify.com",
      disputeId: "10519937081",
      sections: [],
      label: "Carrier signature",
      payload: null,
    });
    expect(rich.length).toBeGreaterThan(sparse.length);
  }, 30_000);

  it("policy PDF with body text is larger than one without", async () => {
    const withBody = await generateEvidenceAttachmentPdf({
      attachmentType: "policy",
      evidenceFieldKey: "refund_policy",
      reason: "Refund policy acceptance",
      shopDomain: "shop.myshopify.com",
      disputeId: "10519937081",
      sections: [],
      label: "Refund policy",
      payload: {
        acceptedAtCheckout: true,
        acceptanceTimestamp: "2026-01-15T00:00:00Z",
        text: "All sales final after 30 days. " + "Filler text. ".repeat(50),
      },
    });
    const noBody = await generateEvidenceAttachmentPdf({
      attachmentType: "policy",
      evidenceFieldKey: "refund_policy",
      reason: "Refund policy acceptance",
      shopDomain: "shop.myshopify.com",
      disputeId: "10519937081",
      sections: [],
      label: "Refund policy",
      payload: { acceptedAtCheckout: true },
    });
    expect(withBody.length).toBeGreaterThan(noBody.length);
  }, 30_000);

  it("rejects unknown attachmentType (compile-time safe; runtime guard for test coverage)", async () => {
    await expect(
      generateEvidenceAttachmentPdf({
        // @ts-expect-error — intentionally bad input
        attachmentType: "not_a_real_type",
        evidenceFieldKey: "delivery_proof",
        reason: "x",
        shopDomain: "shop.myshopify.com",
        disputeId: "10519937081",
        sections: [],
      }),
    ).rejects.toThrow(/Unknown attachmentType/);
  });
});
