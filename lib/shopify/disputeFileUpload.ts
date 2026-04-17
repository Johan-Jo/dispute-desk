/**
 * Dispute evidence file upload via Shopify REST Admin API.
 *
 * Flow:
 * 1. POST base64-encoded file to /admin/api/{version}/shopify_payments/disputes/{id}/dispute_file_uploads.json
 * 2. Shopify returns a GID (gid://shopify/ShopifyPaymentsDisputeFileUpload/...)
 * 3. Use that GID in disputeEvidenceUpdate file fields (customerCommunicationFile, etc.)
 *
 * Constraints:
 * - Accepted formats: .png, .jpeg, .pdf
 * - Max 4 MB total across all files per dispute
 * - Uses write_shopify_payments_dispute_evidences scope (no extra scope needed)
 */

import { SHOPIFY_API_VERSION } from "./client";

/** Valid document types for dispute file uploads. */
export type DisputeDocumentType =
  | "CANCELLATION_POLICY_FILE"
  | "CUSTOMER_COMMUNICATION_FILE"
  | "CUSTOMER_EMAIL_FILE"
  | "REFUND_POLICY_FILE"
  | "SERVICE_DOCUMENTATION_FILE"
  | "SHIPPING_DOCUMENTATION_FILE"
  | "UNCATEGORIZED_FILE";

interface DisputeFileUploadResponse {
  dispute_file_upload: {
    id: number;
    dispute_id: number;
    document_type: string;
    filename: string;
    url: string;
  };
}

interface DisputeFileUploadErrorResponse {
  errors?: Record<string, string[]> | string;
}

/**
 * Extract numeric dispute ID from a Shopify GID.
 * "gid://shopify/ShopifyPaymentsDispute/123456" → "123456"
 */
export function extractNumericId(gid: string): string {
  const match = gid.match(/\/(\d+)$/);
  if (!match) throw new Error(`Cannot extract numeric ID from GID: ${gid}`);
  return match[1];
}

/**
 * Upload a file to Shopify dispute evidence via REST API.
 *
 * @returns The Shopify GID of the uploaded file for use in disputeEvidenceUpdate,
 *          or null if the upload failed.
 */
export async function uploadDisputeFile(
  session: { shopDomain: string; accessToken: string },
  disputeGid: string,
  documentType: DisputeDocumentType,
  filename: string,
  mimeType: string,
  fileBuffer: Buffer,
  correlationId?: string,
): Promise<string | null> {
  const disputeId = extractNumericId(disputeGid);
  const base64Data = fileBuffer.toString("base64");

  const url = `https://${session.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/shopify_payments/disputes/${disputeId}/dispute_file_uploads.json`;

  const body = {
    dispute_file_upload: {
      document_type: documentType,
      filename,
      mimetype: mimeType,
      data: base64Data,
    },
  };

  const tag = correlationId ? `[disputeFileUpload:${correlationId}]` : "[disputeFileUpload]";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": session.accessToken,
        ...(correlationId ? { "X-Request-Id": correlationId } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({})) as DisputeFileUploadErrorResponse;
      const errMsg = typeof errBody.errors === "string"
        ? errBody.errors
        : JSON.stringify(errBody.errors ?? res.statusText);
      console.error(`${tag} REST upload failed (${res.status}): ${errMsg}`);
      return null;
    }

    const json = await res.json() as DisputeFileUploadResponse;
    const fileId = json.dispute_file_upload?.id;

    if (!fileId) {
      console.error(`${tag} No file ID in response:`, JSON.stringify(json));
      return null;
    }

    const gid = `gid://shopify/ShopifyPaymentsDisputeFileUpload/${fileId}`;
    console.log(`${tag} File uploaded: ${filename} (${documentType}) → ${gid}`);
    return gid;
  } catch (err) {
    console.error(
      `${tag} Upload error:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
