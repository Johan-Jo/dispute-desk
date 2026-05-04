/**
 * Feature flag readers.
 *
 * The codebase has no formal flag system — flags are environment
 * variables read at request/job time. Centralising them here avoids
 * `process.env` reads scattered through business logic and gives a
 * single seam for tests to stub.
 *
 * Convention: `FOO_BAR_ENABLED` is on iff `process.env.FOO_BAR_ENABLED`
 * is the literal string `"true"`. Anything else (undefined, "false",
 * "1", "yes", "TRUE", "True") is off. Keeps the on-state explicit.
 */

function isEnvFlagOn(name: string): boolean {
  return process.env[name] === "true";
}

/**
 * Conditional file evidence layer (Phase 3 of
 * `docs/plans/conditional_file_evidence_layer.plan.md`).
 *
 * When ON, `saveToShopifyJob` runs `decideFileAttachments`, generates
 * per-entry PDFs, uploads them to Shopify via the dispute-files REST
 * endpoint, persists the resulting GIDs on the pack for retry
 * idempotency, and sets the matching `*File` fields on the
 * `disputeEvidenceUpdate` mutation. Native-attached items have their
 * link entry suppressed in `uncategorizedText`.
 *
 * When OFF (default), submissions remain text-only with
 * DisputeDesk-hosted links — the path that's been in production since
 * 2026-04-21.
 */
export function isFileEvidenceAttachmentsEnabled(): boolean {
  return isEnvFlagOn("FILE_EVIDENCE_ATTACHMENTS_ENABLED");
}
