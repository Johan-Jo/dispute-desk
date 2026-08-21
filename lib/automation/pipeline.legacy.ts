/**
 * The pack auto-save ladder as production runs it TODAY, moved verbatim.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────
 *
 * PR 2 wires `evaluateAndMaybeAutoSave` onto the canonical
 * `CaseAutomationDecision`, replacing the two independent ladders this
 * function used to run — `evaluateAutoSubmitGuards` (coverage / fatal-loss /
 * strength) and `evaluateAutoSaveGate` (completeness / readiness). It ships
 * DARK (`lib/pipeline/activation.ts`).
 *
 * "Dark" cannot mean a re-expression that is argued to be equivalent. The
 * canonical ladder deliberately answers weak and insufficient differently
 * (contract revision 2: `hold_for_deadline`, not `block`), reads completeness
 * through `readPersistedCompletenessForGate` rather than three inline
 * coercions, and moved the strength rung below the automation-mode rung. Any
 * of those can change a live disposition. So the OFF path is the SAME CODE,
 * from the kickoff baseline `58e15806`, with two mechanical edits and nothing
 * else:
 *
 *   1. `evaluateAndMaybeAutoSave` -> `evaluateAndMaybeAutoSaveLegacy`.
 *   2. `runAutomationPipeline` and its private `resolveAutomationTemplate`
 *      helper are omitted. CP-C did not touch them, they still live in
 *      `pipeline.ts`, and copying a function nobody gated would create a
 *      second version that can drift.
 *
 * PR 3 deletes this file together with the switch's `false` branch.
 */


import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import {
  preflightBlocks,
  preflightCandidate,
  preflightIsPending,
  preflightIsTransient,
  preflightLatestCandidate,
  preflightReasons,
  preflightRetiredKeys,
} from "@/lib/defence/packageSafety";
import { fetchLatestCandidate } from "@/lib/defence/candidateVersions";
import { markPackageReviewRequired } from "./packageReviewRequired";
import { getShopSettings } from "./settings";
import { evaluateAutoSaveGate } from "./autoSaveGate";
import { resolveEffectiveCompleteness } from "@/lib/evidence/model/completenessActivation";
import { checkPackQuota } from "@/lib/billing/checkQuota";
import { emitDisputeEvent } from "@/lib/disputeEvents/emitEvent";
import { updateNormalizedStatus } from "@/lib/disputeEvents/updateNormalizedStatus";
import { claimAndSendDeferredNewDisputeAlert } from "@/lib/email/sendNewDisputeAlert";
import { sendHighValueReviewAlert } from "@/lib/email/sendHighValueReviewAlert";
import { evaluateRules } from "@/lib/rules/evaluateRules";
import { normalizeMode, type AutomationMode } from "@/lib/rules/normalizeMode";
import {
  SAFEGUARD_RULE_NAME as HIGH_VALUE_SAFEGUARD_NAME,
  readStoreAutomation,
} from "@/lib/rules/storeAutomation";
import {
  isRegenerateBuild,
  isMaterialChange,
  stampRebuildOutcome,
} from "@/lib/automation/rebuildOutcome";
import {
  DISPUTE_ATTENTION_REASONS,
  BILLING_ATTENTION_REASONS,
  type DisputeAttentionReason,
} from "@/lib/disputes/attentionReasons";
import { claimBillingBlockedEmailSlot } from "./billingBlockedEmailThrottle";
import { evaluateAutoSubmitGuards } from "./autoSubmitGuards";

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

/**
 * Self-heal a stale billing-block attention flag. Called after the quota
 * gate PASSES (the shop has credits again). If the dispute still carries a
 * billing-shaped `attention_reason` (quota_exceeded / feature_blocked /
 * subscription_expired / payment_failed), it's out of date — the block
 * that set it no longer holds — so clear it. Scoped to billing reasons
 * ONLY via the WHERE clause, so a genuine merchant task (gorgias review,
 * approval gate, technical error) is never touched. Idempotent + cheap:
 * the update matches nothing when there's no stale billing flag.
 */
async function clearStaleBillingAttention(disputeId: string): Promise<void> {
  const sb = getServiceClient();
  const { error } = await sb
    .from("disputes")
    .update({
      needs_attention: false,
      attention_reason: null,
      attention_payload: {},
      next_action_type: null,
      next_action_text: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", disputeId)
    .in("attention_reason", Array.from(BILLING_ATTENTION_REASONS));
  if (error) {
    // Non-fatal: a failed self-heal just leaves the stale flag for the
    // next pipeline pass; never block the build on it.
    console.warn(
      `[pipeline] clearStaleBillingAttention failed for ${disputeId}: ${error.message}`,
    );
  }
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
 * After a pack is built, evaluate completeness + auto-save gate.
 * Called at the end of the buildPack job handler.
 */
export async function evaluateAndMaybeAutoSaveLegacy(packId: string): Promise<{
  /**
   * `defer_no_package` (PR-C1): the gate said auto-save, but no validated
   * Defence Package exists yet. NOTHING is stamped and NOTHING is enqueued —
   * `saveToShopifyJob` hard-requires a latest `final` package, so a job
   * queued now is a job the worker must reject, and the
   * `status = saved_to_shopify` stamp that used to accompany it was a
   * knowingly false saved state.
   *
   * The dispute is not dropped: `buildDefencePackageJob` re-resolves the rule
   * mode after the build and calls `finalizeAndEnqueueSave` itself when the
   * mode is auto, so the save still happens automatically — just after there
   * is something real to file.
   */
  action:
    | "auto_save"
    | "park_for_review"
    | "block"
    | "skip_covered"
    | "defer_no_package";
  details: string;
}> {
  const sb = getServiceClient();

  const { data: pack, error } = await sb
    .from("evidence_packs")
    .select(
      // `rebuild_pending` is a P-7 input: a pack already flagged for rebuild
      // carries numbers that describe evidence which has moved, and judging
      // one of those against the calibrated threshold is the illegal pairing.
      "id, shop_id, dispute_id, completeness_score, blockers, submission_readiness, status, pack_json, rebuild_pending"
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
  if (pack.status === "failed") {
    if (await isRegenerateBuild(pack.dispute_id)) {
      await stampRebuildOutcome({
        packId,
        outcome: "failed",
        reason: "build_failed",
      });
    }
    if (pack.dispute_id) {
      void claimAndSendDeferredNewDisputeAlert(pack.dispute_id, "review").catch(
        () => {
          /* non-fatal */
        },
      );
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
    if (await isRegenerateBuild(pack.dispute_id)) {
      await stampRebuildOutcome({
        packId,
        outcome: "blocked_covered",
        reason: "coverage_active",
      });
    }
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

  /* ── P-7, APPLIED (plan §1A) ──────────────────────────────────────────
   *
   * Ported forward with the CP-A integration, deliberately. This file is a
   * verbatim snapshot of the pre-canonical pipeline and is the path that runs
   * whenever the activation switch is OFF — which is every environment until
   * PR 3. A snapshot that predates P-7 would therefore have silently reverted
   * the activation for the ONLY route currently executing, and the revert
   * would have looked like "the flag is off", which it is not about.
   *
   * blume-box reads CANONICAL completeness at the calibrated threshold 60;
   * every other shop keeps the persisted column and its own
   * `auto_save_min_score`. See `lib/evidence/model/completenessActivation.ts`
   * for the shop set and the surasvenne exclusion. */
  const { data: gateShop } = await sb
    .from("shops")
    .select("shop_domain")
    .eq("id", pack.shop_id)
    .maybeSingle();
  /* ONE object: score, threshold and which scale produced them. */
  const effectiveCompleteness = resolveEffectiveCompleteness({
    shopDomain: (gateShop?.shop_domain as string | null) ?? null,
    packJson: pack.pack_json,
    rebuildPending: (pack as { rebuild_pending?: unknown }).rebuild_pending,
    persistedScore: pack.completeness_score as number | null,
    merchantThreshold: settings.auto_save_min_score,
  });

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

  // Resubmission Window stamp: only true on rebuilds (window-open
  // disputes). All `stampRebuildOutcome` calls below short-circuit on
  // `false`. Computed once so we don't hit the DB per branch.
  const isRegen = await isRegenerateBuild(pack.dispute_id);

  // Auto-mode pre-flight guards (PRD §5 fatal-loss + §9 strength). ONE
  // shared decision — the same
  // function backs buildDefencePackageJob and reconcileParkedAutoDisputes
  // so the three paths can never disagree (they did: the job used to BLOCK
  // on Moderate while this path PARKED). See lib/automation/autoSubmitGuards.ts.
  //
  // Review mode never consults the guards: it falls through to the review
  // branch below and parks, so the merchant can still see the pack and
  // decide for themselves even on a structurally unwinnable case.
  //
  // Coverage is handled earlier (it returns `skip_covered` before rules are
  // even resolved), so the guards' coverage verdict is unreachable here by
  // construction — it exists for the other two callers.
  const fatalLoss = (pack.pack_json as { fatal_loss?: { triggered?: boolean; reason?: string | null; message?: string | null } } | null)?.fatal_loss;
  const strengthOverall =
    (pack.pack_json as { case_strength?: { overall?: string } } | null)?.case_strength?.overall ?? null;
  const guardVerdict =
    ruleMode === "auto"
      ? evaluateAutoSubmitGuards({
          coverageState: coverage?.state,
          fatalLoss,
          returnedToSender:
            (
              pack.pack_json as {
                returned_to_sender?: {
                  triggered?: boolean;
                  reason?: string | null;
                  message?: string | null;
                };
              } | null
            )?.returned_to_sender ?? null,
          caseStrength: strengthOverall,
          creditAlreadyIssued:
            (
              pack.pack_json as {
                credit_already_issued?: {
                  triggered?: boolean;
                  coversDisputedAmount?: boolean;
                };
              } | null
            )?.credit_already_issued ?? null,
        })
      : ({ decision: "proceed" } as const);

  if (guardVerdict.decision === "block" && guardVerdict.reason === "fatal_loss") {
    const reason = guardVerdict.message;
    await sb.from("audit_events").insert({
      shop_id: pack.shop_id,
      dispute_id: pack.dispute_id,
      pack_id: packId,
      actor_type: "system",
      event_type: "auto_save_blocked",
      event_payload: { reasons: [reason], fatal_loss: fatalLoss?.reason },
    });
    if (isRegen) {
      await stampRebuildOutcome({
        packId,
        outcome: "blocked_fatal_loss",
        reason: fatalLoss?.reason ?? "fatal_loss",
      });
    }
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
        metadataJson: { pack_id: packId, reasons: [reason], fatal_loss: fatalLoss?.reason },
        dedupeKey: `${pack.dispute_id}:${PACK_BLOCKED}:${packId}:${new Date().toISOString()}`,
      });
      void updateNormalizedStatus(pack.dispute_id);
      // Sync-time send was deferred. `held`, not `review`: the guards only
      // run in auto mode, so this merchant is on Auto-pilot and the deadline
      // cron will still save this to Shopify on the due date. The review
      // variant would tell them it "requires your decision", which is false.
      void claimAndSendDeferredNewDisputeAlert(pack.dispute_id, "held").catch(
        () => {
          /* non-fatal */
        },
      );
    }
    return { action: "block", details: reason };
  }

  const parksAsModerate = guardVerdict.decision === "park";
  // Approved-fact count for the material-change heuristic. We need it
  // before the review-mode branch, which is where the
  // `blocked_no_material_change` outcome fires. Read from the most
  // recent draft on this dispute — that's what the next save would
  // submit.
  let newApprovedFactCount: number | null = null;
  if (isRegen && pack.dispute_id) {
    /* "What the next save would submit" is the latest CANDIDATE, not the
     * highest version — a `failed` build submits nothing. Counting its facts
     * made the material-change heuristic compare against a package that could
     * never reach a bank. See `lib/defence/candidateVersions.ts`. */
    const { row: latestDraft } = await fetchLatestCandidate<{
      version: number;
      status?: string | null;
      facts_json: unknown;
    }>(sb, pack.dispute_id as string, "version, status, facts_json");
    newApprovedFactCount = Array.isArray(latestDraft?.facts_json)
      ? (latestDraft!.facts_json as unknown[]).length
      : null;
  }
  if (parksAsModerate) {
    // No rebuild-outcome stamp here. Moderate-strength parks for
    // merchant review with a fresh draft — that's the happy path for
    // a regenerate (new draft is now the candidate), not a blocker.
    // Workspace shows the new draft and the merchant can submit
    // manually. We only stamp `blocked_no_material_change` if the
    // regenerate produced no new bank-eligible signals — in that case
    // re-parking is just noise.
    if (isRegen && pack.dispute_id) {
      const material = await isMaterialChange({
        disputeId: pack.dispute_id,
        newOverall: strengthOverall,
        newApprovedFactCount,
      });
      if (!material) {
        await stampRebuildOutcome({
          packId,
          outcome: "blocked_no_material_change",
          reason: "no_new_bank_eligible_signals",
        });
      }
    }
    const reason = guardVerdict.message;
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
      // Parked by the Moderate guard — auto mode, so the deadline cron still
      // saves it to Shopify on the due date. `held`, not `review`.
      void claimAndSendDeferredNewDisputeAlert(pack.dispute_id, "held").catch(
        () => {
          /* non-fatal */
        },
      );
    }
    return { action: "park_for_review", details: reason };
  }
  if (
    guardVerdict.decision === "block" &&
    (guardVerdict.reason === "weak" || guardVerdict.reason === "insufficient")
  ) {
    if (isRegen && pack.dispute_id) {
      // On a regenerate that lands at weak/insufficient, the merchant
      // needs to know nothing was re-saved AND, if their upload didn't
      // move the needle, why. `blocked_no_material_change` is a more
      // specific banner than `blocked_weak` when applicable.
      const material = await isMaterialChange({
        disputeId: pack.dispute_id,
        newOverall: strengthOverall,
        newApprovedFactCount,
      });
      await stampRebuildOutcome({
        packId,
        outcome: material ? "blocked_weak" : "blocked_no_material_change",
        reason: material
          ? `case_strength_${strengthOverall}`
          : "no_new_bank_eligible_signals",
      });
    }
    const reason = guardVerdict.message;
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
      // Sync-time send was deferred for this dispute. `held`, not `review`:
      // the Weak/Insufficient guard only fires in auto mode, and the block is
      // build-time only — the deadline cron finalizes and submits the draft on
      // the due date. Telling the merchant it "requires your decision" is the
      // exact falsehood this variant exists to fix.
      void claimAndSendDeferredNewDisputeAlert(pack.dispute_id, "held").catch(
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
    // BOTH from the same object, always. The gate's own diagnostic message
    // quotes these two numbers, so the message names the scale that decided.
    autoSaveMinScore: effectiveCompleteness.threshold,
    enforceNoBlockers: settings.enforce_no_blockers,
    completenessScore: effectiveCompleteness.score,
    blockers: (pack.blockers as string[]) ?? [],
    submissionReadiness: (pack.submission_readiness as "ready" | "ready_with_warnings" | "blocked" | "submitted") ?? undefined,
  });

  if (gate.action === "auto_save") {
    /* ── PR-C1 candidate-safety preflight, BEFORE the optimistic stamp ──
     *
     * This branch stamps `status = saved_to_shopify` + `saved_to_shopify_at`
     * and enqueues in the same breath. A blocked attempt must therefore be
     * refused HERE: stamping first would tell every UI, email and metric that
     * the evidence was saved, for a package the worker is going to refuse.
     *
     * Scope note: the optimistic stamp itself is pre-existing behaviour and is
     * deliberately left alone for the SAFE path — see the PR description's
     * dependency note. This only prevents a blocked attempt from claiming
     * success. */
    const preflight = await preflightLatestCandidate(sb, pack.dispute_id as string);
    if (preflightBlocks(preflight)) {
      await logAuditEvent({
        shopId: pack.shop_id,
        disputeId: pack.dispute_id,
        packId,
        actorType: "system",
        eventType: "defence_package_blocked_unsafe_claim",
        eventPayload: {
          packageId: preflightCandidate(preflight)?.id ?? null,
          version: preflightCandidate(preflight)?.version ?? null,
          outcome: preflight.kind,
          reasons: preflightReasons(preflight),
          retiredKeys: preflightRetiredKeys(preflight),
          trigger: "auto_save",
        },
      });
      // A MISSING package or a transient query failure is not a merchant
      // problem, so neither raises a review-required banner. Both simply
      // defer: the post-build path (buildDefencePackageJob ->
      // finalizeAndEnqueueSave) picks the dispute up once a validated package
      // exists, and a query failure is retried on the next build or reconcile.
      if (!preflightIsTransient(preflight) && !preflightIsPending(preflight)) {
        await markPackageReviewRequired(sb, {
          disputeId: pack.dispute_id as string,
          packageId: preflightCandidate(preflight)?.id ?? null,
          reasons: preflightReasons(preflight),
        });
      }
      // A MISSING package is not a merchant problem and not a park — it is a
      // deferral to the post-build path. A transient query failure defers too:
      // the next build or reconcile re-runs the check.
      if (preflightIsPending(preflight)) {
        return { action: "defer_no_package", details: "no_defence_package_yet" };
      }
      if (preflightIsTransient(preflight)) {
        return { action: "defer_no_package", details: "preflight_error" };
      }
      return {
        action: "park_for_review",
        details: `defence_package_unsafe_claim: ${preflightReasons(preflight).join(", ")}`,
      };
    }

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
    event_payload: {
      reasons: gate.reasons,
      /* The pair the gate ACTUALLY compared, and which scale it came from. */
      completeness_score: effectiveCompleteness.score,
      completeness_threshold: effectiveCompleteness.threshold,
      completeness_source: effectiveCompleteness.source,
    },
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
      metadataJson: {
        pack_id: packId,
        reasons: gate.reasons,
        // Same pair as the audit row.
        completeness_score: effectiveCompleteness.score,
        completeness_threshold: effectiveCompleteness.threshold,
        completeness_source: effectiveCompleteness.source,
      },
      dedupeKey: `${pack.dispute_id}:${PACK_BLOCKED}:${packId}:${new Date().toISOString()}`,
    });
    void updateNormalizedStatus(pack.dispute_id);
    // Sync-time send was deferred for this dispute. Auto rule said
    // "submit" but the quality gate refused (low completeness or
    // blockers present). `held`, not `review` — the merchant should fill the
    // gaps, but if they don't, the deadline cron submits what we have.
    void claimAndSendDeferredNewDisputeAlert(pack.dispute_id, "held").catch(
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

  // Merchant team email still comes from the wizard payload.
  const { data: setup } = await sb
    .from("shop_setup")
    .select("steps")
    .eq("shop_id", shopId)
    .single();
  const steps = (setup?.steps ?? {}) as Record<string, { payload?: Record<string, unknown> }>;
  const teamPayload = steps.team?.payload as
    | { teamEmail?: string; notifications?: { evidenceReady?: boolean } }
    | undefined;

  // Respect the team's notification opt-out if it's been set.
  if (teamPayload?.notifications?.evidenceReady === false) return;

  const to = teamPayload?.teamEmail;
  if (!to) return;

  // Threshold comes from the safeguard RULE — the actual source of truth and
  // the very thing that matched to get us here. It used to be read from
  // `shop_setup.steps.automation.payload.reviewThreshold`, which meant a
  // merchant who only ever set the threshold on /app/rules had no payload,
  // so `threshold` came out 0 and this email silently never sent.
  const storeAutomation = await readStoreAutomation(shopId);
  if (!storeAutomation.safeguard.enabled) return;
  const threshold = storeAutomation.safeguard.amount;
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
