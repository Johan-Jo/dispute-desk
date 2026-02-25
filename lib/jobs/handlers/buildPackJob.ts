import { getServiceClient } from "../../supabase/server";
import { logAuditEvent } from "../../audit/logEvent";
import { buildPack } from "../../packs/buildPack";
import { evaluateAndMaybeAutoSave } from "../../automation/pipeline";
import type { ClaimedJob } from "../claimJobs";

/**
 * Job handler: build_pack
 *
 * Delegates to the buildPack orchestrator which runs all source
 * collectors, writes evidence_items, and computes completeness.
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
    const result = await buildPack(packId, {
      correlationId: job.id,
    });

    await logAuditEvent({
      shopId: job.shopId,
      packId,
      actorType: "system",
      eventType: "pack_created",
      eventPayload: {
        jobId: job.id,
        completenessScore: result.completenessScore,
        blockers: result.blockers,
        sectionsCollected: result.sectionsCollected,
        itemsCreated: result.itemsCreated,
      },
    });

    // Automation: evaluate auto-save gate
    await evaluateAndMaybeAutoSave(packId).catch(() => {
      // Non-fatal: auto-save evaluation failure shouldn't fail the build
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
