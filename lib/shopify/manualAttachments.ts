/**
 * Pure text-block formatter for the "Supporting documents" section
 * appended to `uncategorizedText` when submitting dispute evidence to
 * Shopify.
 *
 * Shopify's public Admin API does not let third-party apps attach
 * files to chargeback disputes (see `lib/shopify/disputeFileUpload.ts`),
 * so callers (the save-to-shopify job handler) mint DisputeDesk URLs
 * via the HMAC helper in `lib/links/attachmentLinks.ts` and pass them
 * here. This file is I/O free — no env, no DB, no Supabase — so it
 * can be unit-tested in isolation and reused from anywhere.
 */

export interface ManualAttachmentInput {
  /** Human-readable label entered by the merchant at upload time. */
  label: string | null;
  /** Original filename as uploaded. */
  fileName: string | null;
  /** File size in bytes, used to render "(X.X MB)". */
  fileSize: number | null;
  /** ISO timestamp of the upload, used to render "YYYY-MM-DD". */
  createdAt: string | null;
  /** Full DisputeDesk URL the bank follows to fetch this file. */
  url: string;
}

export interface PackPdfInput {
  /** Full DisputeDesk URL for the rendered pack PDF. */
  url: string;
}

/** Exact header text — pinned by tests. */
export const MANUAL_ATTACHMENTS_HEADER =
  "Supporting documents (secure access links):";

/**
 * Build the attachments block. Returns `null` when there is nothing to
 * cite (empty uploads and no PDF), so callers can cleanly skip the
 * append step.
 */
export function formatManualAttachmentsBlock(
  uploads: ManualAttachmentInput[],
  pdf: PackPdfInput | null,
): string | null {
  const lines: string[] = [];

  for (const u of uploads) {
    const label = u.label?.trim() || "Manual upload";
    const name = u.fileName?.trim() || "document";
    const sizeStr =
      typeof u.fileSize === "number" && u.fileSize > 0
        ? ` (${(u.fileSize / 1024 / 1024).toFixed(1)} MB)`
        : "";
    const dateStr = u.createdAt
      ? `, uploaded ${u.createdAt.slice(0, 10)}`
      : "";
    lines.push(`  - ${label}: ${name}${sizeStr}${dateStr}`);
    lines.push(`    ${u.url}`);
  }

  if (pdf) {
    lines.push("  - Full evidence pack (PDF)");
    lines.push(`    ${pdf.url}`);
  }

  if (lines.length === 0) return null;

  return `${MANUAL_ATTACHMENTS_HEADER}\n${lines.join("\n")}`;
}
