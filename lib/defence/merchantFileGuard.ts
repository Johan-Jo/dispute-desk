/**
 * Save-worker step 5b (bank-claim plan F4): never replace the merchant's own
 * file in Shopify's uncategorized evidence slot.
 *
 * Our PDF goes into that slot. On a reopened dispute it can hold the
 * merchant's round-one upload (6 of 8 open reopened disputes on 2026-09-28).
 * The save is refused unless the merchant approved appending their file to
 * our PDF for this cycle AND the annex is switched on — neither is the case
 * today, so the attach path is prepared but never runs. Fails closed: a slot
 * that cannot be read is never written over.
 */

import { isDisputeDeskFile, type UncategorizedSlotRead } from "@/lib/shopify/merchantEvidenceFile";
import type { AnnexResult } from "./merchantFileAnnex";

export interface MerchantFileGuardDeps {
  readSlot: () => Promise<UncategorizedSlotRead>;
  annexEnabled: () => boolean;
  hasApproval: () => Promise<boolean>;
  fetchFile: (url: string) => Promise<Uint8Array>;
  append: (args: { ours: Uint8Array; merchant: Uint8Array; merchantFileType: string | null }) => Promise<AnnexResult>;
  audit: (eventType: "save_to_shopify_refused_merchant_file_present" | "save_to_shopify_merchant_file_annexed", payload: Record<string, unknown>) => Promise<void>;
  maxBytes: number;
}

export type MerchantFileGuardResult =
  | { action: "proceed"; pdfBytes: Buffer }
  | { action: "refuse"; retriable: boolean; reason: string };

export async function guardMerchantFileSlot(
  pdfBytes: Buffer,
  deps: MerchantFileGuardDeps,
): Promise<MerchantFileGuardResult> {
  const slot = await deps.readSlot();
  if (!slot.ok) {
    return { action: "refuse", retriable: true, reason: `evidence_slot_unreadable: ${slot.error}` };
  }
  if (!slot.file || isDisputeDeskFile(slot.file.originalFileName)) {
    return { action: "proceed", pdfBytes };
  }

  const approved = deps.annexEnabled() && (await deps.hasApproval());
  let merged: Buffer | null = null;
  let annexError: string | null = null;
  if (approved) {
    if (!slot.file.url) {
      annexError = "merchant file has no download url";
    } else {
      try {
        const res = await deps.append({
          ours: pdfBytes,
          merchant: await deps.fetchFile(slot.file.url),
          merchantFileType: slot.file.fileType,
        });
        if (!res.ok) annexError = res.error;
        else if (res.bytes.length > deps.maxBytes) annexError = `annexed PDF is ${res.bytes.length} bytes, over the limit`;
        else merged = res.bytes;
      } catch (err) {
        annexError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  await deps.audit(
    merged ? "save_to_shopify_merchant_file_annexed" : "save_to_shopify_refused_merchant_file_present",
    {
      merchantFileName: slot.file.originalFileName,
      merchantFileType: slot.file.fileType,
      approved,
      annexError,
    },
  );
  if (merged) return { action: "proceed", pdfBytes: merged };
  return {
    action: "refuse",
    retriable: false,
    reason:
      "merchant_file_present: Shopify's evidence already holds the merchant's own file " +
      `("${slot.file.originalFileName ?? "unnamed"}"); it is never replaced without the merchant's approval`,
  };
}
