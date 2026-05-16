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

/**
 * Grounded Defence Package PDF Builder.
 *
 * When ON, after a pack reaches `status=ready` the build-pack job enqueues
 * `build_defence_package`. The job classifies facts (system owns facts),
 * resolves a reason-code module, calls Anthropic Claude to write narrative
 * prose, validates the output (forbidden phrases + claim guards +
 * usedFactIds integrity), renders a deterministic 15-section PDF, and
 * uploads it to `evidence-packs/{shopId}/{packId}/defence/v{n}/{iso}.pdf`.
 *
 * When a `final` defence package exists, `saveToShopifyJob` replaces the
 * existing pack PDF buffer in the `uncategorizedFile` slot of
 * `disputeEvidenceUpdate`. Structured text fields and per-evidence-field
 * `*File` slots gated by `FILE_EVIDENCE_ATTACHMENTS_ENABLED` are
 * unaffected.
 *
 * When OFF (default), the existing pack PDF path remains byte-identical.
 *
 * Plan: C:\Users\johan\.claude\plans\cozy-zooming-popcorn.md
 */
export function isDefencePackageBuilderEnabled(): boolean {
  return isEnvFlagOn("ENABLE_DEFENCE_PACKAGE_BUILDER");
}
