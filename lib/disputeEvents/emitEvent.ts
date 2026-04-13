import { getServiceClient } from "../supabase/server";
import type { DisputeEventInput } from "./types";

/**
 * Append-only writer for the dispute_events ledger.
 *
 * Fire-and-forget safe: logs errors but never throws, so callers
 * (sync, pipeline, job handlers) are never broken by event emission.
 *
 * Uses ON CONFLICT (dedupe_key) DO NOTHING for idempotency —
 * retries, sync reruns, and backfill reruns are safe.
 */
export async function emitDisputeEvent(
  input: DisputeEventInput,
): Promise<void> {
  try {
    const db = getServiceClient();

    const { error } = await db.from("dispute_events").insert({
      dispute_id: input.disputeId,
      shop_id: input.shopId,
      event_type: input.eventType,
      description: input.description ?? null,
      event_at: input.eventAt,
      actor_type: input.actorType,
      actor_ref: input.actorRef ?? null,
      source_type: input.sourceType,
      visibility: input.visibility ?? "merchant_and_internal",
      metadata_json: input.metadataJson ?? {},
      dedupe_key: input.dedupeKey,
    });

    if (error) {
      // Unique-violation on dedupe_key is expected (idempotent insert)
      if (error.code === "23505") return;
      console.error("[disputeEvents] Failed to emit event", {
        eventType: input.eventType,
        disputeId: input.disputeId,
        error: error.message,
      });
      return;
    }

    // Update last_event_at on the dispute
    await db
      .from("disputes")
      .update({ last_event_at: input.eventAt })
      .eq("id", input.disputeId);
  } catch (err) {
    console.error("[disputeEvents] Unexpected error emitting event", {
      eventType: input.eventType,
      disputeId: input.disputeId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
