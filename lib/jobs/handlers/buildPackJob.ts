import { getServiceClient } from "../../supabase/server";
import { logAuditEvent } from "../../audit/logEvent";
import { evaluateCompleteness } from "../../automation/completeness";
import { evaluateAndMaybeAutoSave } from "../../automation/pipeline";
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
    // Fetch dispute reason for completeness evaluation
    const { data: pack } = await db
      .from("evidence_packs")
      .select("dispute_id")
      .eq("id", packId)
      .single();
    const { data: dispute } = pack?.dispute_id
      ? await db
          .from("disputes")
          .select("reason")
          .eq("id", pack.dispute_id)
          .single()
      : { data: null };

    // TODO: wire in actual source collectors (orderSource, fulfillmentSource, etc.)
    // For now, produce a placeholder pack_json with collected field keys
    const collectedFields = new Set<string>(["order_confirmation"]);
    const packJson = {
      version: 1,
      generatedAt: new Date().toISOString(),
      sections: [],
      order_confirmation: { placeholder: true },
    };

    const completeness = evaluateCompleteness(
      dispute?.reason ?? null,
      collectedFields
    );

    await db
      .from("evidence_packs")
      .update({
        status: completeness.blockers.length > 0 ? "blocked" : "ready",
        pack_json: packJson,
        completeness_score: completeness.score,
        checklist: completeness.checklist,
        blockers: completeness.blockers,
        recommended_actions: completeness.recommended_actions,
        updated_at: new Date().toISOString(),
      })
      .eq("id", packId);

    await logAuditEvent({
      shopId: job.shopId,
      packId,
      actorType: "system",
      eventType: "pack_created",
      eventPayload: {
        jobId: job.id,
        completenessScore: completeness.score,
        blockers: completeness.blockers,
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
