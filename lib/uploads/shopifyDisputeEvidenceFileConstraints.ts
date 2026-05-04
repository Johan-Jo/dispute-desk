/**
 * Constraints for manual evidence uploads that mirror Shopify Payments
 * dispute file upload rules (REST `dispute_file_uploads`).
 *
 * Docs: PNG, JPEG, PDF; combined evidence files stay under ~4 MB.
 *
 * @see https://shopify.dev/docs/api/admin-rest/latest/resources/dispute-file-upload
 */

export const SHOPIFY_DISPUTE_EVIDENCE_FILE_COMBINED_MAX_BYTES = 4 * 1024 * 1024;

/** File input / DropZone `accept` for embedded evidence uploads. */
export const SHOPIFY_DISPUTE_EVIDENCE_FILE_ACCEPT_ATTR =
  ".pdf,.png,.jpg,.jpeg,image/png,image/jpeg,application/pdf";

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "application/pdf",
]);

const ALLOWED_EXT = new Set(["png", "jpg", "jpeg", "pdf"]);

export function disputeEvidenceFileExtensionLower(name: string): string | null {
  const base = name.split(/[/\\]/).pop() ?? name;
  const i = base.lastIndexOf(".");
  if (i <= 0 || i === base.length - 1) return null;
  return base.slice(i + 1).toLowerCase();
}

export function isShopifyDisputeEvidenceFileTypeAllowed(file: {
  type: string;
  name: string;
}): boolean {
  const t = file.type?.trim() ?? "";

  if (t && ALLOWED_MIME.has(t)) return true;

  // Browser reported a concrete (non-unknown) MIME that we do not accept.
  if (t && t !== "application/octet-stream") return false;

  const ext = disputeEvidenceFileExtensionLower(file.name);
  return ext !== null && ALLOWED_EXT.has(ext);
}

/** Validates MIME/extension and per-file ceiling (cannot exceed Shopify cap). */
export function validateShopifyDisputeEvidenceUpload(file: {
  type: string;
  name: string;
  size: number;
}): { ok: true } | { ok: false; error: string } {
  if (file.size <= 0) {
    return { ok: false, error: "Empty files cannot be uploaded." };
  }
  if (file.size > SHOPIFY_DISPUTE_EVIDENCE_FILE_COMBINED_MAX_BYTES) {
    return {
      ok: false,
      error: `File too large. Shopify Payments dispute attachments must be ${SHOPIFY_DISPUTE_EVIDENCE_FILE_COMBINED_MAX_BYTES / (1024 * 1024)} MB or smaller per file.`,
    };
  }
  if (!isShopifyDisputeEvidenceFileTypeAllowed(file)) {
    return {
      ok: false,
      error:
        "File type not allowed. Use PNG, JPG/JPEG, or PDF (same formats Shopify accepts for dispute file uploads).",
    };
  }
  return { ok: true };
}

export function sumEvidencePayloadFileSizes(
  rows: { payload: unknown }[] | null | undefined,
): number {
  let sum = 0;
  for (const r of rows ?? []) {
    const p = r.payload as { fileSize?: unknown } | null;
    if (
      typeof p?.fileSize === "number" &&
      Number.isFinite(p.fileSize) &&
      p.fileSize > 0
    ) {
      sum += p.fileSize;
    }
  }
  return sum;
}
