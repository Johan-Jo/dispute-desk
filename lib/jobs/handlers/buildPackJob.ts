import { getServiceClient } from "../../supabase/server";
import { logAuditEvent } from "../../audit/logEvent";
import { buildPack } from "../../packs/buildPack";
import { evaluateAndMaybeAutoSave } from "../../automation/pipeline";
import {
  sendEvidenceNeededAlert,
  shouldSendEvidenceAlert,
} from "../../email/sendEvidenceNeededAlert";
import { emitDisputeEvent } from "../../disputeEvents/emitEvent";
import { updateNormalizedStatus } from "../../disputeEvents/updateNormalizedStatus";
import {
  PACK_CREATED,
  PACK_BUILD_FAILED,
} from "../../disputeEvents/eventTypes";
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

    // Emit merchant-facing dispute event
    const { data: packRow } = await db
      .from("evidence_packs")
      .select("dispute_id")
      .eq("id", packId)
      .single();
    if (packRow?.dispute_id) {
      void emitDisputeEvent({
        disputeId: packRow.dispute_id,
        shopId: job.shopId,
        eventType: PACK_CREATED,
        description: `Score: ${result.completenessScore}%, ${result.itemsCreated} evidence items collected`,
        eventAt: new Date().toISOString(),
        actorType: "disputedesk_system",
        sourceType: "pack_engine",
        metadataJson: {
          pack_id: packId,
          completeness_score: result.completenessScore,
          items_created: result.itemsCreated,
          blockers: result.blockers,
        },
        dedupeKey: `${packRow.dispute_id}:${PACK_CREATED}:${packId}`,
      });
      void updateNormalizedStatus(packRow.dispute_id);
    }

    // Automation: evaluate auto-save gate
    await evaluateAndMaybeAutoSave(packId).catch(() => {
      // Non-fatal: auto-save evaluation failure shouldn't fail the build
    });

    // Send "manual evidence needed" email if the dispute type warrants it
    await sendManualEvidenceAlert(db, job.shopId, packId).catch((err) => {
      console.error("[buildPack] Evidence alert failed:", err);
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

    // Emit internal-only failure event
    const { data: failedPack } = await db
      .from("evidence_packs")
      .select("dispute_id")
      .eq("id", packId)
      .single();
    if (failedPack?.dispute_id) {
      void emitDisputeEvent({
        disputeId: failedPack.dispute_id,
        shopId: job.shopId,
        eventType: PACK_BUILD_FAILED,
        description: message,
        eventAt: new Date().toISOString(),
        actorType: "disputedesk_system",
        sourceType: "pack_engine",
        visibility: "internal_only",
        metadataJson: { pack_id: packId, error: message },
        dedupeKey: `${failedPack.dispute_id}:${PACK_BUILD_FAILED}:${packId}`,
      });
    }

    throw err;
  }
}

/**
 * Fire-and-forget: check if this dispute needs manual evidence and email the merchant.
 * Reads store profile, notification prefs, and dispute reason to decide.
 */
async function sendManualEvidenceAlert(
  db: ReturnType<typeof getServiceClient>,
  shopId: string,
  packId: string
): Promise<void> {
  // Load pack + dispute info
  const { data: pack } = await db
    .from("evidence_packs")
    .select("id, dispute_id, shop_id")
    .eq("id", packId)
    .single();
  if (!pack?.dispute_id) return;

  const { data: dispute } = await db
    .from("disputes")
    .select("id, reason, amount, currency_code")
    .eq("id", pack.dispute_id)
    .single();
  if (!dispute) return;

  // Load store profile from shop_setup
  const { data: setup } = await db
    .from("shop_setup")
    .select("steps")
    .eq("shop_id", shopId)
    .single();

  const storeProfile = (setup?.steps as Record<string, { payload?: Record<string, unknown> }>)?.store_profile?.payload;
  const digitalProof = storeProfile?.digitalProof as string | undefined;
  const deliveryProof = storeProfile?.deliveryProof as string | undefined;

  // Check if this dispute type needs manual evidence given merchant capabilities
  if (!shouldSendEvidenceAlert(dispute.reason, digitalProof, deliveryProof)) {
    return;
  }

  // Check notification preference
  const teamPayload = (setup?.steps as Record<string, { payload?: Record<string, unknown> }>)?.team?.payload;
  const notifications = teamPayload?.notifications as { evidenceReady?: boolean } | undefined;
  // Default to true if preference not set (evidence alerts are important)
  if (notifications?.evidenceReady === false) return;

  // Get team email
  const teamEmail = teamPayload?.teamEmail as string | undefined;
  // Fallback: shop contact email from shops table
  const { data: shop } = await db
    .from("shops")
    .select("contact_email, shop_domain")
    .eq("id", shopId)
    .single();

  const to = teamEmail || shop?.contact_email;
  if (!to) return;

  const amount = dispute.amount != null ? String(dispute.amount) : null;

  await sendEvidenceNeededAlert({
    to,
    shopName: shop?.shop_domain ?? undefined,
    disputeId: dispute.id,
    disputeReason: dispute.reason,
    disputeAmount: amount,
    packId,
    digitalProof,
    deliveryProof,
  });
}
