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
  // SuperAdmin "View as merchant" impersonation. Written by
  // app/api/admin/impersonate/route.ts (enter/exit) and by write routes
  // performed while impersonating. Payload carries `{ adminUserId,
  // adminEmail, mode }` and, for exits, `{ adminUserId }`. actorType is
  // "system" with `admin: true` — matching the `admin_override` convention.
  | "admin_impersonation_started"
  | "admin_impersonation_ended"
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
  // Phase 2 (2026-05-20). Distinct event type for the case where the
  // merchant force-included an INTERNAL_ONLY_FIELDS signal AFTER
  // explicitly acknowledging the bank-facing risk via the warning
  // modal. Always carries `riskAcknowledged: true`, `modalShown`,
  // `confirmedAt` in addition to the standard payload. Logged
  // separately so ops can grep this event type when reviewing lost
  // disputes — every explicit risk override is permanently traceable.
  | "evidence_inclusion_overridden_with_warning"
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
  // A collector-emitted section was suppressed because a SECOND source
  // refuted the fact it asserts (lib/packs/contradictionGate.ts). Written
  // at pack build; payload carries the typed ContradictionRecord[] so the
  // suppression is auditable rather than invisible. Founding case:
  // cay-collective #13195, where Shopify's `returnStatus: NO_RETURN` and a
  // DHL return-to-sender could not both ground an argument.
  | "evidence_contradiction_suppressed"
  // Merchant answered the returned-parcel question via
  // POST /api/packs/:packId/parcel-outcome. Recorded separately from
  // `item_added` because the `disposition` — what the merchant did with
  // goods that came back — is the record anyone reviewing a lost dispute
  // will want, and it never appears in bank-facing text.
  | "parcel_outcome_recorded"
  | "submitted_with_warnings"
  | "order_fetch_failed"
  | "order_gid_null_at_build"
  | "risk_assessment_persisted"
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
  /* An automatic rebuild declined to generate over a human-gated rejection
   * (`lib/defence/latestPackageGenerationGuard.ts`). Recorded because the
   * absence of a new version is otherwise indistinguishable from nothing
   * having tried. */
  | "defence_package_generation_skipped"
  /** A failed package was regenerated because the rules that failed it moved.
   *  Payload carries `retryBasis` — which of prompt / validator / evidence. */
  | "defence_package_failure_retried"
  | "defence_package_failed"
  | "defence_package_skipped"
  | "defence_package_superseded"
  | "defence_package_validation_failed"
  | "defence_package_validation_retry"
  /** Non-blocking validation findings. Recorded so a rule can be measured on
   *  live traffic before it is allowed to fail a package. */
  | "defence_package_validation_warning"
  /** PR-C1 (2026-08-07): a persisted package candidate was refused at a
   *  save / forward / deadline path because it carries a retired delivery
   *  fact or an address-delivery assertion. Nothing was written to Shopify. */
  | "defence_package_blocked_unsafe_claim"
  /** 2026-08-14: the deadline path filed a package that a NEWER build attempt
   *  tried to replace and failed to. The filed version was built from an
   *  earlier evidence snapshot; this row is what explains why v(n-1) reached
   *  the bank while v(n) exists. See `lib/defence/candidateVersions.ts`. */
  | "defence_package_last_good_version_used"
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
  | "pack_regenerate_coalesced_job_already_exists"
  // Merchant review lifecycle — POST /api/disputes/:id/review
  // (lib/disputes/reviewState.ts). actorType "merchant". Payload
  // `{ action, from, to }` where action ∈ hold|approve|concede|clear.
  //   - review_held:     merchant chose "hold & watch" (review_state=in_review)
  //   - review_approved: "reviewed, submit on the deadline" (approved)
  //   - review_conceded: "do not defend" (conceded; deadline cron skips)
  //   - review_cleared:  merchant undid a decision (review_state → NULL)
  //   - review_resurfaced_by_reminder: dispute-reminders cron flipped a
  //     stale `in_review` back to needs_attention near the deadline
  //     (actorType "system"; payload `{ hours_to_deadline }`).
  | "review_held"
  | "review_approved"
  | "review_conceded"
  | "review_cleared"
  | "review_resurfaced_by_reminder";

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
