/**
 * `composeShopifyMutationPayload` with `attachmentPlan` — link
 * suppression + native *File field setting (Phase 4 of conditional
 * file evidence layer).
 *
 * Backwards compat is pinned by `saveToShopify.snapshot.test.ts`
 * (default empty plan = byte-identical output). This file covers the
 * new flag-on path:
 *
 *   - the matching *File field is set on the input for native entries
 *     with a confirmed GID
 *   - the merchant's original link STAYS in the prose (no suppression)
 *     because the synthesised native PDF and the original upload are
 *     different artefacts; both reach the issuer (complementary, not
 *     duplicate)
 *   - pack PDF link is preserved (Q3=B)
 *   - link-only entries (kind: "link") leave the link in place
 *
 * No I/O. Pure function tests.
 */
import { describe, expect, it } from "vitest";
import {
  composeShopifyMutationPayload,
  type ResolvedAttachmentPlanEntry,
} from "../composeShopifyMutationPayload";

const SECTIONS = [
  {
    type: "order",
    label: "Order",
    source: "shopify",
    data: { orderName: "#1234", total: "150.00", currency: "USD" },
  },
];

const MANUAL_DELIVERY = {
  id: "ev-delivery-1",
  checklistField: "delivery_proof",
  label: "Carrier signature",
  fileName: "carrier-signature.pdf",
  fileSize: 12345,
  createdAt: "2026-04-30T00:00:00Z",
  url: "https://disputedesk.app/e/ABC123DEFG",
};

const MANUAL_COMM = {
  id: "ev-comm-1",
  checklistField: "customer_communication",
  label: "Customer email thread",
  fileName: "emails.pdf",
  fileSize: 4567,
  createdAt: "2026-04-30T00:00:00Z",
  url: "https://disputedesk.app/e/ZYX987WVUT",
};

const PACK_PDF = { url: "https://disputedesk.app/e/PACK000PDF1" };

function baseInput() {
  return {
    sections: SECTIONS,
    rebuttalText: "Rebuttal narrative.",
    disputeReason: "FRAUDULENT" as const,
    customer: { displayName: "Jane Doe", email: "jane@example.com" },
    manualAttachments: [MANUAL_DELIVERY, MANUAL_COMM],
    pdfAttachment: PACK_PDF,
  };
}

describe("composeShopifyMutationPayload — attachmentPlan integration", () => {
  it("native plan entry with confirmed GID → sets *File field; merchant's link STAYS (synthesised ≠ original)", () => {
    const plan: ResolvedAttachmentPlanEntry[] = [
      {
        evidenceItemId: "ev-delivery-1",
        evidenceFieldKey: "delivery_proof",
        resolvedSlot: { kind: "native", targetField: "shippingDocumentationFile", origin: "primary" },
        fileGid: "gid://shopify/ShopifyPaymentsDisputeFileUpload/123",
      },
    ];
    const out = composeShopifyMutationPayload({ ...baseInput(), attachmentPlan: plan });

    expect(out.shippingDocumentationFile).toEqual({
      id: "gid://shopify/ShopifyPaymentsDisputeFileUpload/123",
    });
    // Native attachment is a synthesised PDF — different bytes from the
    // merchant's original upload. Both reach the issuer: the
    // synthesised PDF in the named row, the original upload as a link.
    expect(out.uncategorizedText).toContain(MANUAL_DELIVERY.url);
    expect(out.uncategorizedText).toContain(MANUAL_COMM.url);
  });

  it("pack PDF link is always preserved (Q3=B), even when other items are natively attached", () => {
    const plan: ResolvedAttachmentPlanEntry[] = [
      {
        evidenceItemId: "ev-delivery-1",
        evidenceFieldKey: "delivery_proof",
        resolvedSlot: { kind: "native", targetField: "shippingDocumentationFile", origin: "primary" },
        fileGid: "gid://shopify/ShopifyPaymentsDisputeFileUpload/123",
      },
    ];
    const out = composeShopifyMutationPayload({ ...baseInput(), attachmentPlan: plan });
    expect(out.uncategorizedText).toContain(PACK_PDF.url);
  });

  it("link-only plan entry (kind: 'link') leaves the manual link in place", () => {
    const plan: ResolvedAttachmentPlanEntry[] = [
      {
        evidenceItemId: "ev-delivery-1",
        evidenceFieldKey: "delivery_proof",
        resolvedSlot: { kind: "link", fallbackReason: "no_slot_available" },
        fileGid: null,
      },
    ];
    const out = composeShopifyMutationPayload({ ...baseInput(), attachmentPlan: plan });
    expect(out.shippingDocumentationFile).toBeUndefined();
    expect(out.uncategorizedText).toContain(MANUAL_DELIVERY.url);
  });

  it("native entry with null fileGid (upload failed) → does NOT set *File and does NOT suppress link", () => {
    // Failure path: saveToShopifyJob attempted upload, failed, fell
    // back to text-only for this entry. The plan entry stays as
    // `kind: native` for telemetry but `fileGid` is null. Compose must
    // treat this as "no native attachment" — link must remain.
    const plan: ResolvedAttachmentPlanEntry[] = [
      {
        evidenceItemId: "ev-delivery-1",
        evidenceFieldKey: "delivery_proof",
        resolvedSlot: { kind: "native", targetField: "shippingDocumentationFile", origin: "primary" },
        fileGid: null,
      },
    ];
    const out = composeShopifyMutationPayload({ ...baseInput(), attachmentPlan: plan });
    expect(out.shippingDocumentationFile).toBeUndefined();
    expect(out.uncategorizedText).toContain(MANUAL_DELIVERY.url);
  });

  it("two native entries → both *File fields set; both original links remain in prose", () => {
    const plan: ResolvedAttachmentPlanEntry[] = [
      {
        evidenceItemId: "ev-delivery-1",
        evidenceFieldKey: "delivery_proof",
        resolvedSlot: { kind: "native", targetField: "shippingDocumentationFile", origin: "primary" },
        fileGid: "gid://shopify/ShopifyPaymentsDisputeFileUpload/100",
      },
      {
        evidenceItemId: "ev-comm-1",
        evidenceFieldKey: "customer_communication",
        resolvedSlot: { kind: "native", targetField: "customerCommunicationFile", origin: "primary" },
        fileGid: "gid://shopify/ShopifyPaymentsDisputeFileUpload/200",
      },
    ];
    const out = composeShopifyMutationPayload({ ...baseInput(), attachmentPlan: plan });
    expect(out.shippingDocumentationFile).toEqual({ id: "gid://shopify/ShopifyPaymentsDisputeFileUpload/100" });
    expect(out.customerCommunicationFile).toEqual({ id: "gid://shopify/ShopifyPaymentsDisputeFileUpload/200" });
    // Synthesised PDFs in native rows + originals as links — issuer
    // sees both. Pack PDF unaffected.
    expect(out.uncategorizedText).toContain(MANUAL_DELIVERY.url);
    expect(out.uncategorizedText).toContain(MANUAL_COMM.url);
    expect(out.uncategorizedText).toContain(PACK_PDF.url);
  });

  it("default empty plan = current behavior (no *File set, all links present)", () => {
    const out = composeShopifyMutationPayload(baseInput());
    expect(out.shippingDocumentationFile).toBeUndefined();
    expect(out.customerCommunicationFile).toBeUndefined();
    expect(out.uncategorizedText).toContain(MANUAL_DELIVERY.url);
    expect(out.uncategorizedText).toContain(MANUAL_COMM.url);
    expect(out.uncategorizedText).toContain(PACK_PDF.url);
  });
});
