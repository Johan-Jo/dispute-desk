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
  | "submitted_with_warnings"
  | "order_fetch_failed"
  // Conditional file evidence layer (Phase 3 of
  // docs/plans/conditional_file_evidence_layer.plan.md). Both events
  // are emitted from saveToShopifyJob when FILE_EVIDENCE_ATTACHMENTS_ENABLED.
  | "file_evidence_planned"
  | "file_evidence_pipeline_failed";

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
