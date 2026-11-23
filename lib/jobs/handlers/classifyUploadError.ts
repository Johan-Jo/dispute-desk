import { DisputeFileUploadError } from "@/lib/shopify/disputeFileUpload";

/**
 * Retriable or not? A Shopify 4xx on the file upload is a verdict on the FILE
 * (422 "problem with the uploaded file", 400, 403, 404): retrying the same
 * bytes gets the same answer, and #23750 retried one for nine days. 408/429
 * are about timing, and 5xx/network are Shopify's — those retry. The client's
 * own validation errors (size, mime, empty) cannot change on retry either.
 */
export function classifyUploadError(err: unknown): {
  errorClass: string;
  retriable: boolean;
  httpStatus: number | null;
  requestId: string | null;
} {
  if (!(err instanceof DisputeFileUploadError)) {
    return { errorClass: "defence_pdf_upload_failed", retriable: true, httpStatus: null, requestId: null };
  }
  const httpStatus = err.httpStatus ?? null;
  const requestId = err.requestId ?? null;
  if (err.code === "possible_ip_allowlist_403") {
    // Our network address may be off Shopify's IP allowlist — nothing is wrong
    // with the file or the token, so this stays retriable (and visible).
    return { errorClass: "shopify_ip_403", retriable: true, httpStatus, requestId };
  }
  if (err.code.startsWith("validation_")) {
    return { errorClass: "defence_pdf_upload_invalid", retriable: false, httpStatus, requestId };
  }
  if (
    httpStatus != null &&
    httpStatus >= 400 &&
    httpStatus < 500 &&
    httpStatus !== 408 &&
    httpStatus !== 429
  ) {
    return { errorClass: "shopify_upload_rejected", retriable: false, httpStatus, requestId };
  }
  return { errorClass: "defence_pdf_upload_failed", retriable: true, httpStatus, requestId };
}
