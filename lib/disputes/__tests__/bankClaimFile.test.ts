/**
 * Reading the bank's claim from an uploaded file (lib/disputes/bankClaimFile.ts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/defence/anthropicClient", () => ({
  callClaudeMessages: vi.fn(async () => ({
    raw: "Cardholder states the item was not received.",
    promptTokens: 1,
    completionTokens: 1,
    cachedTokens: 0,
    durationMs: 1,
    error: null,
  })),
}));

import { bankClaimFileExt, emlToText, extractBankClaimText, rtfToText } from "@/lib/disputes/bankClaimFile";
import { callClaudeMessages } from "@/lib/defence/anthropicClient";

beforeEach(() => vi.clearAllMocks());

describe("bankClaimFileExt", () => {
  it("accepts the design's formats (and RTF), case-insensitively; rejects others", () => {
    for (const n of ["a.pdf", "b.TXT", "c.doc", "d.docx", "e.rtf", "f.eml", "g.png", "h.JPG", "i.jpeg"]) {
      expect(bankClaimFileExt(n)).not.toBeNull();
    }
    expect(bankClaimFileExt("x.exe")).toBeNull();
    expect(bankClaimFileExt("noext")).toBeNull();
  });
});

describe("extractBankClaimText", () => {
  it("reads TXT directly, without calling the model", async () => {
    const r = await extractBankClaimText(Buffer.from("  Buyer says: not as described.\r\n"), "txt");
    expect(r).toEqual({ text: "Buyer says: not as described.", source: "file_text" });
    expect(callClaudeMessages).not.toHaveBeenCalled();
  });

  it("reads the body of an EML, not its headers", () => {
    const t = emlToText("From: bank@x\nSubject: Claim\n\nThe cardholder disputes the charge.");
    expect(t).toContain("The cardholder disputes the charge.");
    expect(t).not.toContain("From: bank@x");
  });

  it("strips RTF control words", () => {
    expect(rtfToText("{\\rtf1\\ansi {\\b Claim:} item not received\\par}").trim()).toBe("Claim: item not received");
  });

  it("transcribes a PDF through Claude as a native document block", async () => {
    const r = await extractBankClaimText(Buffer.from("%PDF-1.4"), "pdf");
    expect(r).toEqual({ text: "Cardholder states the item was not received.", source: "file_ai" });
    const msg = vi.mocked(callClaudeMessages).mock.calls[0]![0].messages[0]!;
    const blocks = msg.content as Array<Record<string, unknown>>;
    expect(blocks[0]).toMatchObject({ type: "document", source: { media_type: "application/pdf" } });
  });

  it("transcribes an image through Claude as an image block", async () => {
    await extractBankClaimText(Buffer.from([0x89, 0x50]), "png");
    const blocks = vi.mocked(callClaudeMessages).mock.calls[0]![0].messages[0]!.content as Array<Record<string, unknown>>;
    expect(blocks[0]).toMatchObject({ type: "image", source: { media_type: "image/png" } });
  });

  it("stores DOC/DOCX without reading them (no parser in the stack)", async () => {
    expect(await extractBankClaimText(Buffer.from("x"), "docx")).toEqual({ text: null, source: null });
    expect(callClaudeMessages).not.toHaveBeenCalled();
  });

  it("a model error yields no text, never a throw", async () => {
    vi.mocked(callClaudeMessages).mockResolvedValueOnce({
      raw: null,
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      durationMs: 0,
      error: "Claude API error 500",
    });
    const r = await extractBankClaimText(Buffer.from("%PDF"), "pdf");
    expect(r.text).toBeNull();
    expect(r.error).toContain("500");
  });
});
