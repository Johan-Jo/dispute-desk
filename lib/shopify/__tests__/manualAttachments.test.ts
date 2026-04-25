import { describe, expect, it } from "vitest";
import {
  MANUAL_ATTACHMENTS_HEADER,
  formatManualAttachmentsBlock,
  selectPrimaryCategory,
} from "../manualAttachments";

describe("formatManualAttachmentsBlock", () => {
  it("returns null when there is nothing to emit", () => {
    expect(formatManualAttachmentsBlock([], null)).toBeNull();
  });

  it("uses the exact pinned top-level header text", () => {
    expect(MANUAL_ATTACHMENTS_HEADER).toBe(
      "Supporting documents (secure access links):",
    );
    const block = formatManualAttachmentsBlock(
      [
        {
          label: "any",
          fileName: "a.pdf",
          fileSize: null,
          createdAt: null,
          url: "https://disputedesk.app/e/t1",
        },
      ],
      null,
    );
    expect(block?.split("\n")[0]).toBe(
      "Supporting documents (secure access links):",
    );
  });

  it("uses checklistField for section headings when filenames carry no category cues (matches Evidence tab row)", () => {
    const block = formatManualAttachmentsBlock(
      [
        {
          checklistField: "delivery_proof",
          label: "new dash.png",
          fileName: "new dash.png",
          fileSize: null,
          createdAt: null,
          url: "https://disputedesk.app/e/a1",
        },
        {
          checklistField: "customer_communication",
          label: "faceJohan.jpeg",
          fileName: "faceJohan.jpeg",
          fileSize: null,
          createdAt: null,
          url: "https://disputedesk.app/e/a2",
        },
        {
          checklistField: "supporting_documents",
          label: "CONTRATO DE INTERMEDIAÇÃO IMOBILIÁRIA.pdf",
          fileName: "CONTRATO DE INTERMEDIAÇÃO IMOBILIÁRIA.pdf",
          fileSize: null,
          createdAt: null,
          url: "https://disputedesk.app/e/a3",
        },
      ],
      null,
    );
    expect(block).not.toBeNull();
    expect(block).toContain("Delivery proof:");
    expect(block).toContain("Customer Communication:");
    expect(block).toContain("Supporting Documents:");
    expect(block).not.toMatch(/^Supporting documents:\s*$/m);
    const deliveryIdx = block!.indexOf("Delivery proof:");
    const commsIdx = block!.indexOf("Customer Communication:");
    const suppIdx = block!.indexOf("Supporting Documents:");
    expect(deliveryIdx).toBeGreaterThan(-1);
    expect(commsIdx).toBeGreaterThan(deliveryIdx);
    expect(suppIdx).toBeGreaterThan(commsIdx);
  });

  it("groups uploads by primary category and prefixes each file with its evidence type", () => {
    const block = formatManualAttachmentsBlock(
      [
        {
          label: "Delivery confirmation",
          fileName: "delivery.jpg",
          fileSize: 100,
          createdAt: "2026-04-24T00:00:00Z",
          url: "https://disputedesk.app/e/d1",
        },
        {
          label: "Delivery confirmation",
          fileName: "delivery-2.jpg",
          fileSize: 101,
          createdAt: "2026-04-24T00:00:00Z",
          url: "https://disputedesk.app/e/d2",
        },
        {
          label: "Customer communication",
          fileName: "email-thread.png",
          fileSize: 200,
          createdAt: "2026-04-24T00:00:00Z",
          url: "https://disputedesk.app/e/c1",
        },
      ],
      null,
    );
    expect(block).not.toBeNull();

    expect(block).toContain(
      [
        "Fulfillment & Delivery:",
        "- Delivery confirmation - delivery.jpg",
        "  https://disputedesk.app/e/d1",
        "- Delivery confirmation - delivery-2.jpg",
        "  https://disputedesk.app/e/d2",
      ].join("\n"),
    );

    // Old per-label sub-header `Delivery confirmation:` must not appear.
    expect(block).not.toMatch(/^Delivery confirmation:$/m);

    // Label that exactly matches its category heading collapses (no prefix).
    expect(block).toContain(
      [
        "Customer Communication:",
        "- email-thread.png",
        "  https://disputedesk.app/e/c1",
      ].join("\n"),
    );

    const deliveryIdx = block!.indexOf("Fulfillment & Delivery:");
    const commsIdx = block!.indexOf("Customer Communication:");
    expect(deliveryIdx).toBeGreaterThan(-1);
    expect(commsIdx).toBeGreaterThan(deliveryIdx);
  });

  it("renders the sanitized filename and omits the upload date", () => {
    const block = formatManualAttachmentsBlock(
      [
        {
          label: "Delivery confirmation",
          fileName: "delivery.jpg",
          fileSize: null,
          createdAt: "2026-04-24T00:00:00Z",
          url: "https://disputedesk.app/e/d1",
        },
        {
          label: "Customer communication",
          fileName: "email-thread.png",
          fileSize: null,
          createdAt: "2026-04-24T00:00:00Z",
          url: "https://disputedesk.app/e/c1",
        },
      ],
      null,
    );
    expect(block).not.toBeNull();
    expect(block).toContain("- Delivery confirmation - delivery.jpg");
    expect(block).toContain("- email-thread.png");
    expect(block).not.toContain("uploaded 2026-04-24");
    expect(block).toContain("  https://disputedesk.app/e/d1");
  });

  it("omits file size from rendered output", () => {
    const block = formatManualAttachmentsBlock(
      [
        {
          label: "Delivery confirmation",
          fileName: "delivery.jpg",
          fileSize: 2_457_600,
          createdAt: "2026-04-24T12:34:56.000Z",
          url: "https://disputedesk.app/e/token-1",
        },
      ],
      null,
    );
    expect(block).not.toBeNull();
    expect(block).not.toMatch(/\bMB\b/);
    expect(block).not.toMatch(/\bKB\b/);
    expect(block).toContain("- Delivery confirmation - delivery.jpg");
    expect(block).not.toContain("uploaded 2026-04-24");
    expect(block).toContain("  https://disputedesk.app/e/token-1");
  });

  it("deduplicates uploads by filename + size + upload date when no id is supplied", () => {
    const block = formatManualAttachmentsBlock(
      [
        {
          label: "Delivery confirmation",
          fileName: "delivery.jpg",
          fileSize: 1_000,
          createdAt: "2026-04-24T00:00:00Z",
          url: "https://disputedesk.app/e/first",
        },
        {
          label: "Delivery confirmation",
          fileName: "delivery.jpg",
          fileSize: 1_000,
          createdAt: "2026-04-24T12:34:56Z",
          url: "https://disputedesk.app/e/dupe",
        },
      ],
      null,
    );
    expect(block).not.toBeNull();
    expect(block).toContain("https://disputedesk.app/e/first");
    expect(block).not.toContain("https://disputedesk.app/e/dupe");
    const fileLines =
      block!.match(/^- Delivery confirmation - delivery\.jpg$/gm) ?? [];
    expect(fileLines).toHaveLength(1);
  });

  it("prefers stable `id` over the filename+size+date fallback for dedupe", () => {
    const block = formatManualAttachmentsBlock(
      [
        {
          id: "stable-abc",
          label: "Order receipt",
          fileName: "a.pdf",
          fileSize: 1,
          createdAt: "2026-04-24T00:00:00Z",
          url: "https://disputedesk.app/e/first",
        },
        {
          id: "stable-abc",
          label: "Order receipt",
          fileName: "totally-different-name.pdf",
          fileSize: 9_999,
          createdAt: "2026-05-01T00:00:00Z",
          url: "https://disputedesk.app/e/dupe",
        },
      ],
      null,
    );
    expect(block).not.toBeNull();
    expect(block).toContain("https://disputedesk.app/e/first");
    expect(block).not.toContain("https://disputedesk.app/e/dupe");
  });

  it("collapses to `Supporting documents` when label equals the filename", () => {
    const block = formatManualAttachmentsBlock(
      [
        {
          label: "invoice.pdf",
          fileName: "invoice.pdf",
          fileSize: null,
          createdAt: "2026-04-24T00:00:00Z",
          url: "https://disputedesk.app/e/inv",
        },
      ],
      null,
    );
    expect(block).not.toBeNull();
    // "invoice" matches the Order Facts category, so the group heading
    // is the category itself; the prefix is suppressed because the label
    // equals the filename.
    expect(block).toContain("Order Facts:");
    expect(block).toContain("- invoice.pdf");
    expect(block).not.toMatch(/^- invoice\.pdf - invoice\.pdf$/m);
  });

  it("collapses to `Supporting documents` when the label equals the filename with an emoji prefix", () => {
    // Emoji stripping is not visible in the rendered text, but it still
    // affects the label/filename collapse: if the merchant typed
    // "CONTRATO.pdf" as the label and uploaded "📄 CONTRATO.pdf", we must
    // treat those as equal so we don't emit a redundant inline prefix.
    const block = formatManualAttachmentsBlock(
      [
        {
          label: "CONTRATO.pdf",
          fileName: "\uD83D\uDCC4 CONTRATO.pdf",
          fileSize: null,
          createdAt: "2026-04-24T00:00:00Z",
          url: "https://disputedesk.app/e/c",
        },
      ],
      null,
    );
    expect(block).not.toBeNull();
    expect(block).toContain("Supporting documents:");
    expect(block).toContain("- CONTRATO.pdf");
    expect(block).not.toMatch(/^- CONTRATO\.pdf - CONTRATO\.pdf$/m);
    expect(block).not.toContain("\uD83D\uDCC4");
  });

  it("uses `Supporting documents` as the section header when label is missing", () => {
    const block = formatManualAttachmentsBlock(
      [
        {
          label: null,
          fileName: "screenshot.png",
          fileSize: null,
          createdAt: "2026-04-24T00:00:00Z",
          url: "https://disputedesk.app/e/s",
        },
      ],
      null,
    );
    expect(block).toContain("Supporting documents:");
    expect(block).toContain("- screenshot.png");
    expect(block).not.toContain("uploaded 2026-04-24");
  });

  it("falls back to `- document` when the filename is missing", () => {
    const block = formatManualAttachmentsBlock(
      [
        {
          label: null,
          fileName: null,
          fileSize: null,
          createdAt: null,
          url: "https://disputedesk.app/e/bare",
        },
      ],
      null,
    );
    expect(block).toContain("Supporting documents:");
    expect(block).toContain("- document");
    expect(block).not.toContain("uploaded ");
    expect(block).not.toContain("MB");
    expect(block).toContain("https://disputedesk.app/e/bare");
  });

  it("renders the pack PDF last, in its own section, with the pinned inner labels", () => {
    const block = formatManualAttachmentsBlock(
      [
        {
          label: "Receipt",
          fileName: "a.pdf",
          fileSize: null,
          createdAt: "2026-04-20T00:00:00Z",
          url: "https://disputedesk.app/e/a",
        },
        {
          label: "Email thread",
          fileName: "b.png",
          fileSize: null,
          createdAt: "2026-04-21T00:00:00Z",
          url: "https://disputedesk.app/e/b",
        },
      ],
      { url: "https://disputedesk.app/e/pdf" },
    );
    expect(block).not.toBeNull();
    expect(block).toContain(
      [
        "Full evidence pack (PDF):",
        "- Evidence pack",
        "  https://disputedesk.app/e/pdf",
      ].join("\n"),
    );
    const orderIdx = block!.indexOf("Order Facts:");
    const commsIdx = block!.indexOf("Customer Communication:");
    const pdfIdx = block!.indexOf("Full evidence pack (PDF):");
    expect(orderIdx).toBeGreaterThan(-1);
    expect(commsIdx).toBeGreaterThan(-1);
    expect(pdfIdx).toBeGreaterThan(orderIdx);
    expect(pdfIdx).toBeGreaterThan(commsIdx);
  });

  it("renders the PDF section even when there are no uploads", () => {
    const block = formatManualAttachmentsBlock(
      [],
      { url: "https://disputedesk.app/e/pdf-only" },
    );
    expect(block).not.toBeNull();
    expect(block).toContain("Supporting documents (secure access links):");
    expect(block).toContain("Full evidence pack (PDF):");
    expect(block).toContain("- Evidence pack");
    expect(block).toContain("  https://disputedesk.app/e/pdf-only");
  });

  it("produces the exact expected layout for the canonical uploads + PDF case", () => {
    const block = formatManualAttachmentsBlock(
      [
        {
          label: "Delivery confirmation",
          fileName: "delivery.jpg",
          fileSize: null,
          createdAt: "2026-04-24T00:00:00Z",
          url: "https://disputedesk.app/e/d1",
        },
        {
          label: "Delivery confirmation",
          fileName: "delivery-2.jpg",
          fileSize: null,
          createdAt: "2026-04-24T00:00:00Z",
          url: "https://disputedesk.app/e/d2",
        },
        {
          label: "Customer communication",
          fileName: "email-thread.png",
          fileSize: null,
          createdAt: "2026-04-24T00:00:00Z",
          url: "https://disputedesk.app/e/c1",
        },
      ],
      { url: "https://disputedesk.app/e/pdf" },
    );
    const expected = [
      "Supporting documents (secure access links):",
      "",
      "Fulfillment & Delivery:",
      "- Delivery confirmation - delivery.jpg",
      "  https://disputedesk.app/e/d1",
      "- Delivery confirmation - delivery-2.jpg",
      "  https://disputedesk.app/e/d2",
      "",
      "Customer Communication:",
      "- email-thread.png",
      "  https://disputedesk.app/e/c1",
      "",
      "Full evidence pack (PDF):",
      "- Evidence pack",
      "  https://disputedesk.app/e/pdf",
    ].join("\n");
    expect(block).toBe(expected);
  });

  describe("reason-aware primary category for multi-purpose evidence", () => {
    const dualPurposeUpload = {
      label: "Delivery confirmation email",
      fileName: "delivery-email.pdf",
      fileSize: null,
      createdAt: "2026-04-24T00:00:00Z",
      url: "https://disputedesk.app/e/dual",
    };

    it("places dual-purpose evidence under Fulfillment for a FRAUDULENT dispute", () => {
      const block = formatManualAttachmentsBlock(
        [dualPurposeUpload],
        null,
        "FRAUDULENT",
      );
      expect(block).toContain("Fulfillment & Delivery:");
      expect(block).toContain(
        "- Delivery confirmation email - delivery-email.pdf",
      );
      expect(block).not.toContain("Customer Communication:");
    });

    it("places dual-purpose evidence under Communication for a SUBSCRIPTION_CANCELED dispute", () => {
      const block = formatManualAttachmentsBlock(
        [dualPurposeUpload],
        null,
        "SUBSCRIPTION_CANCELED",
      );
      expect(block).toContain("Customer Communication:");
      expect(block).toContain(
        "- Delivery confirmation email - delivery-email.pdf",
      );
      expect(block).not.toContain("Fulfillment & Delivery:");
    });

    it("places dual-purpose evidence under Communication for a PRODUCT_UNACCEPTABLE dispute", () => {
      const block = formatManualAttachmentsBlock(
        [dualPurposeUpload],
        null,
        "PRODUCT_UNACCEPTABLE",
      );
      expect(block).toContain("Customer Communication:");
      expect(block).not.toContain("Fulfillment & Delivery:");
    });

    it("falls back to default priority order when the reason is unknown or null", () => {
      const block = formatManualAttachmentsBlock(
        [dualPurposeUpload],
        null,
        null,
      );
      // Default order: Fulfillment beats Communication.
      expect(block).toContain("Fulfillment & Delivery:");
      expect(block).not.toContain("Customer Communication:");
    });

    it("never duplicates a multi-purpose upload across categories", () => {
      const block = formatManualAttachmentsBlock(
        [dualPurposeUpload],
        null,
        "FRAUDULENT",
      );
      expect(block).not.toBeNull();
      const links =
        block!.match(/https:\/\/disputedesk\.app\/e\/dual/g) ?? [];
      expect(links).toHaveLength(1);
    });
  });

  describe("inline evidence-type prefix", () => {
    it("renders the prefix for typical merchant labels", () => {
      const block = formatManualAttachmentsBlock(
        [
          {
            label: "Tracking screenshot",
            fileName: "ups.png",
            fileSize: null,
            createdAt: null,
            url: "https://disputedesk.app/e/u",
          },
        ],
        null,
      );
      expect(block).toContain("Fulfillment & Delivery:");
      expect(block).toContain("- Tracking screenshot - ups.png");
    });

    it("suppresses the prefix when the label equals the resolved category heading", () => {
      // Label "Customer Communication" equals the category heading
      // (case-insensitive), so the prefix would be redundant.
      const block = formatManualAttachmentsBlock(
        [
          {
            label: "Customer Communication",
            fileName: "thread.png",
            fileSize: null,
            createdAt: null,
            url: "https://disputedesk.app/e/x",
          },
        ],
        null,
      );
      expect(block).toContain("Customer Communication:");
      expect(block).toContain("- thread.png");
      expect(block).not.toMatch(
        /^- Customer Communication - thread\.png$/m,
      );
    });

    it("strips emoji from the rendered prefix", () => {
      const block = formatManualAttachmentsBlock(
        [
          {
            label: "\uD83D\uDCE6 Shipping label",
            fileName: "label.png",
            fileSize: null,
            createdAt: null,
            url: "https://disputedesk.app/e/y",
          },
        ],
        null,
      );
      expect(block).toContain("- Shipping label - label.png");
      expect(block).not.toContain("\uD83D\uDCE6");
    });
  });
});

describe("selectPrimaryCategory", () => {
  it("returns null when the label matches no category", () => {
    expect(selectPrimaryCategory("Random gibberish", null)).toBeNull();
    expect(selectPrimaryCategory(null, null)).toBeNull();
    expect(selectPrimaryCategory("", "FRAUDULENT")).toBeNull();
  });

  it("returns the single matching category when the label is unambiguous", () => {
    expect(selectPrimaryCategory("Tracking number", null)).toBe(
      "Fulfillment & Delivery",
    );
    expect(selectPrimaryCategory("Email thread", null)).toBe(
      "Customer Communication",
    );
  });

  it("breaks multi-category ties using the dispute reason family", () => {
    const dual = "Delivery confirmation email";
    expect(selectPrimaryCategory(dual, "FRAUDULENT")).toBe(
      "Fulfillment & Delivery",
    );
    expect(selectPrimaryCategory(dual, "PRODUCT_NOT_RECEIVED")).toBe(
      "Fulfillment & Delivery",
    );
    expect(selectPrimaryCategory(dual, "SUBSCRIPTION_CANCELED")).toBe(
      "Customer Communication",
    );
    expect(selectPrimaryCategory(dual, "PRODUCT_UNACCEPTABLE")).toBe(
      "Customer Communication",
    );
    expect(selectPrimaryCategory(dual, "CREDIT_NOT_PROCESSED")).toBe(
      "Customer Communication",
    );
  });
});
