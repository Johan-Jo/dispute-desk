import { getServiceClient } from "../../supabase/server";
import { logAuditEvent } from "../../audit/logEvent";
import type { ClaimedJob } from "../claimJobs";

/**
 * Job handler: build_pack
 *
 * Collects evidence sources, assembles pack JSON, computes checklist,
 * and writes evidence_items + audit_events.
 *
 * entity_id = evidence_packs.id
 */
export async function handleBuildPack(job: ClaimedJob): Promise<void> {
  const db = getServiceClient();
  const packId = job.entityId;
  if (!packId) throw new Error("build_pack job missing entity_id (pack ID)");

  await db
    .from("evidence_packs")
    .update({ status: "building", updated_at: new Date().toISOString() })
    .eq("id", packId);

  await logAuditEvent({
    shopId: job.shopId,
    packId,
    actorType: "system",
    eventType: "job_started",
    eventPayload: { jobId: job.id, jobType: "build_pack" },
  });

  try {
    // TODO: wire in actual source collectors (orderSource, fulfillmentSource, etc.)
    // For now, mark as ready with placeholder pack_json
    const packJson = {
      version: 1,
      generatedAt: new Date().toISOString(),
      sections: [],
    };

    await db
      .from("evidence_packs")
      .update({
        status: "ready",
        pack_json: packJson,
        completeness_score: 0,
        checklist: { items: [] },
        updated_at: new Date().toISOString(),
      })
      .eq("id", packId);

    await logAuditEvent({
      shopId: job.shopId,
      packId,
      actorType: "system",
      eventType: "pack_created",
      eventPayload: { jobId: job.id, completenessScore: 0 },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await db
      .from("evidence_packs")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", packId);

    await logAuditEvent({
      shopId: job.shopId,
      packId,
      actorType: "system",
      eventType: "job_failed",
      eventPayload: { jobId: job.id, error: message },
    });

    throw err;
  }
}
