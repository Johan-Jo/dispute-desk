/**
 * Automation pipeline orchestrator.
 *
 * Called after a dispute is synced/detected. Decides whether to
 * auto-build a pack and auto-save based on shop settings.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { getShopSettings } from "./settings";
import { evaluateCompleteness } from "./completeness";
import { evaluateAutoSaveGate } from "./autoSaveGate";
import { checkPackQuota, checkFeatureAccess } from "@/lib/billing/checkQuota";

interface Dispute {
  id: string;
  shop_id: string;
  reason: string | null;
  /** Global pack_templates.id when auto-build was triggered by a reason rule */
  pack_template_id?: string | null;
}

/**
 * Run the automation pipeline for a single dispute.
 * Returns the action taken.
 */
export async function runAutomationPipeline(dispute: Dispute): Promise<{
  action: "pack_enqueued" | "skipped_auto_build_off" | "existing_pack" | "quota_exceeded" | "feature_blocked";
}> {
  const settings = await getShopSettings(dispute.shop_id);

  if (!settings.auto_build_enabled) {
    return { action: "skipped_auto_build_off" };
  }

  const quota = await checkPackQuota(dispute.shop_id);
  if (!quota.allowed) {
    return { action: "quota_exceeded" };
  }

  const featureCheck = checkFeatureAccess(quota.plan, "autoPack");
  if (!featureCheck.allowed) {
    return { action: "feature_blocked" };
  }

  const sb = getServiceClient();

  const { data: existingPack } = await sb
    .from("evidence_packs")
    .select("id, status")
    .eq("dispute_id", dispute.id)
    .not("status", "in", '("failed","archived")')
    .limit(1)
    .maybeSingle();

  if (existingPack) {
    return { action: "existing_pack" };
  }

  const { data: pack, error: packErr } = await sb
    .from("evidence_packs")
    .insert({
      shop_id: dispute.shop_id,
      dispute_id: dispute.id,
      status: "queued",
      created_by: "automation",
      pack_template_id: dispute.pack_template_id ?? null,
    })
    .select("id")
    .single();

  if (packErr) throw new Error(`Failed to create pack: ${packErr.message}`);

  const { error: jobErr } = await sb.from("jobs").insert({
    shop_id: dispute.shop_id,
    job_type: "build_pack",
    entity_id: pack.id,
  });

  if (jobErr) throw new Error(`Failed to enqueue build job: ${jobErr.message}`);

  await sb.from("audit_events").insert({
    shop_id: dispute.shop_id,
    dispute_id: dispute.id,
    pack_id: pack.id,
    actor_type: "system",
    event_type: "auto_build_enqueued",
    event_payload: { trigger: "automation_pipeline" },
  });

  return { action: "pack_enqueued" };
}

/**
 * After a pack is built, evaluate completeness + auto-save gate.
 * Called at the end of the buildPack job handler.
 */
export async function evaluateAndMaybeAutoSave(packId: string): Promise<{
  action: "auto_save" | "park_for_review" | "block";
  details: string;
}> {
  const sb = getServiceClient();

  const { data: pack, error } = await sb
    .from("evidence_packs")
    .select(
      "id, shop_id, dispute_id, completeness_score, blockers, status"
    )
    .eq("id", packId)
    .single();

  if (error || !pack) throw new Error("Pack not found");

  const settings = await getShopSettings(pack.shop_id);

  const gate = evaluateAutoSaveGate({
    settings,
    completenessScore: pack.completeness_score ?? 0,
    blockers: (pack.blockers as string[]) ?? [],
    isApproved: false,
  });

  if (gate.action === "auto_save") {
    await sb
      .from("evidence_packs")
      .update({
        status: "saved_to_shopify",
        saved_to_shopify_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", packId);

    await sb.from("jobs").insert({
      shop_id: pack.shop_id,
      job_type: "save_to_shopify",
      entity_id: packId,
    });

    await sb.from("audit_events").insert({
      shop_id: pack.shop_id,
      dispute_id: pack.dispute_id,
      pack_id: packId,
      actor_type: "system",
      event_type: "auto_save_enqueued",
      event_payload: {
        completeness_score: pack.completeness_score,
        gate_result: gate,
      },
    });

    return { action: "auto_save", details: "Enqueued save to Shopify" };
  }

  if (gate.action === "park_for_review") {
    await sb
      .from("evidence_packs")
      .update({ status: "ready", updated_at: new Date().toISOString() })
      .eq("id", packId);

    await sb.from("audit_events").insert({
      shop_id: pack.shop_id,
      dispute_id: pack.dispute_id,
      pack_id: packId,
      actor_type: "system",
      event_type: "parked_for_review",
      event_payload: { reason: gate.reason },
    });

    return { action: "park_for_review", details: gate.reason };
  }

  // blocked
  await sb
    .from("evidence_packs")
    .update({ status: "blocked", updated_at: new Date().toISOString() })
    .eq("id", packId);

  await sb.from("audit_events").insert({
    shop_id: pack.shop_id,
    dispute_id: pack.dispute_id,
    pack_id: packId,
    actor_type: "system",
    event_type: "auto_save_blocked",
    event_payload: { reasons: gate.reasons },
  });

  return {
    action: "block",
    details: (gate.reasons as string[]).join("; "),
  };
}
