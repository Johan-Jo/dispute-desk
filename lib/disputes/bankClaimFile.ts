/**
 * Reading the bank's claim out of an uploaded file.
 *
 * Merchants usually download the issuer claim from Shopify as a PDF; the
 * card also accepts TXT, DOC, DOCX, RTF, EML and images (Claude Design
 * "Bank Claim Card.dc.html"). The letter writer needs the claim as TEXT, so:
 *
 *   - TXT / EML / RTF  → read directly               (text_source 'file_text')
 *   - PDF / PNG / JPEG → transcribed by Claude, which
 *                        reads PDFs and images natively (text_source 'file_ai')
 *   - DOC / DOCX       → stored, not read: no parser in the stack. The
 *                        answer still counts, the letter gets no claim text.
 *
 * Extraction never blocks the upload: a file we cannot read is still the
 * merchant's answer and is kept.
 */

import { callClaudeMessages } from "@/lib/defence/anthropicClient";
import { BANK_CLAIM_MAX_TEXT } from "./bankClaim";

export const BANK_CLAIM_FILE_MAX_BYTES = 10 * 1024 * 1024;

export const BANK_CLAIM_FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  eml: "message/rfc822",
  rtf: "application/rtf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

export function bankClaimFileExt(name: string): string | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ext in BANK_CLAIM_FILE_TYPES ? ext : null;
}

const TRANSCRIBE_MODEL = "claude-haiku-4-5-20251001";

function clamp(text: string): string | null {
  const t = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t ? t.slice(0, BANK_CLAIM_MAX_TEXT) : null;
}

/** Crude RTF → text: drop control words and groups, keep the words. */
export function rtfToText(rtf: string): string {
  return rtf
    .replace(/\\par[d]?/g, "\n")
    .replace(/\{\\\*[^{}]*\}/g, "")
    .replace(/\\'[0-9a-f]{2}/gi, "")
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "");
}

/** EML → the readable body: drop headers, keep text. */
export function emlToText(eml: string): string {
  const split = eml.search(/\r?\n\r?\n/);
  const body = split >= 0 ? eml.slice(split) : eml;
  return body.replace(/<[^>]+>/g, " ");
}

export interface ExtractedClaimText {
  text: string | null;
  source: "file_text" | "file_ai" | null;
  error?: string;
}

export async function extractBankClaimText(
  buffer: Buffer,
  ext: string,
): Promise<ExtractedClaimText> {
  if (ext === "txt") return { text: clamp(buffer.toString("utf8")), source: "file_text" };
  if (ext === "eml") return { text: clamp(emlToText(buffer.toString("utf8"))), source: "file_text" };
  if (ext === "rtf") return { text: clamp(rtfToText(buffer.toString("utf8"))), source: "file_text" };

  const media =
    ext === "pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") } }
      : ext === "png" || ext === "jpg" || ext === "jpeg"
        ? { type: "image", source: { type: "base64", media_type: BANK_CLAIM_FILE_TYPES[ext], data: buffer.toString("base64") } }
        : null;
  if (!media) return { text: null, source: null };

  const res = await callClaudeMessages({
    model: TRANSCRIBE_MODEL,
    system: [
      {
        type: "text",
        text:
          "You transcribe documents. The attached file is a card-issuing bank's claim about a payment dispute, " +
          "downloaded by a merchant from Shopify. Return ONLY the text it contains, in reading order, without " +
          "commentary, summaries or added words. If it contains no readable text, return an empty response.",
      },
    ],
    messages: [
      {
        role: "user",
        content: [media, { type: "text", text: "Transcribe this document." }],
      },
    ],
    maxTokens: 4096,
    temperature: 0,
  });
  if (res.error || !res.raw) return { text: null, source: null, error: res.error ?? "empty" };
  return { text: clamp(res.raw), source: "file_ai" };
}
