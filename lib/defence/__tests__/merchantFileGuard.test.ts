/**
 * Bank-claim plan F4: the merchant's own file in Shopify's uncategorized
 * slot is never replaced without their approval; the annex is prepared but
 * only runs when switched on AND approved.
 */
import { describe, it, expect, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { guardMerchantFileSlot, type MerchantFileGuardDeps } from "../merchantFileGuard";
import { appendMerchantFile } from "../merchantFileAnnex";
import { isDisputeDeskFile } from "@/lib/shopify/merchantEvidenceFile";

async function pdf(pages: number): Promise<Buffer> {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage();
  return Buffer.from(await d.save());
}

function deps(over: Partial<MerchantFileGuardDeps> = {}): MerchantFileGuardDeps {
  return {
    readSlot: async () => ({ ok: true, file: null }),
    annexEnabled: () => false,
    hasApproval: async () => false,
    fetchFile: vi.fn(async () => new Uint8Array()),
    append: vi.fn(appendMerchantFile),
    audit: vi.fn(async () => {}),
    maxBytes: 2_000_000,
    ...over,
  };
}

const MERCHANT = { originalFileName: "AdditionalEvidence.pdf", fileType: "application/pdf", url: "https://cdn.example/f.pdf" };

describe("isDisputeDeskFile", () => {
  it("recognises only our Defence-<id>- filenames", () => {
    expect(isDisputeDeskFile("Defence-12345-MeinMaison-2026-09-28.pdf")).toBe(true);
    expect(isDisputeDeskFile("AdditionalEvidence.pdf")).toBe(false);
    expect(isDisputeDeskFile(null)).toBe(false);
  });
});

describe("guardMerchantFileSlot", () => {
  it("proceeds when the slot is empty or holds our own earlier PDF", async () => {
    const ours = await pdf(1);
    expect((await guardMerchantFileSlot(ours, deps())).action).toBe("proceed");
    const d = deps({ readSlot: async () => ({ ok: true, file: { originalFileName: "Defence-1-X-2026-09-01.pdf", fileType: "application/pdf", url: null } }) });
    expect((await guardMerchantFileSlot(ours, d)).action).toBe("proceed");
  });

  it("refuses when the merchant's own file is there and nothing is approved", async () => {
    const d = deps({ readSlot: async () => ({ ok: true, file: MERCHANT }) });
    const r = await guardMerchantFileSlot(await pdf(1), d);
    expect(r).toMatchObject({ action: "refuse", retriable: false });
    expect(d.fetchFile).not.toHaveBeenCalled();
    expect(d.audit).toHaveBeenCalledWith("save_to_shopify_refused_merchant_file_present", expect.objectContaining({ approved: false }));
  });

  it("still refuses when approved but the annex is switched off (prepared, not executed)", async () => {
    const d = deps({ readSlot: async () => ({ ok: true, file: MERCHANT }), hasApproval: async () => true });
    expect((await guardMerchantFileSlot(await pdf(1), d)).action).toBe("refuse");
    expect(d.fetchFile).not.toHaveBeenCalled();
  });

  it("fails closed when the slot cannot be read", async () => {
    const r = await guardMerchantFileSlot(await pdf(1), deps({ readSlot: async () => ({ ok: false, error: "timeout" }) }));
    expect(r).toMatchObject({ action: "refuse", retriable: true });
  });

  it("switched on and approved: our PDF followed by the merchant's pages", async () => {
    const theirs = await pdf(2);
    const d = deps({
      readSlot: async () => ({ ok: true, file: MERCHANT }),
      annexEnabled: () => true,
      hasApproval: async () => true,
      fetchFile: vi.fn(async () => new Uint8Array(theirs)),
    });
    const r = await guardMerchantFileSlot(await pdf(3), d);
    expect(r.action).toBe("proceed");
    if (r.action === "proceed") expect((await PDFDocument.load(r.pdfBytes)).getPageCount()).toBe(5);
    expect(d.audit).toHaveBeenCalledWith("save_to_shopify_merchant_file_annexed", expect.anything());
  });

  it("switched on and approved, but the annex fails: refuses rather than dropping their file", async () => {
    const d = deps({
      readSlot: async () => ({ ok: true, file: { ...MERCHANT, fileType: "application/msword" } }),
      annexEnabled: () => true,
      hasApproval: async () => true,
    });
    expect((await guardMerchantFileSlot(await pdf(1), d)).action).toBe("refuse");
  });
});
