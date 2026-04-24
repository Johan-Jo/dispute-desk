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
 *
 * Output shape (pinned by tests):
 *
 *   Supporting documents (secure access links):
 *
 *   <Label>:
 *   - <filename>
 *     https://disputedesk.app/e/<token>
 *   - <filename>
 *     https://disputedesk.app/e/<token>
 *
 *   <Other Label>:
 *   - <filename>
 *     https://disputedesk.app/e/<token>
 *
 *   Full evidence pack (PDF):
 *   - Evidence pack
 *     https://disputedesk.app/e/<token>
 *
 * Dates and file sizes are intentionally NOT rendered in the bank-facing
 * text. The merchant-entered label (section header) describes what the
 * evidence is, the filename identifies the linked document, and the URL
 * delivers the file itself.
 */

export interface ManualAttachmentInput {
  /** Human-readable label entered by the merchant at upload time. */
  label: string | null;
  /** Original filename as uploaded. */
  fileName: string | null;
  /**
   * File size in bytes. Retained on the input as one of the fallback
   * deduplication components; not rendered in the bank-facing output.
   */
  fileSize: number | null;
  /**
   * ISO timestamp of the upload. Used both to render `uploaded YYYY-MM-DD`
   * and as a fallback deduplication component.
   */
  createdAt: string | null;
  /** Full DisputeDesk URL the bank follows to fetch this file. */
  url: string;
  /**
   * Optional stable identifier (e.g. the Supabase storage path or the
   * `evidence_items.id`). Preferred deduplication key when supplied;
   * callers that omit it fall back to filename + size + date.
   */
  id?: string | null;
}

export interface PackPdfInput {
  /** Full DisputeDesk URL for the rendered pack PDF. */
  url: string;
}

/** Exact top-level header text — pinned by tests. */
export const MANUAL_ATTACHMENTS_HEADER =
  "Supporting documents (secure access links):";

/**
 * Section header used when the merchant didn't supply a label or when
 * the label is indistinguishable from the filename (rule: don't use a
 * filename as a heading).
 */
const DEFAULT_SECTION_LABEL = "Supporting documents";

/** Dedicated section for the rendered evidence pack PDF, always last. */
const PDF_SECTION_LABEL = "Full evidence pack (PDF)";
const PDF_FILE_LABEL = "Evidence pack";

/**
 * Strip emoji/pictographic characters from filenames before rendering.
 * Kept intentionally conservative: matches the Unicode
 * `Extended_Pictographic` property plus the VS16 selector and ZWJ, which
 * together cover modern emoji sequences without touching regular
 * punctuation, digits, or accented Latin/non-Latin letters.
 *
 * Example: "📄 CONTRATO.pdf" -> "CONTRATO.pdf"
 */
const EMOJI_RE = /[\p{Extended_Pictographic}\uFE0F\u200D]/gu;

function sanitizeFilename(raw: string | null | undefined): string {
  if (!raw) return "document";
  const cleaned = raw.replace(EMOJI_RE, "").trim();
  return cleaned.length > 0 ? cleaned : "document";
}

function resolveSectionLabel(
  rawLabel: string | null | undefined,
  sanitizedFileName: string,
): string {
  const trimmed = rawLabel?.trim();
  if (!trimmed) return DEFAULT_SECTION_LABEL;
  if (trimmed === sanitizedFileName) return DEFAULT_SECTION_LABEL;
  return trimmed;
}

function dedupeKeyFor(u: ManualAttachmentInput): string {
  if (u.id && u.id.trim().length > 0) return `id:${u.id.trim()}`;
  const name = sanitizeFilename(u.fileName);
  const size = typeof u.fileSize === "number" ? u.fileSize : "";
  const date = u.createdAt ? u.createdAt.slice(0, 10) : "";
  return `fb:${name}|${size}|${date}`;
}

/**
 * Build the attachments block. Returns `null` when there is nothing to
 * cite (empty uploads and no PDF), so callers can cleanly skip the
 * append step.
 */
export function formatManualAttachmentsBlock(
  uploads: ManualAttachmentInput[],
  pdf: PackPdfInput | null,
): string | null {
  const seen = new Set<string>();
  const unique: ManualAttachmentInput[] = [];
  for (const u of uploads) {
    const key = dedupeKeyFor(u);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(u);
  }

  const groups: Array<{ label: string; items: ManualAttachmentInput[] }> = [];
  const groupIndex = new Map<string, number>();
  for (const u of unique) {
    const fileName = sanitizeFilename(u.fileName);
    const sectionLabel = resolveSectionLabel(u.label, fileName);
    let idx = groupIndex.get(sectionLabel);
    if (idx === undefined) {
      idx = groups.length;
      groupIndex.set(sectionLabel, idx);
      groups.push({ label: sectionLabel, items: [] });
    }
    groups[idx].items.push(u);
  }

  const sections: string[] = [];
  for (const g of groups) {
    const lines: string[] = [`${g.label}:`];
    for (const u of g.items) {
      lines.push(`- ${sanitizeFilename(u.fileName)}`);
      lines.push(`  ${u.url}`);
    }
    sections.push(lines.join("\n"));
  }

  if (pdf) {
    sections.push(
      [
        `${PDF_SECTION_LABEL}:`,
        `- ${PDF_FILE_LABEL}`,
        `  ${pdf.url}`,
      ].join("\n"),
    );
  }

  if (sections.length === 0) return null;

  return `${MANUAL_ATTACHMENTS_HEADER}\n\n${sections.join("\n\n")}`;
}
