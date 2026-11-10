/**
 * The pre-upload scan finds the content-stream coordinate that made Shopify
 * answer HTTP 422 (see runningHeaderRule.test.ts for the renderer-side fix).
 */
import { describe, it, expect } from "vitest";
import { PDFDocument, rgb } from "pdf-lib";
import { findOutOfRangeOperand, MAX_PDF_OPERAND } from "../scanCoordinates";

async function pdfWithRuleAt(y: number, pages = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText("Defence", { x: 50, y: 700 });
    // The header-rule bug: a rectangle whose height/Y grew ~100x per page.
    page.drawRectangle({
      x: 45,
      y: i === pages - 1 ? y : 45,
      width: 505,
      height: 0.75,
      color: rgb(0.9, 0.9, 0.9),
    });
  }
  return doc.save({ useObjectStreams: false });
}

describe("findOutOfRangeOperand", () => {
  it("returns null for an ordinary PDF", async () => {
    expect(await findOutOfRangeOperand(await pdfWithRuleAt(45, 3))).toBeNull();
  });

  it("flags a coordinate beyond the signed 32-bit range, with its page", async () => {
    const found = await findOutOfRangeOperand(await pdfWithRuleAt(1.45e10, 4));
    expect(found).not.toBeNull();
    expect(found!.page).toBe(4);
    expect(Math.abs(found!.value)).toBeGreaterThan(MAX_PDF_OPERAND);
  });

  it("flags a large negative coordinate too", async () => {
    const found = await findOutOfRangeOperand(await pdfWithRuleAt(-3e9));
    expect(found).not.toBeNull();
  });

  it("does not mistake text or hex strings for coordinates", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    page.drawText("Case 99999999999999 reference 12345678901234567890", { x: 10, y: 10 });
    expect(await findOutOfRangeOperand(await doc.save())).toBeNull();
  });

  it("throws on bytes that are not a PDF (the caller decides what that means)", async () => {
    await expect(findOutOfRangeOperand(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
});
