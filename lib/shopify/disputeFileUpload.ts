/**
 * Dispute file upload helper.
 *
 * Uploads a file to Shopify's REST endpoint
 *   POST /admin/api/{ver}/shopify_payments/disputes/:id/dispute_file_uploads.json
 * and returns the GID that `disputeEvidenceUpdate` accepts on the matching
 * named file field (`shippingDocumentationFile`, `customerCommunicationFile`,
 * `cancellationPolicyFile`, `refundPolicyFile`, `serviceDocumentationFile`,
 * `uncategorizedFile`).
 *
 * History: this file used to be dead code documenting earlier 404s. Phase 0
 * (2026-05-03) re-probed against the new `read/write_shopify_payments_dispute_file_uploads`
 * scopes and confirmed the endpoint is reachable and returns 200 + a numeric
 * id when called with lowercase snake_case `document_type` values. See
 * `docs/.shopify-evidence/phase-0-results/` for the captured probe runs.
 *
 * NOT WIRED INTO PRODUCTION YET. The conditional file evidence layer plan
 * (`docs/plans/conditional_file_evidence_layer.plan.md`) gates production
 * use behind the `file_evidence_attachments_enabled` flag in Phase 3.
 */
/** Default Shopify Admin API version. Match `lib/shopify/client.ts`. */
const DEFAULT_API_VERSION = "2026-01";

/** Hard limit observed in Shopify Admin's chargeback-response upload modal
 *  (Phase 0c, 2026-05-03): "Must be a .png, .jpg, .pdf and be smaller than
 *  2 MB." The REST API actually accepts up to ~3.81 MiB (3,997,806 bytes),
 *  but anything between 2 MiB and the API ceiling renders inconsistently in
 *  the merchant-facing UI. We pin the lower number — UI ceiling wins,
 *  because the only reason we populate native file fields is to make them
 *  visible to the merchant + issuer. */
export const MAX_FILE_SIZE_BYTES = 2_097_152;

/** Accepted MIME types (Phase 0 probe). Sending any other type returns
 *  HTTP 422 with `"mimetype must be one of image/jpg, image/jpeg,
 *  image/png, application/pdf"`. Note: Shopify also content-sniffs — a
 *  corrupt PDF with `application/pdf` mimetype is rejected with the same
 *  error message even though the declared MIME is in the allow-list. */
export const ACCEPTED_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/jpg",
  "image/jpeg",
  "image/png",
  "application/pdf",
]);

/**
 * REST `document_type` enum. 1:1 mapped to the named file field on
 * `ShopifyPaymentsDisputeEvidenceUpdateInput`. The mapping is enforced
 * Shopify-side: a file uploaded as `shipping_documentation_file` can
 * only be attached to `shippingDocumentationFile` (sending it on a
 * different field is not officially documented; treat the mapping as
 * canonical).
 */
export const DOCUMENT_TYPE_TO_MUTATION_FIELD = {
  customer_communication_file: "customerCommunicationFile",
  refund_policy_file: "refundPolicyFile",
  cancellation_policy_file: "cancellationPolicyFile",
  uncategorized_file: "uncategorizedFile",
  shipping_documentation_file: "shippingDocumentationFile",
  service_documentation_file: "serviceDocumentationFile",
} as const;

export type DisputeFileDocumentType = keyof typeof DOCUMENT_TYPE_TO_MUTATION_FIELD;
export type DisputeEvidenceFileField = (typeof DOCUMENT_TYPE_TO_MUTATION_FIELD)[DisputeFileDocumentType];

export interface UploadDisputeFileInput {
  shopDomain: string;
  accessToken: string;
  /** Numeric Shopify dispute id (NOT the GID). Extract from
   *  `disputes.dispute_gid` via `gid.match(/\/(\d+)$/)?.[1]`. */
  disputeNumericId: string;
  /** REST `document_type` value. Determines which named *File field
   *  the resulting GID can be attached to. */
  documentType: DisputeFileDocumentType;
  /** Display filename. Visible in Shopify Admin chargeback response UI. */
  filename: string;
  /** MIME type. Must be in `ACCEPTED_MIME_TYPES`. */
  mimeType: string;
  /** Raw file bytes. Caller is responsible for validating MIME content
   *  matches; Shopify rejects content-sniff mismatches with HTTP 422. */
  fileBytes: Buffer;
  /** Optional Admin API version. Defaults to `DEFAULT_API_VERSION`. */
  apiVersion?: string;
}

export interface UploadDisputeFileResult {
  /** Numeric Shopify file id from the REST response. */
  fileId: string;
  /** GID-formatted id, ready to pass to `disputeEvidenceUpdate` as
   *  `{ [mutationField]: { id } }`. */
  fileGid: string;
  /** Mutation input field this file can be attached to. */
  mutationField: DisputeEvidenceFileField;
  /** REST response's `dispute_evidence_id` if returned. Equivalent to
   *  the dispute's `disputeEvidence.id`; used when the caller does not
   *  already have the GID handy. */
  disputeEvidenceGid: string | null;
  /** Shopify x-request-id header. ALWAYS log this on failure. */
  requestId: string | null;
}

export class DisputeFileUploadError extends Error {
  constructor(
    public readonly code:
      | "validation_input"
      | "validation_size"
      | "validation_mime"
      | "http_error"
      | "shopify_rejection"
      | "missing_id_in_response",
    message: string,
    public readonly httpStatus?: number,
    public readonly requestId?: string | null,
    public readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = "DisputeFileUploadError";
  }
}

/**
 * Upload a file to a Shopify dispute and return its GID.
 *
 * Validates input at the boundary (size + MIME) before hitting Shopify so
 * predictable client errors fail fast. Network/Shopify failures surface
 * as `DisputeFileUploadError` with `code` discriminator + `requestId` for
 * support diagnostics.
 *
 * Idempotency note: Shopify creates a NEW file id on each successful POST
 * — there is no de-dup. Callers must persist the GID before retrying
 * (see Phase 3 in conditional_file_evidence_layer.plan.md).
 */
export async function uploadDisputeFile(
  args: UploadDisputeFileInput,
): Promise<UploadDisputeFileResult> {
  const {
    shopDomain,
    accessToken,
    disputeNumericId,
    documentType,
    filename,
    mimeType,
    fileBytes,
    apiVersion = DEFAULT_API_VERSION,
  } = args;

  if (!shopDomain || !accessToken || !disputeNumericId) {
    throw new DisputeFileUploadError(
      "validation_input",
      "shopDomain, accessToken, and disputeNumericId are required",
    );
  }
  if (!/^\d+$/.test(disputeNumericId)) {
    throw new DisputeFileUploadError(
      "validation_input",
      `disputeNumericId must be digits only, got "${disputeNumericId}"`,
    );
  }
  if (!(documentType in DOCUMENT_TYPE_TO_MUTATION_FIELD)) {
    throw new DisputeFileUploadError(
      "validation_input",
      `Unknown document_type: ${documentType}`,
    );
  }
  if (!ACCEPTED_MIME_TYPES.has(mimeType)) {
    throw new DisputeFileUploadError(
      "validation_mime",
      `MIME ${mimeType} not in ACCEPTED_MIME_TYPES (${[...ACCEPTED_MIME_TYPES].join(", ")})`,
    );
  }
  if (fileBytes.length === 0) {
    throw new DisputeFileUploadError(
      "validation_input",
      "fileBytes is empty",
    );
  }
  if (fileBytes.length > MAX_FILE_SIZE_BYTES) {
    throw new DisputeFileUploadError(
      "validation_size",
      `File size ${fileBytes.length} exceeds Shopify limit of ${MAX_FILE_SIZE_BYTES} bytes`,
    );
  }

  const url = `https://${shopDomain}/admin/api/${apiVersion}/shopify_payments/disputes/${disputeNumericId}/dispute_file_uploads.json`;
  const body = {
    dispute_file_upload: {
      document_type: documentType,
      filename,
      mimetype: mimeType,
      data: fileBytes.toString("base64"),
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify(body),
  });

  const requestId = res.headers.get("x-request-id");
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    throw new DisputeFileUploadError(
      "shopify_rejection",
      `Shopify HTTP ${res.status} on dispute_file_uploads.json: ${text.slice(0, 400)}`,
      res.status,
      requestId,
      parsed,
    );
  }

  const obj = parsed as
    | { dispute_file_upload?: { id?: number | string; dispute_evidence_id?: number | string } }
    | undefined;
  const rawId = obj?.dispute_file_upload?.id;
  if (rawId === undefined || rawId === null) {
    throw new DisputeFileUploadError(
      "missing_id_in_response",
      `Shopify returned 200 but no dispute_file_upload.id: ${text.slice(0, 400)}`,
      res.status,
      requestId,
      parsed,
    );
  }
  const fileId = String(rawId);
  const fileGid = `gid://shopify/ShopifyPaymentsDisputeFileUpload/${fileId}`;

  const rawEv = obj?.dispute_file_upload?.dispute_evidence_id;
  const disputeEvidenceGid =
    rawEv !== undefined && rawEv !== null
      ? `gid://shopify/ShopifyPaymentsDisputeEvidence/${String(rawEv)}`
      : null;

  return {
    fileId,
    fileGid,
    mutationField: DOCUMENT_TYPE_TO_MUTATION_FIELD[documentType],
    disputeEvidenceGid,
    requestId,
  };
}
