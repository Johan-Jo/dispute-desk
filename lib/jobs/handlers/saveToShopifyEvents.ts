/**
 * Success-path event burst for save-to-shopify (Phase 2.3 step 3).
 *
 * After the mutation + read-back verification complete, the handler
 * fires four downstream effects:
 *
 *   1. `audit_events` row — `evidence_saved_to_shopify` with the full
 *      verification payload (drives the merchant audit timeline).
 *   2. `emitDisputeEvent(EVIDENCE_SAVED_TO_SHOPIFY)` — the merchant-
 *      facing dispute timeline event (deduped per pack).
 *   3. `updateNormalizedStatus(disputeId)` — recomputes the dispute's
 *      normalized status column from the canonical event stream.
 *   4. `sendPackSavedAlert(...)` — fire-and-forget email alert to the
 *      merchant.
 *
 * The verification warning (`console.warn` when verified===false) is
 * also emitted here so the handler stops carrying log-formatting code
 * at the end of its body.
 *
 * This module owns the SUCCESS path only. Auth-error / GraphQL-error /
 * userError audit events stay inline in the handler — those have
 * different shapes and live next to the throw sites.
 */

import { logAuditEvent } from "@/lib/audit/logEvent";
import { emitDisputeEvent } from "@/lib/disputeEvents/emitEvent";
import { updateNormalizedStatus } from "@/lib/disputeEvents/updateNormalizedStatus";
import { EVIDENCE_SAVED_TO_SHOPIFY } from "@/lib/disputeEvents/eventTypes";
import { sendPackSavedAlert } from "@/lib/email/sendPackSavedAlert";
import type { VerificationDiffOrError } from "@/lib/shopify/verifyEvidenceReadback";

export type SaveFinalStatus =
  | "saved_to_shopify_verified"
  | "saved_to_shopify_unverified";

export interface EmitSaveToShopifyEventsInput {
  shopId: string;
  disputeId: string | null;
  packId: string;
  jobId: string;
  /** Shopify dispute_evidence GID — pinned in the audit payload so
   *  the timeline can deep-link back to the Shopify Admin record. */
  evidenceGid: string;
  /** Final pack status — drives the verified flag downstream. */
  finalStatus: SaveFinalStatus;
  /** Keys present on the `DisputeEvidenceUpdateInput` we sent. */
  inputKeys: string[];
  /** True iff every verifiable field came back through the read-back. */
  verified: boolean;
  /** Whatever the verification step produced — either the diff or an
   *  error envelope. Persisted on the audit event verbatim. */
  verificationDiff: VerificationDiffOrError;
  /** Bookkeeping for the audit payload. */
  manualAttachmentCount: number;
  pdfAttached: boolean;
  /** Dispute-level metadata for the merchant alert. */
  reason: string | null;
  amount: number | null;
  currencyCode: string | null;
  /** ISO timestamp captured at the moment the mutation succeeded. */
  eventAt: string;
}

/**
 * Fire the four success-path effects. Audit log is awaited (it
 * gates the merchant audit timeline). Dispute event + normalized
 * status + email alert are fire-and-forget — same as the inline
 * code this replaced. Errors in any of the fire-and-forget paths
 * are swallowed (logged by the underlying functions).
 */
export async function emitSaveToShopifyEvents(
  args: EmitSaveToShopifyEventsInput,
): Promise<void> {
  const {
    shopId,
    disputeId,
    packId,
    jobId,
    evidenceGid,
    finalStatus,
    inputKeys,
    verified,
    verificationDiff,
    manualAttachmentCount,
    pdfAttached,
    reason,
    amount,
    currencyCode,
    eventAt,
  } = args;

  await logAuditEvent({
    shopId,
    disputeId,
    packId,
    actorType: "system",
    eventType: "evidence_saved_to_shopify",
    eventPayload: {
      evidence_gid: evidenceGid,
      fields_sent: inputKeys,
      field_count: inputKeys.length,
      job_id: jobId,
      session_type: "online",
      verified,
      verification: verificationDiff,
      final_status: finalStatus,
      manual_attachment_count: manualAttachmentCount,
      pdf_attached: pdfAttached,
    },
  });

  if (!verified) {
    const missing = (verificationDiff as { fields_missing?: string[] }).fields_missing ?? [];
    console.warn(
      `[saveToShopify] WARNING: evidence saved but verification failed. ` +
        `Status: ${finalStatus}. Missing fields: ${JSON.stringify(missing)}`,
    );
  }

  if (disputeId) {
    void emitDisputeEvent({
      disputeId,
      shopId,
      eventType: EVIDENCE_SAVED_TO_SHOPIFY,
      description: verified
        ? `${inputKeys.length} evidence fields sent and verified in Shopify`
        : `${inputKeys.length} evidence fields sent to Shopify (verification pending)`,
      eventAt,
      actorType: "disputedesk_system",
      sourceType: "pack_engine",
      metadataJson: {
        pack_id: packId,
        evidence_gid: evidenceGid,
        fields_sent: inputKeys,
        verified,
      },
      dedupeKey: `${disputeId}:${EVIDENCE_SAVED_TO_SHOPIFY}:${packId}`,
    });
    void updateNormalizedStatus(disputeId);
  }

  // The alert template is dispute-scoped (subject line + body reference
  // the dispute reason/amount); skip it if no disputeId. The audit event
  // above already records the save regardless, so observability is
  // preserved.
  if (disputeId) {
    void sendPackSavedAlert({
      shopId,
      disputeId,
      packId,
      reason,
      amount,
      currencyCode,
    });
  }
}
