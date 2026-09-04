/**
 * Automation pipeline orchestrator.
 *
 * Called after a dispute is synced/detected. Decides whether to
 * auto-build a pack and auto-save based on shop settings.
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
import { decideForPack } from "./decision";
import { canonicalPipelineEnabled } from "@/lib/pipeline/activation";
import {
  selectForNormalExecutor,
  selectionIsMerchantActionable,
  selectionIsPending,
} from "@/lib/defence/package";
import { evaluateAndMaybeAutoSaveLegacy } from "./pipeline.legacy";
import {
  resolveEffectiveCompleteness,
  type EffectiveCompleteness,
} from "@/lib/evidence/model/completenessActivation";
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

/* ── Audit / timeline phrasing for a decision outcome ──────────────────────
 *
 * These strings are MOVED, not written: they are the exact messages
 * `evaluateAutoSubmitGuards` and `evaluateAutoSaveGate` produced, kept
 * character-for-character so the audit trail and the dispute timeline do not
 * shift under a change that is meant to be behaviour-preserving.
 *
 * They are the pre-existing English-in-`lib/` debt this epic deliberately does
 * NOT pay off: replacing them with `I18nToken`s changes merchant-visible copy
 * across six locales and belongs in its own change, not inside the one that
 * unifies the decision. The decision itself emits machine reason codes only —
 * that is the part that had to be right here.
 */
const MODERATE_PARK_MESSAGE =
  "Auto-mode case strength is Moderate — parked for merchant review per PRD §9";

/**
 * Tell the merchant a fatal-loss case needs a decision from them.
 *
 * Standing DisputeDesk down is not neutral: Shopify still files its own scrape
 * of the order at the deadline, and on an unfulfilled INR order that scrape
 * argues against the merchant. Before 2026-09-04 the only signal was a line of
 * strength-reason copy inside the app, which nobody is watching — the merchant
 * found out when they lost. See `lib/email/sendFatalLossAlert.ts`.
 *
 * DEDUPED ON THE AUDIT LOG, once per (dispute, reason). Every rebuild re-runs
 * this branch — blume-box #360499 alone rebuilt three times in a week — and a
 * merchant emailed the same warning on every pack rebuild stops reading them.
 * The reason is part of the key on purpose: a case that moves from
 * `inr_no_fulfillment` to `refund_issued` has genuinely new advice.
 *
 * Fire-and-forget. A failed send must never fail the pipeline: the block
 * decision itself is already recorded.
 */
async function notifyFatalLoss(
  sb: ReturnType<typeof getServiceClient>,
  pack: { shop_id: string; dispute_id: string | null },
  fatalLossReason: string | null,
): Promise<void> {
  try {
    if (!pack.dispute_id || !fatalLossReason) return;
    if (fatalLossReason !== "inr_no_fulfillment" && fatalLossReason !== "refund_issued") {
      return;
    }

    const { data: already } = await sb
      .from("audit_events")
      .select("event_payload")
      .eq("dispute_id", pack.dispute_id)
      .eq("event_type", "fatal_loss_alert_sent")
      .limit(50);
    const alreadySentForThisReason = (already ?? []).some(
      (row) =>
        (row.event_payload as { reason?: string } | null)?.reason === fatalLossReason,
    );
    if (alreadySentForThisReason) return;

    const { data: dispute } = await sb
      .from("disputes")
      .select("dispute_gid, reason, amount, currency_code, due_at, order_name, phase")
      .eq("id", pack.dispute_id)
      .maybeSingle();

    const { sendFatalLossAlert } = await import("@/lib/email/sendFatalLossAlert");
    const result = await sendFatalLossAlert({
      shopId: pack.shop_id,
      disputeId: pack.dispute_id,
      disputeGid: (dispute?.dispute_gid as string | null) ?? null,
      reason: fatalLossReason,
      disputeReason: (dispute?.reason as string | null) ?? null,
      amount:
        dispute?.amount != null ? Number(dispute.amount as unknown as string) : null,
      currencyCode: (dispute?.currency_code as string | null) ?? null,
      dueAt: (dispute?.due_at as string | null) ?? null,
      orderName: (dispute?.order_name as string | null) ?? null,
      // Decides whether "refund it" is legal advice: Shopify blocks refunds
      // once a chargeback is open, but an inquiry can still be refunded.
      phase: (dispute?.phase as string | null) ?? null,
    });

    // Only stamp on a real send, so a missing RESEND_API_KEY or an unconfigured
    // team email does not permanently suppress the alert for this dispute.
    if (result.ok) {
      await sb.from("audit_events").insert({
        shop_id: pack.shop_id,
        dispute_id: pack.dispute_id,
        actor_type: "system",
        event_type: "fatal_loss_alert_sent",
        event_payload: { reason: fatalLossReason },
      });
    }
  } catch {
    /* non-fatal — the block decision is already recorded */
  }
}

function fatalLossMessage(
  fatalLoss: { reason?: string | null; message?: string | null } | null | undefined,
): string {
  return (
    fatalLoss?.message ??
    `Auto-submit blocked — fatal-loss condition (${fatalLoss?.reason ?? "unknown"}) per PRD §5`
  );
}

function strengthBlockMessage(overall: string | null): string {
  const label = overall === "insufficient" ? "Insufficient" : "Weak";
  return `Auto-mode case strength is ${label} — auto-submit blocked per PRD §9`;
}

/**
 * The merchant-visible reason, quoting the pair that actually decided.
 *
 * Takes `EffectiveCompleteness` rather than `settings` + a loose number: under
 * P-7 an activated shop is judged against the calibrated 60, not against their
 * own `auto_save_min_score`, and a message naming the setting would report a
 * threshold the gate never applied. One object, so the two numbers in the
 * sentence cannot come from different scales.
 */
function gateBlockMessage(
  reasonCode: string | undefined,
  completeness: EffectiveCompleteness,
): string {
  switch (reasonCode) {
    case "automation_disabled":
      return "Auto-save is disabled for this store";
    case "below_completeness_threshold":
      return `Completeness score ${completeness.score}% is below threshold ${completeness.threshold}%`;
    case "hard_block":
      return "Submission is blocked — required evidence missing";
    default:
      // Coverage, fatal-loss and staleness are handled by their own branches
      // above and are unreachable here; the code is surfaced rather than
      // invented copy so an unexpected outcome is diagnosable.
      return reasonCode ?? "unknown";
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
  action:
    | "pack_enqueued"
    | "skipped_auto_build_off"
    | "existing_pack"
    | "quota_exceeded"
    | "skipped_terminal";
}> {
  // Terminal-status guard: never auto-build (or emit a blocked event, or spend
  // a credit) for a dispute with nothing left to submit. A closed / won / lost /
  // accepted dispute has no live deadline — building a pack is wasted work and,
  // on credit-gated plans, would burn a pack on a resolved case. The
  // historicalImport guard in the dispatcher covers first-sync; this protects
  // EVERY caller (manual re-sync, status-change events on resolved disputes).
  {
    const sb0 = getServiceClient();
    const { data: row } = await sb0
      .from("disputes")
      .select("final_outcome, closed_at, normalized_status")
      .eq("id", dispute.id)
      .maybeSingle();
    const outcome = (row?.final_outcome as string | null) ?? null;
    const ns = (row?.normalized_status as string | null) ?? null;
    const isTerminal =
      row?.closed_at != null ||
      (outcome != null && outcome !== "unknown") ||
      ns === "won" ||
      ns === "lost" ||
      ns === "accepted_not_contested" ||
      ns === "closed_other";
    if (isTerminal) {
      return { action: "skipped_terminal" };
    }
  }

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

  // Self-heal a STALE billing block: the shop now HAS credits (we passed
  // the quota gate), so any lingering `quota_exceeded` (or other billing)
  // attention flag on this dispute is out of date and must be cleared —
  // otherwise a dispute stays "Billing action required" forever after the
  // merchant tops up (blume-box prod, 2026-07-27: 65 disputes stuck on a
  // pre-top-up quota flag). Only touches billing-shaped reasons; never a
  // real merchant task (gorgias/approval/etc.).
  await clearStaleBillingAttention(dispute.id);

  // NOTE: auto-build is NOT tier-gated. Every plan — including Free — can
  // auto-build; the credit ledger is the only gate. Free ships with 5
  // free_lifetime credits (FREE_LIFETIME_PACKS), so free-tier shops auto-build
  // until those 5 are spent, then `checkPackQuota` above returns the proper
  // "out of pack credits" exit. (Previously a `checkFeatureAccess(plan,
  // "autoPack")` tier check blocked ALL free shops here — even with credits
  // available — flooding the feed with "Auto-build is a paid feature".)

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
  // DARK UNTIL PR 3. The canonical ladder below is load-bearing when the
  // switch is on — one `CaseAutomationDecision`, read by every branch. With
  // the switch off the ladder that shipped at `58e15806` runs instead, from
  // `pipeline.legacy.ts`, unchanged. Not a mapped equivalent: the canonical
  // ladder holds weak/insufficient for the deadline where the shipped one
  // blocks (contract revision 2), and that difference must not reach
  // production on a merge.
  if (!canonicalPipelineEnabled()) return evaluateAndMaybeAutoSaveLegacy(packId);

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
   * blume-box reads CANONICAL completeness at the calibrated threshold 60;
   * every other shop keeps the persisted column and its own
   * `auto_save_min_score`. The decision is a constant, not a question — the
   * calibration re-run on the post-C-14 baseline produced no
   * disposition-preserving threshold for surasvenne at any value, so it is
   * excluded rather than deferred.
   *
   * Resolved HERE, at the live gate, because that is what activation means: a
   * statement in a calibration report changes no disposition. See
   * `lib/evidence/model/completenessActivation.ts` for the shop set, the
   * exclusion and why the threshold travels with the shop rather than reusing
   * a merchant setting chosen on the OLD scale. */
  const { data: gateShop } = await sb
    .from("shops")
    .select("shop_domain")
    .eq("id", pack.shop_id)
    .maybeSingle();
  /* ONE object: score, threshold and which scale produced them. Resolving the
   * two numbers separately is what makes a legacy score against the calibrated
   * 60 representable, and that pairing silently lowers the bar for every pack
   * the rebuild has not reached. */
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
  let evidenceDueAt: string | null = null;
  // Plan-derivation inputs for the canonical selector. Read off the same
  // dispute row the decision already loads, never re-queried.
  let disputeReason: string | null = null;
  let networkReasonCode: string | null = null;
  let disputeForAlert: {
    reason: string | null;
    amount: number | null;
  } | null = null;
  if (pack.dispute_id) {
    const { data: dispute } = await sb
      .from("disputes")
      // `due_at` is an INPUT to the canonical decision — the ABSOLUTE evidence
      // deadline, never a relative window. Executors derive window state from
      // it at execution time; the decision only carries the instant.
      .select("reason, network_reason_code, status, amount, phase, due_at")
      .eq("id", pack.dispute_id)
      .single();
    if (dispute) {
      evidenceDueAt = (dispute.due_at as string | null) ?? null;
      disputeReason = (dispute.reason as string | null) ?? null;
      networkReasonCode = (dispute.network_reason_code as string | null) ?? null;
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

  /* ── THE canonical automation decision ────────────────────────────────
   *
   * ONE object, derived once, read by every branch below. It replaces the two
   * independent ladders this function used to run — `evaluateAutoSubmitGuards`
   * (coverage / fatal-loss / strength) and `evaluateAutoSaveGate`
   * (completeness / readiness) — which between them could disagree with the
   * defence build, the reconcile pass and the deadline cron about the same
   * dispute. Nothing below re-derives a gate; each branch only chooses the
   * SIDE EFFECTS (pack status, audit event, timeline event, email variant)
   * that this codebase already produces for that outcome.
   *
   * Coverage is handled earlier (it returns `skip_covered` before rules are
   * even resolved), so `coverage_active` is unreachable here by construction —
   * it exists on the decision for the other callers.
   *
   * Review mode never reaches the strength branches: `ruleMode !== "auto"`
   * short-circuits each of them, exactly as the guards did by only running in
   * auto mode, so a merchant on review still sees the pack and decides for
   * themselves even on a structurally unwinnable case.
   */
  const fatalLoss = (pack.pack_json as { fatal_loss?: { triggered?: boolean; reason?: string | null; message?: string | null } } | null)?.fatal_loss;
  const strengthOverall =
    (pack.pack_json as { case_strength?: { overall?: string } } | null)?.case_strength?.overall ?? null;
  const decision = decideForPack({
    caseId: (pack.dispute_id as string | null) ?? packId,
    pack: {
      id: packId,
      dispute_id: (pack.dispute_id as string | null) ?? null,
      completeness_score: pack.completeness_score ?? null,
      blockers: pack.blockers,
      submission_readiness: pack.submission_readiness,
      pack_json: pack.pack_json,
    },
    settings,
    /* P-7 travels INTO the decision, as one object.
     *
     * Without this the canonical ladder read `completeness_score` and
     * `auto_save_min_score` itself, which quietly un-did the activation the
     * moment the switch went on: blume-box would have been judged on the legacy
     * column against their own setting, and every shop with no setting judged
     * against a 60 nobody calibrated for them. The score also enters the
     * decision's input hash through here, so a decision taken on one scale
     * cannot be reused as current after the shop moves to the other. */
    completeness: effectiveCompleteness,
    automationMode: ruleMode,
    evidenceDueAt,
  });
  const decisionHead = decision.reasonCodes[0];

  if (
    ruleMode === "auto" &&
    decision.action === "block" &&
    decisionHead === "fatal_loss"
  ) {
    const reason = fatalLossMessage(fatalLoss);
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
    void notifyFatalLoss(sb, pack, fatalLoss?.reason ?? null);
    return { action: "block", details: reason };
  }

  /*
   * CONTRACT REVISION 2 — THE TWO HOLDS, AND WHY THEY ARE TOLD APART BY A
   * REASON CODE RATHER THAN BY AN ACTION.
   *
   * Weak / insufficient used to come back from the decision as `block`, so this
   * function distinguished "parked by the Moderate guard" from "blocked by the
   * strength floor" on `decision.action`. Revision 2 removed that distinction
   * at the source: strength is an odds judgement, odds never withhold a filing,
   * and BOTH bands now return `hold_for_deadline`.
   *
   * Left unadapted, this is not a cosmetic mismatch — it is a live defect.
   * Every weak case would have fallen into the Moderate branch below, which
   * tells the merchant "case strength is Moderate", skips the
   * `blocked_weak` / `blocked_no_material_change` rebuild stamp a merchant
   * watches after re-uploading evidence, and leaves the strength floor's own
   * branch with no reachable condition at all.
   *
   * So the discriminator moves to the reason code — the same one
   * `resolveHeldState` reads, which is what keeps the page, the email and this
   * function describing one dispute the same way.
   */
  const holdsForDeadline = ruleMode === "auto" && decision.action === "hold_for_deadline";
  const holdsOnStrength =
    holdsForDeadline && decision.reasonCodes.includes("strength_insufficient");
  const parksAsModerate = holdsForDeadline && !holdsOnStrength;
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
    const reason = MODERATE_PARK_MESSAGE;
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
  /*
   * The strength floor. Revision 2: this is a HOLD, not a block — the case
   * waits for the clock and the deadline cron files it. What the branch does
   * is unchanged, because everything it does was already true of a hold: it is
   * the AUTO-FILE path declining to file early, it stamps the strength-specific
   * rebuild outcome, and it sends the `held` email rather than the `review` one.
   */
  if (holdsOnStrength) {
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
    const reason = strengthBlockMessage(strengthOverall);
    await sb.from("audit_events").insert({
      shop_id: pack.shop_id,
      dispute_id: pack.dispute_id,
      pack_id: packId,
      actor_type: "system",
      event_type: "auto_save_blocked",
      event_payload: {
        reasons: [reason],
        case_strength: strengthOverall,
        decision_reason_codes: decision.reasonCodes,
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

  /* auto → the decision already ran the quality gate. There is no second
   * ladder here any more: `evaluateAutoSaveGate` was a separate,
   * differently-calibrated pass over completeness and readiness, and its
   * `?? undefined` readiness fallback (R1) silently dropped the whole gate onto
   * the legacy blocker-count path whenever the column was absent. The decision
   * resolves an absent readiness to `blocked` instead, so an absent signal
   * fails closed rather than switching engines.
   *
   * The pair quoted in the block message is `effectiveCompleteness` — the SAME
   * object the decision was handed (see the `completeness:` argument above), not
   * a second reader of the same columns. A message that quotes a differently
   * resolved number than the gate that produced it is how "blocked at 0%" gets
   * reported for a pack the gate scored otherwise, and under P-7 it is also how
   * a merchant is told they missed a threshold that was never applied to them. */
  const gateReasons: string[] =
    decision.action === "auto_file"
      ? []
      : [gateBlockMessage(decision.reasonCodes[0], effectiveCompleteness)];

  if (decision.action === "auto_file") {
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
    /* CANONICAL ROUTE. `preflightLatestCandidate` is a raw latest-row query
     * with its own opinion of fileability, and it cannot see whether the
     * package is CURRENT — the whole reason the selector exists. With the
     * switch on, this branch asks `selectFileablePackage` through the shared
     * executor helper instead, so the pipeline, the promotion helper, the save
     * worker and the deadline cron all judge a candidate the same way.
     *
     * The DISPOSITIONS below are unchanged and deliberately still this
     * function's own: a merchant-actionable refusal parks, an absent package
     * or a transient failure defers. Those differ per executor and collapsing
     * them into the helper would be a fifth opinion about one verdict. */
    if (canonicalPipelineEnabled()) {
      const canonicalOutcome = await selectForNormalExecutor({
        sb,
        caseId: pack.dispute_id as string,
        pack: {
          id: packId,
          dispute_id: (pack.dispute_id as string | null) ?? null,
          completeness_score: pack.completeness_score ?? null,
          blockers: pack.blockers,
          submission_readiness: pack.submission_readiness,
          pack_json: pack.pack_json,
          checklist_v2: (pack as { checklist_v2?: unknown }).checklist_v2 ?? null,
        },
        settings,
        automationMode: ruleMode,
        evidenceDueAt,
        disputeReason,
        networkReasonCode,
      });
      const sel = canonicalOutcome.selection;
      if (sel.outcome !== "selected") {
        await logAuditEvent({
          shopId: pack.shop_id,
          disputeId: pack.dispute_id,
          packId,
          actorType: "system",
          eventType: canonicalOutcome.unsafeContent
            ? "defence_package_blocked_unsafe_claim"
            : "defence_package_failed",
          eventPayload: {
            packageId: canonicalOutcome.judged?.packageId ?? null,
            version: canonicalOutcome.judged?.version ?? null,
            selectionOutcome: sel.outcome,
            selectionReason: sel.outcome === "none" ? sel.reason : "ambiguous",
            decisionAction: canonicalOutcome.decision.action,
            decisionReasonCodes: canonicalOutcome.decision.reasonCodes,
            trigger: "auto_save",
          },
        });
        if (selectionIsPending(sel)) {
          return { action: "defer_no_package", details: "no_defence_package_yet" };
        }
        if (!selectionIsMerchantActionable(sel)) {
          // `deadline_only_not_yet_due` and `ambiguous` land here. Neither is
          // a merchant task: the first is the normal trigger correctly leaving
          // the case to the deadline trigger, the second is an alerting error.
          return {
            action: "defer_no_package",
            details:
              sel.outcome === "ambiguous"
                ? "ambiguous_package_selection"
                : `not_fileable_now: ${sel.reason}`,
          };
        }
        await markPackageReviewRequired(sb, {
          disputeId: pack.dispute_id as string,
          packageId: canonicalOutcome.judged?.packageId ?? null,
          reasons: [sel.outcome === "none" ? sel.reason : "ambiguous"],
        });
        return {
          action: "park_for_review",
          details: `defence_package_not_fileable: ${
            sel.outcome === "none" ? sel.reason : "ambiguous"
          }`,
        };
      }
    }

    /* LEGACY PREFLIGHT — unreachable when the switch is on.
     *
     * The canonical branch above has already either returned or established
     * that a current, validated, safe package is selected, so running this as
     * well would be a second gate re-judging the row the selector just
     * approved. It stays intact, and only intact, for the dark period; PR 3
     * deletes it with the rest of the legacy paths. */
    const preflight = canonicalPipelineEnabled()
      ? null
      : await preflightLatestCandidate(sb, pack.dispute_id as string);
    if (preflight && preflightBlocks(preflight)) {
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
        decision_action: decision.action,
        decision_reason_codes: decision.reasonCodes,
        decision_input_hash: decision.freshness.inputHash,
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

  // The rule said auto but the decision refused on quality (completeness /
  // readiness). Pack stays "ready" so the merchant can fill the gap and retry.
  await sb.from("audit_events").insert({
    shop_id: pack.shop_id,
    dispute_id: pack.dispute_id,
    pack_id: packId,
    actor_type: "system",
    event_type: "auto_save_blocked",
    event_payload: {
      reasons: gateReasons,
      decision_reason_codes: decision.reasonCodes,
      decision_input_hash: decision.freshness.inputHash,
      /* The pair the gate ACTUALLY compared, and which scale it came from.
       * A score in an audit row that does not say which scale produced it
       * cannot be checked afterwards — and during the P-7 rollout the two
       * scales disagree by −7…+17 on the same pack. */
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
      description: gateReasons.join("; "),
      metadataJson: {
        pack_id: packId,
        reasons: gateReasons,
        // Same pair as the audit row. The dispute timeline and the audit trail
        // must agree about which numbers decided, or reconciling them later
        // means guessing which scale each was on.
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
    details: gateReasons.join("; "),
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
