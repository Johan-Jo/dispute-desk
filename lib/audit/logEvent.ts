import { getServiceClient } from "../supabase/server";

export type EventType =
  | "pack_created"
  | "item_added"
  | "pdf_rendered"
  | "rule_applied"
  | "rule_overridden"
  | "downloaded"
  | "evidence_saved_to_shopify"
  | "job_queued"
  | "job_started"
  | "job_succeeded"
  | "job_failed"
  | "rule_deleted"
  | "admin_override"
  | "billing_activated"
  | "billing_declined"
  | "billing_verification_failed"
  | "topup_purchased"
  | "topup_verification_failed"
  | "pack_credit_consumed"
  | "pack_limit_reached_at_consume"
  | "data_retained"
  | "evidence_waived"
  | "evidence_unwaived"
  // Merchant inclusion override (Phase 1 of the dispute-detail redesign).
  // Written by app/api/packs/[packId]/inclusion-override/route.ts when
  // the merchant toggles a row's inclusion in the bank-facing package.
  // Payload: { field, action: "force_include" | "force_exclude" | "clear",
  // priorState?: "force_include" | "force_exclude" | null }.
  | "evidence_inclusion_overridden"
  // Auto-build of an evidence_pack was enqueued by the system. Existing
  // direct audit_events inserts in lib/automation/pipeline.ts and the
  // new defence-package-deadline-rebuild cron use this event type.
  | "auto_build_enqueued"
  // Merchant submitted a cardholder-acknowledgement text + confirmation
  // checkbox via POST /api/packs/:packId/cardholder-acknowledgement.
  // Written separately from `item_added` so compliance can audit the
  // attestation independently of the evidence_items insert. Payload
  // carries no PII — just `{ evidenceItemId, textLength, confirmedAt }`.
  | "cardholder_acknowledgement_confirmed"
  | "submitted_with_warnings"
  | "order_fetch_failed"
  // Conditional file evidence layer (Phase 3 of
  // docs/plans/conditional_file_evidence_layer.plan.md). Both events
  // are emitted from saveToShopifyJob when FILE_EVIDENCE_ATTACHMENTS_ENABLED.
  | "file_evidence_planned"
  | "file_evidence_pipeline_failed"
  // Grounded Defence Package PDF Builder.
  // Emitted by lib/jobs/handlers/buildDefencePackageJob.ts +
  // app/api/defence-packages/[id]/* routes + lib/defence/enqueue.ts.
  // See plan: C:\Users\johan\.claude\plans\cozy-zooming-popcorn.md.
  | "defence_package_draft_generated"
  | "defence_package_regenerated"
  | "defence_package_finalized"
  | "defence_package_submitted"
  | "defence_package_stale"
  | "defence_package_failed"
  | "defence_package_skipped"
  | "defence_package_superseded"
  | "defence_package_validation_failed"
  | "defence_package_validation_retry"
  | "manual_evidence_added_to_package"
  | "llm_narrative_generated"
  | "llm_narrative_failed"
  | "defence_pdf_render_failed"
  // Resubmission Window — see docs/technical.md § Resubmission Window
  // and plan C:\Users\johan\.claude\plans\so-the-this-is-validated-globe.md.
  // Lifecycle:
  //   - evidence_upload_rejected_window_closed: upload route refused
  //     before persistence because the window already closed.
  //   - pack_regenerate_requested: merchant clicked "Regenerate
  //     package" in the prompt modal. Payload includes
  //     `coalesced: boolean` (true when the pack was already in-flight
  //     and rebuild_pending was set instead of enqueueing).
  //   - save_to_shopify_skipped_window_closed: saveToShopifyJob's
  //     window-closed guards (Guard A early / Guard B pre-mutation)
  //     refused to overwrite the bank-facing package. Payload includes
  //     `guardPoint: "early" | "pre_mutation"`.
  //   - pack_regenerate_coalesced: tail of saveToShopifyJob enqueued
  //     a fresh build_pack after rebuild_pending was set during the
  //     prior cycle.
  //   - pack_regenerate_coalesced_skipped_window_closed: tail saw
  //     submitted_confirmed and cleared the flag instead of enqueueing.
  //   - pack_regenerate_coalesced_job_already_exists: duplicate-job
  //     protection — an active build_pack row already existed in jobs.
  | "evidence_upload_rejected_window_closed"
  | "pack_regenerate_requested"
  | "save_to_shopify_skipped_window_closed"
  | "pack_regenerate_coalesced"
  | "pack_regenerate_coalesced_skipped_window_closed"
  | "pack_regenerate_coalesced_job_already_exists";

export interface AuditLogInput {
  shopId: string;
  disputeId?: string | null;
  packId?: string | null;
  actorType: "merchant" | "system";
  actorId?: string | null;
  eventType: EventType;
  eventPayload?: Record<string, unknown>;
}

/**
 * Append-only audit event writer.
 * This is the ONLY function that writes to audit_events.
 * The table has DB triggers rejecting UPDATE and DELETE.
 */
export async function logAuditEvent(input: AuditLogInput): Promise<void> {
  const db = getServiceClient();

  const { error } = await db.from("audit_events").insert({
    shop_id: input.shopId,
    dispute_id: input.disputeId ?? null,
    pack_id: input.packId ?? null,
    actor_type: input.actorType,
    actor_id: input.actorId ?? null,
    event_type: input.eventType,
    event_payload: input.eventPayload ?? {},
  });

  if (error) {
    console.error("[audit] Failed to write audit event", {
      eventType: input.eventType,
      shopId: input.shopId,
      error: error.message,
    });
    throw new Error(`Audit log write failed: ${error.message}`);
  }
}
