/**
 * Pre-upload check for a stored defence PDF: does any page content stream
 * carry a numeric operand outside the signed 32-bit range?
 *
 * Shopify's `dispute_file_uploads.json` validator rejects such a file with
 * HTTP 422 "There's a problem with the uploaded file". PDFs rendered before
 * 2026-11-10 can contain one (the running-header rule drew at a height that
 * grew ~100x per page; fixed in #1109/#1110), and the save job uploads the
 * STORED file, so a fixed renderer does not help a PDF that already exists.
 *
 * Same decoding as `lib/defence/pdf/__tests__/runningHeaderRule.test.ts`.
 *
 * The scan must never read garbage as an operand: a false positive defers a
 * good file. So only the TEXT of the content stream is scanned — inline image
 * data (`BI … ID <binary> EI`), names, hex strings and literal strings are cut
 * out first, a number must be a whole token, and a stream that cannot be
 * decoded (an exotic filter) is skipped rather than guessed at.
 */

import { PDFDocument, PDFArray, PDFRef, decodePDFRawStream } from "pdf-lib";
import type { PDFRawStream } from "pdf-lib";

/** Anything beyond this is treated as out of range. The real limit is the
 *  signed 32-bit range (2,147,483,647); the margin keeps clear of it. */
export const MAX_PDF_OPERAND = 2_000_000_000;

export interface OutOfRangeOperand {
  /** 1-based page number. */
  page: number;
  value: number;
}

/** Numeric operands only. Inline images are removed first: their payload is
 *  arbitrary bytes, and decoding those as latin1 yields digit runs. */
function numericOperands(stream: string): number[] {
  const stripped = stream
    .replace(/\bBI\b[\s\S]*?\bID\b[\s\S]*?\bEI\b/g, " ")
    .replace(/<[0-9a-fA-F\s]*>/g, " ")
    .replace(/\/[^\s/<>[\]()%]+/g, " ")
    .replace(/\((?:\\.|[^\\()])*\)/g, " ");
  // Whole tokens only: not glued to letters/digits/dots on either side.
  const tokens = stripped.match(/(?<![\w.])-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?(?![\w.])/g) ?? [];
  return tokens.map(Number);
}

/**
 * The first out-of-range operand in the document's page content streams, or
 * null when every operand is in range. Throws if the bytes are not a loadable
 * PDF; the caller decides what an unreadable file means.
 */
export async function findOutOfRangeOperand(
  bytes: Uint8Array,
): Promise<OutOfRangeOperand | null> {
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const contents = pages[i].node.Contents();
    const streams: unknown[] = [];
    if (contents instanceof PDFArray) {
      for (let j = 0; j < contents.size(); j++) {
        streams.push(doc.context.lookup(contents.get(j) as PDFRef));
      }
    } else if (contents) {
      streams.push(contents);
    }
    for (const s of streams) {
      let text: string;
      try {
        text = Buffer.from(decodePDFRawStream(s as PDFRawStream).decode()).toString("latin1");
      } catch {
        continue; // undecodable stream: not evidence of anything
      }
      for (const n of numericOperands(text)) {
        if (Number.isFinite(n) && Math.abs(n) > MAX_PDF_OPERAND) {
          return { page: i + 1, value: n };
        }
      }
    }
  }
  return null;
}
