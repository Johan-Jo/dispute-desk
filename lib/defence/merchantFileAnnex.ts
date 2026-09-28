/**
 * PREPARED, NOT ACTIVE (bank-claim plan F4).
 *
 * When a reopened dispute's uncategorized slot holds the merchant's own file,
 * our save would replace it. The intended answer is to keep their file by
 * appending it to our PDF as an annex — but only once the merchant has
 * approved it for that dispute and cycle, and only while
 * `MERCHANT_FILE_ANNEX_ENABLED=on`. Neither is true today, so the save worker
 * refuses instead (see saveToShopifyJob, step 5b).
 */

import { PDFDocument } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";

export function merchantFileAnnexEnabled(): boolean {
  return process.env.MERCHANT_FILE_ANNEX_ENABLED === "on";
}

/** The merchant's recorded approval to append their file, for THIS cycle. */
export async function hasMerchantFileApproval(
  sb: SupabaseClient,
  disputeId: string,
  cycle: number,
): Promise<boolean> {
  const { data, error } = await sb
    .from("merchant_file_approvals")
    .select("id")
    .eq("dispute_id", disputeId)
    .eq("response_cycle", cycle)
    .eq("decision", "attach")
    .limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}

export type AnnexResult =
  | { ok: true; bytes: Buffer; appendedPages: number }
  | { ok: false; error: string };

/**
 * Our PDF followed by the merchant's file. A PDF is appended page by page; a
 * PNG or JPEG becomes one page scaled to A4. Anything else is refused — we
 * never drop the merchant's file silently.
 */
export async function appendMerchantFile(args: {
  ours: Uint8Array;
  merchant: Uint8Array;
  merchantFileType: string | null;
}): Promise<AnnexResult> {
  try {
    const out = await PDFDocument.load(args.ours);
    const type = (args.merchantFileType ?? "").toLowerCase();
    let appended = 0;
    if (type.includes("pdf")) {
      const theirs = await PDFDocument.load(args.merchant, { ignoreEncryption: true });
      const pages = await out.copyPages(theirs, theirs.getPageIndices());
      for (const p of pages) out.addPage(p);
      appended = pages.length;
    } else if (type.includes("png") || type.includes("jpeg") || type.includes("jpg")) {
      const img = type.includes("png")
        ? await out.embedPng(args.merchant)
        : await out.embedJpg(args.merchant);
      const A4 = { w: 595.28, h: 841.89 };
      const scale = Math.min((A4.w - 72) / img.width, (A4.h - 72) / img.height, 1);
      const page = out.addPage([A4.w, A4.h]);
      page.drawImage(img, {
        x: (A4.w - img.width * scale) / 2,
        y: (A4.h - img.height * scale) / 2,
        width: img.width * scale,
        height: img.height * scale,
      });
      appended = 1;
    } else {
      return { ok: false, error: `unsupported merchant file type: ${type || "unknown"}` };
    }
    return { ok: true, bytes: Buffer.from(await out.save()), appendedPages: appended };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
