import { describe, expect, it } from "vitest";
import {
  MANUAL_ATTACHMENTS_HEADER,
  formatManualAttachmentsBlock,
} from "../manualAttachments";

describe("formatManualAttachmentsBlock", () => {
  it("returns null when there is nothing to emit", () => {
    expect(formatManualAttachmentsBlock([], null)).toBeNull();
  });

  it("uses the exact pinned header text", () => {
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

  it("formats a single upload with label, filename, size in MB (1 decimal), upload date (YYYY-MM-DD), and URL", () => {
    const block = formatManualAttachmentsBlock(
      [
        {
          label: "Delivery confirmation",
          fileName: "delivery.jpg",
          fileSize: 2_457_600, // ~2.3 MB
          createdAt: "2026-04-24T12:34:56.000Z",
          url: "https://disputedesk.app/e/token-1",
        },
      ],
      null,
    );
    expect(block).not.toBeNull();
    expect(block).toContain(
      "- Delivery confirmation: delivery.jpg (2.3 MB), uploaded 2026-04-24",
    );
    expect(block).toContain("    https://disputedesk.app/e/token-1");
  });

  it("formats the pack PDF entry with its URL", () => {
    const block = formatManualAttachmentsBlock(
      [],
      { url: "https://disputedesk.app/e/pdf-token" },
    );
    expect(block).not.toBeNull();
    expect(block).toContain("- Full evidence pack (PDF)");
    expect(block).toContain("    https://disputedesk.app/e/pdf-token");
  });

  it("falls back to defaults when label, filename, size, and date are all missing", () => {
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
    expect(block).toContain("- Manual upload: document");
    expect(block).not.toContain("MB");
    expect(block).not.toContain("uploaded ");
    expect(block).toContain("https://disputedesk.app/e/bare");
  });

  it("emits every upload plus the PDF when both are present", () => {
    const block = formatManualAttachmentsBlock(
      [
        {
          label: "A",
          fileName: "a.pdf",
          fileSize: 512_000,
          createdAt: "2026-04-20T00:00:00Z",
          url: "https://disputedesk.app/e/a",
        },
        {
          label: "B",
          fileName: "b.png",
          fileSize: 1_048_576,
          createdAt: "2026-04-21T00:00:00Z",
          url: "https://disputedesk.app/e/b",
        },
      ],
      { url: "https://disputedesk.app/e/pdf" },
    );
    expect(block).toContain("https://disputedesk.app/e/a");
    expect(block).toContain("https://disputedesk.app/e/b");
    expect(block).toContain("https://disputedesk.app/e/pdf");
  });
});
