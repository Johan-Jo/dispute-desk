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
import { claimAndSendDeferredNewDisputeAlert } from "@/lib/email/sendNewDisputeAlert";
import { sendHighValueReviewAlert } from "@/lib/email/sendHighValueReviewAlert";
import { evaluateRules } from "@/lib/rules/evaluateRules";
import { normalizeMode, type AutomationMode } from "@/lib/rules/normalizeMode";
import { SETUP_RULE_PREFIX } from "@/lib/rules/setupAutomation";
import {
  DISPUTE_ATTENTION_REASONS,
  type DisputeAttentionReason,
} from "@/lib/disputes/attentionReasons";
import { claimBillingBlockedEmailSlot } from "./billingBlockedEmailThrottle";

const HIGH_VALUE_SAFEGUARD_NAME = `${SETUP_RULE_PREFIX}safeguard:high_value`;
import {
  AUTO_BUILD_TRIGGERED,
  AUTO_SAVE_TRIGGERED,
  PARKED_FOR_REVIEW,
  PACK_BLOCKED,
} from "@/lib/disputeEvents/eventTypes";

/**
 * Mark a dispute as needing merchant attention for a billing-shaped
 * reason and emit the matching audit + dispute timeline events. Also
 * tries to send the deferred new-dispute alert (review variant)
 * subject to the billing-blocked email throttle so repeated blocked
 * disputes don't flood the inbox.
 *
 * Invariant: this function is the ONLY way a "silent" pipeline exit
 * becomes merchant-visible. Audit + timeline event + needs_attention
 * are unconditional; only the email is throttled.
 */
async function recordBlockedAutoBuild(args: {
  shopId: string;
  disputeId: string;
  reason: DisputeAttentionReason;
  attentionPayload: Record<string, unknown>;
  nextActionText: string;
  auditPayload?: Record<string, unknown>;
}): Promise<void> {
  const {
    shopId,
    disputeId,
    reason,
    attentionPayload,
    nextActionText,
    auditPayload,
  } = args;
  const sb = getServiceClient();
  const nowIso = new Date().toISOString();

  // Always-on side effects (audit, dispute event, attention flag).
  await sb.from("audit_events").insert({
    shop_id: shopId,
    dispute_id: disputeId,
    actor_type: "system",
    event_type: "auto_build_skipped",
    event_payload: {
      reason,
      ...attentionPayload,
      ...(auditPayload ?? {}),
    },
  });

  void emitDisputeEvent({
    disputeId,
    shopId,
    eventType: PACK_BLOCKED,
    description: nextActionText,
    eventAt: nowIso,
    actorType: "disputedesk_system",
    sourceType: "pack_engine",
    visibility: "merchant_and_internal",
    metadataJson: { reason, ...attentionPayload },
    dedupeKey: `${disputeId}:${PACK_BLOCKED}:auto_build_skipped:${reason}`,
  });

  await sb
    .from("disputes")
    .update({
      needs_attention: true,
      attention_reason: reason,
      attention_payload: attentionPayload,
      next_action_type: "billing",
      next_action_text: nextActionText,
      updated_at: nowIso,
    })
    .eq("id", disputeId);

  // Pull deadline + new-dispute-alert dedupe state for the email
  // throttle decision. A missing row here just means we won't get the
  // 72h deadline override; throttle still works.
  const { data: disputeRow } = await sb
    .from("disputes")
    .select("due_at")
    .eq("id", disputeId)
    .maybeSingle();

  const slot = await claimBillingBlockedEmailSlot({
    shopId,
    disputeId,
    reason,
    disputeDueAt: (disputeRow?.due_at as string | null) ?? null,
  });

  if (slot.allowed) {
    void claimAndSendDeferredNewDisputeAlert(disputeId, "review").catch(() => {
      /* non-fatal */
    });
  }

  void updateNormalizedStatus(disputeId);
}

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
    await recordBlockedAutoBuild({
      shopId: dispute.shop_id,
      disputeId: dispute.id,
      reason: DISPUTE_ATTENTION_REASONS.AUTO_BUILD_OFF,
      attentionPayload: { source: "automation_pipeline" },
      nextActionText:
        "Auto-build is off for this shop. Turn it on in Settings → Automation to start building packs for new disputes.",
    });
    return { action: "skipped_auto_build_off" };
  }

  const quota = await checkPackQuota(dispute.shop_id);
  if (!quota.allowed) {
    await recordBlockedAutoBuild({
      shopId: dispute.shop_id,
      disputeId: dispute.id,
      reason: DISPUTE_ATTENTION_REASONS.QUOTA_EXCEEDED,
      attentionPayload: {
        plan: quota.plan,
        remaining: quota.remaining,
        limit: quota.limit ?? null,
      },
      nextActionText:
        "You're out of pack credits this cycle. Upgrade your plan or buy a top-up to keep automating disputes.",
      auditPayload: { used: quota.used },
    });
    return { action: "quota_exceeded" };
  }

  const featureCheck = checkFeatureAccess(quota.plan, "autoPack");
  if (!featureCheck.allowed) {
    await recordBlockedAutoBuild({
      shopId: dispute.shop_id,
      disputeId: dispute.id,
      reason: DISPUTE_ATTENTION_REASONS.FEATURE_BLOCKED,
      attentionPayload: { plan: quota.plan },
      nextActionText:
        "Auto-build is a paid feature. Upgrade to Starter or above to enable automated dispute packs.",
    });
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
  // PACK_BUILD_FAILED dispute event; nothing more to do — except send
  // the deferred new-dispute alert (review variant) so the merchant
  // knows a dispute came in. Sync-time send is now deferred for every
  // `pack_enqueued` outcome; without this we'd silently drop the alert.
  //
  // Risk-weakness exception (fraud-risk Phase 2): even on a failed
  // build, the cap can still fire from the persisted shopify_orders
  // snapshot — we don't need a successful Shopify fetch to know the
  // order was HIGH-risk + fulfilled. When the cap triggered, send the
  // review email with the risk_weakness parkReason instead of the
  // generic "build failed" alert, so the merchant understands their
  // auto-mode rule did NOT submit and why. The pack stays "failed" so
  // the UI shows the system-error banner correctly.
  if (pack.status === "failed") {
    const failedRiskWeakness = (
      pack.pack_json as {
        risk_weakness?: { triggered?: boolean; reason?: string | null };
      } | null
    )?.risk_weakness;
    const failedParkedByRiskWeakness =
      failedRiskWeakness?.triggered === true &&
      failedRiskWeakness?.reason === "high_risk_fulfilled";

    if (pack.dispute_id) {
      void claimAndSendDeferredNewDisputeAlert(
        pack.dispute_id,
        "review",
        failedParkedByRiskWeakness ? "risk_weakness" : null,
      ).catch(() => {
        /* non-fatal */
      });
    }
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
    // Send the deferred new-dispute alert (review variant). Sync-time
    // send is now deferred for every `pack_enqueued` outcome and a
    // covered case never reaches an auto-save / park / block branch
    // that would otherwise emit the email. Review copy is acceptable —
    // it doesn't lie about submission and is the most informative
    // existing variant. The merchant still needs to know a dispute
    // came in even when Shopify Protect is paying.
    if (pack.dispute_id) {
      void claimAndSendDeferredNewDisputeAlert(pack.dispute_id, "review").catch(
        () => {
          /* non-fatal */
        },
      );
    }
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
  let matchedRuleName: string | null = null;
  let disputeForAlert: {
    reason: string | null;
    amount: number | null;
  } | null = null;
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
      matchedRuleName = evalResult.matchedRule?.name ?? null;
      disputeForAlert = {
        reason: dispute.reason,
        amount: dispute.amount,
      };
    }
  }

  // Fatal-loss Gate (PRD §3 step 2 / §5). Sits between Coverage Gate
  // and the strength gate. When triggered, auto-mode never submits
  // regardless of completeness or strength — the case is structurally
  // unwinnable. Review-mode falls through and parks normally so the
  // merchant can still see the pack and decide for themselves.
  // Source field: `pack_json.fatal_loss` (persisted by buildPack).
  const fatalLoss = (pack.pack_json as { fatal_loss?: { triggered?: boolean; reason?: string | null; message?: string | null } } | null)?.fatal_loss;
  if (ruleMode === "auto" && fatalLoss?.triggered === true) {
    const reason =
      fatalLoss.message ??
      `Auto-submit blocked — fatal-loss condition (${fatalLoss.reason ?? "unknown"}) per PRD §5`;
    await sb.from("audit_events").insert({
      shop_id: pack.shop_id,
      dispute_id: pack.dispute_id,
      pack_id: packId,
      actor_type: "system",
      event_type: "auto_save_blocked",
      event_payload: { reasons: [reason], fatal_loss: fatalLoss.reason },
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
        metadataJson: { pack_id: packId, reasons: [reason], fatal_loss: fatalLoss.reason },
        dedupeKey: `${pack.dispute_id}:${PACK_BLOCKED}:${packId}:${new Date().toISOString()}`,
      });
      void updateNormalizedStatus(pack.dispute_id);
      // Sync-time send was deferred. Send review variant so the
      // merchant is informed of the new dispute even though the case
      // is structurally unwinnable.
      void claimAndSendDeferredNewDisputeAlert(pack.dispute_id, "review").catch(
        () => {
          /* non-fatal */
        },
      );
    }
    return { action: "block", details: reason };
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
  // Risk-weakness cause detection (fraud-risk Phase 2).
  // When the auto + moderate park branch fires, the cause may be the
  // risk-weakness cap (Strong-would-have-been demoted by HIGH-risk +
  // fulfilled) instead of the natural Moderate score. Surface that
  // distinction in the audit + dispute event + deferred email so the
  // merchant understands why their auto-mode pack landed in review.
  //
  // Read from `pack_json.risk_weakness` populated by buildPack —
  // single source of truth, no recomputation. Bank text NEVER cites
  // this; merchant UI / merchant email only.
  const riskWeaknessRaw =
    (pack.pack_json as {
      risk_weakness?: {
        triggered?: boolean;
        reason?: string | null;
        message?: string | null;
      };
    } | null)?.risk_weakness;
  const parkedByRiskWeakness =
    riskWeaknessRaw?.triggered === true &&
    riskWeaknessRaw?.reason === "high_risk_fulfilled";
  if (ruleMode === "auto" && strengthOverall === "moderate") {
    const reason = parkedByRiskWeakness
      ? "Auto-submit held — Shopify flagged this order as high-risk before fulfillment. Review required per PRD §9."
      : "Auto-mode case strength is Moderate — parked for merchant review per PRD §9";
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
      event_payload: {
        reason,
        rule_mode: ruleMode,
        case_strength: strengthOverall,
        park_cause: parkedByRiskWeakness ? "risk_weakness" : "natural_moderate",
      },
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
        metadataJson: {
          pack_id: packId,
          reason,
          rule_mode: ruleMode,
          case_strength: strengthOverall,
          park_cause: parkedByRiskWeakness ? "risk_weakness" : "natural_moderate",
        },
        dedupeKey: `${pack.dispute_id}:${PARKED_FOR_REVIEW}:${packId}`,
      });
      void updateNormalizedStatus(pack.dispute_id);
    }
    if (pack.dispute_id && !alreadySaved) {
      void claimAndSendDeferredNewDisputeAlert(
        pack.dispute_id,
        "review",
        parkedByRiskWeakness ? "risk_weakness" : null,
      ).catch(() => {
        /* non-fatal */
      });
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
      // Sync-time send was deferred for this dispute. Send the review
      // variant now: the merchant needs to know the case won't auto-
      // submit and they have to act.
      void claimAndSendDeferredNewDisputeAlert(pack.dispute_id, "review").catch(
        () => {
          /* non-fatal */
        },
      );
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
      void claimAndSendDeferredNewDisputeAlert(pack.dispute_id, "review").catch(
        () => {
          /* non-fatal */
        },
      );
    }

    // High-value review alert: when the matched rule is the wizard's
    // amount-safeguard, send a dedicated "high-value dispute parked"
    // email so the merchant knows this one needs their eyes.
    if (
      pack.dispute_id &&
      !alreadySaved &&
      matchedRuleName === HIGH_VALUE_SAFEGUARD_NAME &&
      disputeForAlert
    ) {
      void sendHighValueReviewAlertForPack(
        pack.shop_id,
        pack.dispute_id,
        packId,
        disputeForAlert,
      ).catch((err) => {
        console.error("[pipeline] High-value review alert failed:", err);
      });
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
      // Sync-time send was deferred for this dispute. The auto-save job
      // is now enqueued, so the auto variant ("we submitted it on your
      // behalf") is finally accurate. The pack-saved confirmation that
      // fires from `saveToShopifyJob` is a separate, complementary
      // notification — this one tells the merchant a NEW dispute exists
      // and was handled; that one confirms the actual Shopify save.
      void claimAndSendDeferredNewDisputeAlert(pack.dispute_id, "auto").catch(
        () => {
          /* non-fatal */
        },
      );
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
    // Sync-time send was deferred for this dispute. Auto rule said
    // "submit" but the quality gate refused (low completeness or
    // blockers present). Send review variant so the merchant knows
    // they need to fill the gaps and submit.
    void claimAndSendDeferredNewDisputeAlert(pack.dispute_id, "review").catch(
      () => {
        /* non-fatal */
      },
    );
  }

  return {
    action: "block",
    details: (gate.reasons as string[]).join("; "),
  };
}

/**
 * Compose context and send the high-value review email alert. Idempotent
 * per dispute via `disputes.high_value_alert_sent_at`, so pack rebuilds on
 * the same dispute don't re-notify the merchant. Fire-and-forget.
 */
async function sendHighValueReviewAlertForPack(
  shopId: string,
  disputeId: string,
  packId: string,
  dispute: { reason: string | null; amount: number | null },
): Promise<void> {
  const sb = getServiceClient();

  // Idempotency: skip if we already alerted on this dispute.
  const { data: disputeRow } = await sb
    .from("disputes")
    .select("high_value_alert_sent_at")
    .eq("id", disputeId)
    .single();
  if (disputeRow?.high_value_alert_sent_at) return;

  // Look up the threshold from the wizard payload + the merchant team email.
  const { data: setup } = await sb
    .from("shop_setup")
    .select("steps")
    .eq("shop_id", shopId)
    .single();
  const steps = (setup?.steps ?? {}) as Record<string, { payload?: Record<string, unknown> }>;
  const automationPayload = steps.automation?.payload as
    | { reviewThreshold?: string | number; highValueReviewEnabled?: boolean }
    | undefined;
  const teamPayload = steps.team?.payload as
    | { teamEmail?: string; notifications?: { evidenceReady?: boolean } }
    | undefined;

  // Respect the team's notification opt-out if it's been set.
  if (teamPayload?.notifications?.evidenceReady === false) return;

  const to = teamPayload?.teamEmail;
  if (!to) return;

  const thresholdRaw = automationPayload?.reviewThreshold;
  const threshold =
    typeof thresholdRaw === "number"
      ? thresholdRaw
      : Number.parseFloat(String(thresholdRaw ?? "0"));
  if (!Number.isFinite(threshold) || threshold <= 0) return;

  if (dispute.amount == null) return;

  const { data: shop } = await sb
    .from("shops")
    .select("shop_domain")
    .eq("id", shopId)
    .single();

  const result = await sendHighValueReviewAlert({
    to,
    shopName: shop?.shop_domain ?? undefined,
    shopDomain: shop?.shop_domain ?? null,
    disputeId,
    disputeReason: dispute.reason,
    disputeAmount: String(dispute.amount),
    threshold,
    packId,
  });

  if (result.ok) {
    await sb
      .from("disputes")
      .update({ high_value_alert_sent_at: new Date().toISOString() })
      .eq("id", disputeId);
  }
}
