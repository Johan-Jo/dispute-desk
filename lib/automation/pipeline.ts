/**
 * Automation pipeline orchestrator.
 *
 * Called after a dispute is synced/detected. Decides whether to
 * auto-build a pack and auto-save based on shop settings.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { getShopSettings } from "./settings";
import { evaluateAutoSaveGate } from "./autoSaveGate";
import { checkPackQuota, checkFeatureAccess } from "@/lib/billing/checkQuota";
import { emitDisputeEvent } from "@/lib/disputeEvents/emitEvent";
import { updateNormalizedStatus } from "@/lib/disputeEvents/updateNormalizedStatus";
import { claimAndSendDeferredNewDisputeReviewAlert } from "@/lib/email/sendNewDisputeAlert";
import { evaluateRules } from "@/lib/rules/evaluateRules";
import { normalizeMode, type AutomationMode } from "@/lib/rules/normalizeMode";
import {
  AUTO_BUILD_TRIGGERED,
  AUTO_SAVE_TRIGGERED,
  PARKED_FOR_REVIEW,
  PACK_BLOCKED,
} from "@/lib/disputeEvents/eventTypes";

interface Dispute {
  id: string;
  shop_id: string;
  reason: string | null;
  /** Lifecycle phase from Shopify. Used to pick a phase-specific template fallback. */
  phase?: "inquiry" | "chargeback" | null;
  /** Global pack_templates.id when auto-build was triggered by a reason rule */
  pack_template_id?: string | null;
}

/**
 * Resolve which pack_template the auto-build should use.
 *
 * Precedence:
 *   1. The template the matched rule explicitly specified.
 *   2. The phase-specific default mapping for (reason, phase) — only consulted
 *      when the rule did not specify a template (catch-all / safeguard rules).
 *      This is what makes inquiry-phase disputes get the lighter inquiry
 *      template instead of falling through to the chargeback REASON_TEMPLATES
 *      hardcoded list.
 *   3. null (the build falls through to REASON_TEMPLATES inside buildPack).
 */
async function resolveAutomationTemplate(dispute: Dispute): Promise<string | null> {
  if (dispute.pack_template_id) return dispute.pack_template_id;
  if (!dispute.reason || !dispute.phase) return null;

  const sb = getServiceClient();
  const { data } = await sb
    .from("reason_template_mappings")
    .select("template_id")
    .eq("reason_code", dispute.reason)
    .eq("dispute_phase", dispute.phase)
    .eq("is_active", true)
    .maybeSingle();

  return (data?.template_id as string | null) ?? null;
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

  const resolvedTemplateId = await resolveAutomationTemplate(dispute);

  const { data: pack, error: packErr } = await sb
    .from("evidence_packs")
    .insert({
      shop_id: dispute.shop_id,
      dispute_id: dispute.id,
      status: "queued",
      created_by: "automation",
      pack_template_id: resolvedTemplateId,
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

  void emitDisputeEvent({
    disputeId: dispute.id,
    shopId: dispute.shop_id,
    eventType: AUTO_BUILD_TRIGGERED,
    eventAt: new Date().toISOString(),
    actorType: "disputedesk_system",
    sourceType: "pack_engine",
    metadataJson: { pack_id: pack.id },
    dedupeKey: `${dispute.id}:${AUTO_BUILD_TRIGGERED}:${pack.id}`,
  });
  void updateNormalizedStatus(dispute.id);

  return { action: "pack_enqueued" };
}

/**
 * After a pack is built, evaluate completeness + auto-save gate.
 * Called at the end of the buildPack job handler.
 */
export async function evaluateAndMaybeAutoSave(packId: string): Promise<{
  action: "auto_save" | "park_for_review" | "block" | "skip_covered";
  details: string;
}> {
  const sb = getServiceClient();

  const { data: pack, error } = await sb
    .from("evidence_packs")
    .select(
      "id, shop_id, dispute_id, completeness_score, blockers, submission_readiness, status, pack_json"
    )
    .eq("id", packId)
    .single();

  if (error || !pack) throw new Error("Pack not found");

  // System-level build failure (e.g., order fetch from Shopify failed):
  // skip the auto-save gate entirely. Emitting "auto_save_blocked" here
  // would mislead the merchant into thinking they need to add evidence
  // when the real cause is upstream. The build job already emitted a
  // PACK_BUILD_FAILED dispute event; nothing more to do.
  if (pack.status === "failed") {
    return { action: "block", details: "Pack build failed; skipping auto-save evaluation." };
  }

  // Coverage Gate (PRD §4) — runs before everything else in the
  // automation flow. When Shopify Protect is actively underwriting
  // this dispute (status PROTECTED or ACTIVE), there is no merchant
  // workflow: no auto-save, no review, no block. The pack stays
  // "ready" so the merchant can still see what was collected, but
  // we emit a single audit event so the action is traceable.
  const coverage = (pack.pack_json as { coverage?: { state?: string; shopifyProtectStatus?: string } } | null)?.coverage;
  if (coverage?.state === "covered_shopify") {
    const reason = `Covered by Shopify Protect (${coverage.shopifyProtectStatus ?? "unknown"}) — no merchant action required`;
    await sb.from("audit_events").insert({
      shop_id: pack.shop_id,
      dispute_id: pack.dispute_id,
      pack_id: packId,
      actor_type: "system",
      event_type: "covered_by_shopify",
      event_payload: {
        shopify_protect_status: coverage.shopifyProtectStatus,
      },
    });
    return { action: "skip_covered", details: reason };
  }

  const settings = await getShopSettings(pack.shop_id);

  // The Rules page is the source of truth for whether to automate.
  // We re-evaluate the shop's rules against the dispute at save-time:
  //
  //   - auto   → merchant opted in; run the quality gate and save
  //              immediately if criteria pass.
  //   - review → merchant wants to inspect; park for review.
  //
  // No rule match resolves to "review" inside evaluateRules — we never
  // silently drop a pack that reached the gate.
  let ruleMode: AutomationMode = "review";
  if (pack.dispute_id) {
    const { data: dispute } = await sb
      .from("disputes")
      .select("reason, status, amount, phase")
      .eq("id", pack.dispute_id)
      .single();
    if (dispute) {
      const phaseLower = (dispute.phase ?? "").toLowerCase();
      const phaseForRules =
        phaseLower === "inquiry" || phaseLower === "chargeback"
          ? (phaseLower as "inquiry" | "chargeback")
          : null;
      const evalResult = await evaluateRules({
        id: pack.dispute_id,
        shop_id: pack.shop_id,
        reason: dispute.reason,
        status: dispute.status,
        amount: dispute.amount,
        phase: phaseForRules,
      });
      ruleMode = normalizeMode(evalResult.action.mode);
    }
  }

  // PRD §9 strength gate (auto-mode only). The PRD principle "Auto mode
  // executes ONLY on Strong cases" forbids auto-submission of weaker
  // evidence regardless of completeness:
  //   auto + strong       → fall through to the existing quality gate
  //   auto + moderate     → park_for_review
  //   auto + weak         → block
  //   auto + insufficient → block
  // Source field: `pack_json.case_strength.overall` (persisted in
  // buildPack since the previous commit). Older packs built before
  // that commit have no case_strength entry — we leave the existing
  // behavior intact for them rather than silently flipping decisions.
  const caseStrength = (pack.pack_json as { case_strength?: { overall?: string } } | null)?.case_strength;
  const strengthOverall = caseStrength?.overall ?? null;
  if (ruleMode === "auto" && strengthOverall === "moderate") {
    const reason = "Auto-mode case strength is Moderate — parked for merchant review per PRD §9";
    const alreadySaved =
      pack.status === "saved_to_shopify" ||
      pack.status === "saved_to_shopify_unverified" ||
      pack.status === "saved_to_shopify_verified";
    if (!alreadySaved) {
      await sb
        .from("evidence_packs")
        .update({ status: "ready", updated_at: new Date().toISOString() })
        .eq("id", packId);
    } else {
      await sb
        .from("evidence_packs")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", packId);
    }
    await sb.from("audit_events").insert({
      shop_id: pack.shop_id,
      dispute_id: pack.dispute_id,
      pack_id: packId,
      actor_type: "system",
      event_type: "parked_for_review",
      event_payload: { reason, rule_mode: ruleMode, case_strength: strengthOverall },
    });
    if (pack.dispute_id) {
      void emitDisputeEvent({
        disputeId: pack.dispute_id,
        shopId: pack.shop_id,
        eventType: PARKED_FOR_REVIEW,
        description: reason,
        eventAt: new Date().toISOString(),
        actorType: "disputedesk_system",
        sourceType: "pack_engine",
        metadataJson: { pack_id: packId, reason, rule_mode: ruleMode, case_strength: strengthOverall },
        dedupeKey: `${pack.dispute_id}:${PARKED_FOR_REVIEW}:${packId}`,
      });
      void updateNormalizedStatus(pack.dispute_id);
    }
    if (pack.dispute_id && !alreadySaved) {
      void claimAndSendDeferredNewDisputeReviewAlert(pack.dispute_id).catch(
        () => {
          /* non-fatal */
        },
      );
    }
    return { action: "park_for_review", details: reason };
  }
  if (
    ruleMode === "auto" &&
    (strengthOverall === "weak" || strengthOverall === "insufficient")
  ) {
    const reason = `Auto-mode case strength is ${strengthOverall === "weak" ? "Weak" : "Insufficient"} — auto-submit blocked per PRD §9`;
    await sb.from("audit_events").insert({
      shop_id: pack.shop_id,
      dispute_id: pack.dispute_id,
      pack_id: packId,
      actor_type: "system",
      event_type: "auto_save_blocked",
      event_payload: { reasons: [reason], case_strength: strengthOverall },
    });
    if (pack.dispute_id) {
      void emitDisputeEvent({
        disputeId: pack.dispute_id,
        shopId: pack.shop_id,
        eventType: PACK_BLOCKED,
        eventAt: new Date().toISOString(),
        actorType: "disputedesk_system",
        sourceType: "pack_engine",
        visibility: "merchant_and_internal",
        description: reason,
        metadataJson: { pack_id: packId, reasons: [reason], case_strength: strengthOverall },
        dedupeKey: `${pack.dispute_id}:${PACK_BLOCKED}:${packId}:${new Date().toISOString()}`,
      });
      void updateNormalizedStatus(pack.dispute_id);
    }
    return { action: "block", details: reason };
  }

  // review → merchant approval required, park the pack.
  if (ruleMode === "review") {
    const reason = "Rule action is review — awaiting merchant approval";
    // Never downgrade a pack that has already been saved to Shopify.
    // A rebuild of an already-submitted pack can legitimately re-enter this
    // branch (rules re-evaluated, new build scored below threshold), but the
    // pack is still submitted — flipping status back to "ready" would make
    // the UI say "Not submitted" even though saved_to_shopify_at is set.
    const alreadySaved =
      pack.status === "saved_to_shopify" ||
      pack.status === "saved_to_shopify_unverified" ||
      pack.status === "saved_to_shopify_verified";
    if (!alreadySaved) {
      await sb
        .from("evidence_packs")
        .update({ status: "ready", updated_at: new Date().toISOString() })
        .eq("id", packId);
    } else {
      await sb
        .from("evidence_packs")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", packId);
    }

    await sb.from("audit_events").insert({
      shop_id: pack.shop_id,
      dispute_id: pack.dispute_id,
      pack_id: packId,
      actor_type: "system",
      event_type: "parked_for_review",
      event_payload: { reason, rule_mode: ruleMode },
    });

    if (pack.dispute_id) {
      void emitDisputeEvent({
        disputeId: pack.dispute_id,
        shopId: pack.shop_id,
        eventType: PARKED_FOR_REVIEW,
        description: reason,
        eventAt: new Date().toISOString(),
        actorType: "disputedesk_system",
        sourceType: "pack_engine",
        metadataJson: { pack_id: packId, reason, rule_mode: ruleMode },
        dedupeKey: `${pack.dispute_id}:${PARKED_FOR_REVIEW}:${packId}`,
      });
      void updateNormalizedStatus(pack.dispute_id);
    }

    // "Your response is ready" new-dispute email: only after automated evidence
    // is collected (deferred from first sync when a build was enqueued).
    if (pack.dispute_id && !alreadySaved) {
      void claimAndSendDeferredNewDisputeReviewAlert(pack.dispute_id).catch(
        () => {
          /* non-fatal */
        },
      );
    }

    return { action: "park_for_review", details: reason };
  }

  // auto → run the quality gate.
  const gate = evaluateAutoSaveGate({
    autoSaveEnabled: settings.auto_save_enabled,
    autoSaveMinScore: settings.auto_save_min_score,
    enforceNoBlockers: settings.enforce_no_blockers,
    completenessScore: pack.completeness_score ?? 0,
    blockers: (pack.blockers as string[]) ?? [],
    submissionReadiness: (pack.submission_readiness as "ready" | "ready_with_warnings" | "blocked" | "submitted") ?? undefined,
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

    if (pack.dispute_id) {
      void emitDisputeEvent({
        disputeId: pack.dispute_id,
        shopId: pack.shop_id,
        eventType: AUTO_SAVE_TRIGGERED,
        eventAt: new Date().toISOString(),
        actorType: "disputedesk_system",
        sourceType: "pack_engine",
        metadataJson: {
          pack_id: packId,
          completeness_score: pack.completeness_score,
        },
        dedupeKey: `${pack.dispute_id}:${AUTO_SAVE_TRIGGERED}:${packId}`,
      });
      void updateNormalizedStatus(pack.dispute_id);
    }

    return { action: "auto_save", details: "Enqueued save to Shopify" };
  }

  // gate.action === "block" — the rule said auto but the pack doesn't
  // meet the quality criteria (completeness / blockers). Pack stays
  // "ready" so the merchant can fill the gap and retry.
  await sb.from("audit_events").insert({
    shop_id: pack.shop_id,
    dispute_id: pack.dispute_id,
    pack_id: packId,
    actor_type: "system",
    event_type: "auto_save_blocked",
    event_payload: { reasons: gate.reasons },
  });

  if (pack.dispute_id) {
    void emitDisputeEvent({
      disputeId: pack.dispute_id,
      shopId: pack.shop_id,
      eventType: PACK_BLOCKED,
      eventAt: new Date().toISOString(),
      actorType: "disputedesk_system",
      sourceType: "pack_engine",
      visibility: "merchant_and_internal",
      description: (gate.reasons as string[]).join("; "),
      metadataJson: { pack_id: packId, reasons: gate.reasons },
      dedupeKey: `${pack.dispute_id}:${PACK_BLOCKED}:${packId}:${new Date().toISOString()}`,
    });
    void updateNormalizedStatus(pack.dispute_id);
  }

  return {
    action: "block",
    details: (gate.reasons as string[]).join("; "),
  };
}
