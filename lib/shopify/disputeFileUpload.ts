/**
 * ═══════════════════════════════════════════════════════════════════════════
 *   DEAD CODE — NOT CALLED FROM ANYWHERE. DO NOT WIRE UP WITHOUT RE-PROVING.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Kept as documentation of what was tried and why it did not work.
 *
 * Shopify does not currently expose a public Admin-API path for a third-party
 * app to upload a file and attach it to a chargeback dispute as evidence.
 * Two candidates were probed on 2026-04-21 with the same durable offline
 * token that works for `disputeEvidenceUpdate`:
 *
 * 1. REST POST `/admin/api/{version}/shopify_payments/disputes/:id/dispute_file_uploads.json`
 *    → HTTP 404 `{"errors":"Not Found"}` on versions 2024-10, 2025-04, 2026-01.
 *    The endpoint is not reachable (or not scoped) for public apps.
 *    (See scripts/probe-rest-file-upload.mjs for the captured responses.)
 *
 * 2. GraphQL `stagedUploadsCreate` with `resource: "DISPUTE_FILE_UPLOAD"`
 *    → Rejected: `Expected "DISPUTE_FILE_UPLOAD" to be one of:
 *       COLLECTION_IMAGE, FILE, IMAGE, MODEL_3D, PRODUCT_IMAGE, SHOP_IMAGE,
 *       VIDEO, BULK_MUTATION_VARIABLES, RETURN_LABEL, URL_REDIRECT_IMPORT`.
 *    `DISPUTE_FILE_UPLOAD` is not a valid staged upload resource type. The
 *    previous attempt (git 7e4bcb6) relied on it and surfaced
 *    `Invalid global id 'https://shopify-staged-uploads.storage.googleapis.com/...'`
 *    because a GCS URL is not a GID. `ShopifyPaymentsDisputeFileUploadUpdateInput.id`
 *    is `ID!` and strictly takes a `gid://shopify/ShopifyPaymentsDisputeFileUpload/...`.
 *    (See scripts/probe-staged-upload.mjs for the captured introspection.)
 *
 * As a result, `saveToShopifyJob` submits evidence as text only. The file
 * fields on `ShopifyPaymentsDisputeEvidenceUpdateInput` remain unpopulated;
 * text fields (uncategorizedText, accessActivityLog, etc.) carry the full
 * rebuttal and evidence prose. Files that merchants upload via Shopify Admin
 * UI do attach correctly — but that path is inside Shopify, not our app.
 *
 * If Shopify ever adds a supported upload path, re-introspect first, confirm
 * the returned identifier shape matches `DisputeFileUploadInput.id: ID!`, and
 * rebuild this helper from scratch. Do not unblock it based on docs or
 * external guides without a captured 200 response and a working end-to-end
 * test against a real dispute.
 */

export {};
