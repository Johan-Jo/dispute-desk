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
  | "rule_deleted";

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
