import { describe, expect, it } from "vitest";
import {
  MANUAL_ATTACHMENTS_HEADER,
  formatManualAttachmentsBlock,
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

  it("groups multiple uploads under one shared label as a single section", () => {
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

    const deliveryHeaders = block!.match(/^Delivery confirmation:$/gm) ?? [];
    expect(deliveryHeaders).toHaveLength(1);

    expect(block).toContain(
      [
        "Fulfillment & Delivery:",
        "",
        "Delivery confirmation:",
        "- delivery.jpg",
        "  https://disputedesk.app/e/d1",
        "- delivery-2.jpg",
        "  https://disputedesk.app/e/d2",
      ].join("\n"),
    );

    const deliveryIdx = block!.indexOf("Fulfillment & Delivery:");
    const commsIdx = block!.indexOf("Customer Communication:");
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
    expect(block).toContain("- delivery.jpg");
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
    expect(block).toContain("- delivery.jpg");
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
    const fileLines = block!.match(/^- delivery\.jpg$/gm) ?? [];
    expect(fileLines).toHaveLength(1);
  });

  it("prefers stable `id` over the filename+size+date fallback for dedupe", () => {
    const block = formatManualAttachmentsBlock(
      [
        {
          id: "stable-abc",
          label: "A",
          fileName: "a.pdf",
          fileSize: 1,
          createdAt: "2026-04-24T00:00:00Z",
          url: "https://disputedesk.app/e/first",
        },
        {
          id: "stable-abc",
          label: "A",
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
    expect(block).toContain("Supporting documents:");
    expect(block).not.toMatch(/^invoice\.pdf:$/m);
    expect(block).toContain("- invoice.pdf");
  });

  it("collapses to `Supporting documents` when the label equals the filename with an emoji prefix", () => {
    // Emoji stripping is no longer visible in the rendered text, but it
    // still affects the label/filename collapse: if the merchant typed
    // "CONTRATO.pdf" as the label and uploaded "📄 CONTRATO.pdf", we must
    // treat those as equal so we don't emit a filename-style heading.
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
    expect(block).not.toMatch(/^CONTRATO\.pdf:$/m);
    expect(block).toContain("- CONTRATO.pdf");
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
          label: "A",
          fileName: "a.pdf",
          fileSize: null,
          createdAt: "2026-04-20T00:00:00Z",
          url: "https://disputedesk.app/e/a",
        },
        {
          label: "B",
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
    const aIdx = block!.indexOf("A:");
    const bIdx = block!.indexOf("B:");
    const pdfIdx = block!.indexOf("Full evidence pack (PDF):");
    expect(aIdx).toBeGreaterThan(-1);
    expect(bIdx).toBeGreaterThan(aIdx);
    expect(pdfIdx).toBeGreaterThan(bIdx);
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
      "",
      "Delivery confirmation:",
      "- delivery.jpg",
      "  https://disputedesk.app/e/d1",
      "- delivery-2.jpg",
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
});
