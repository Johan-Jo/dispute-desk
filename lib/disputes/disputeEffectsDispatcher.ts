/**
 * dispatchDisputeEffects — shared downstream-effects dispatcher.
 *
 * Consumes the events array produced by `applyDisputeSnapshot` and fires
 * downstream effects (pipeline run, emails) at-most-once via the Layer B
 * effect-idempotency primitive (`withEffectDedup`).
 *
 * Both the webhook (direct processing) and cron (hourly reconciliation)
 * paths call this. Whichever observer claims the audit_events row first
 * runs the effect; the second observer's claim collides on the unique
 * index and short-circuits.
 *
 * Effects per event type:
 *   - DISPUTE_OPENED: evaluateRules → runAutomationPipeline → maybe send
 *     new-dispute alert (review variant). The pipeline's own path sends the
 *     deferred alert when a build is enqueued.
 *   - SUBMISSION_CONFIRMED: claim & send the deferred new-dispute alert
 *     ("auto" variant — we successfully submitted on your behalf).
 *   - OUTCOME_DETECTED: send outcome-posted email (won / lost / accepted
 *     variant). Triggered the moment Shopify's `finalized_on` flips
 *     null → timestamp. Effect-level dedup ensures the email fires
 *     exactly once even if cron + webhook both observe the transition.
 *   - STATUS_CHANGED, DUE_DATE_CHANGED, DISPUTE_CLOSED: no per-event
 *     effects today; the dispute_events ledger entry is already
 *     written by the diff engine. (DISPUTE_CLOSED always fires
 *     alongside OUTCOME_DETECTED, so the email is keyed off the
 *     latter to avoid double-firing.)
 *
 * Errors in one effect MUST NOT block the rest. We catch + log per effect.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase/server";
import { runAutomationPipeline } from "@/lib/automation/pipeline";
import { evaluateRules } from "@/lib/rules/evaluateRules";
import { normalizeMode, type AutomationMode } from "@/lib/rules/normalizeMode";
import {
  sendNewDisputeAlert,
  claimAndSendDeferredNewDisputeAlert,
} from "@/lib/email/sendNewDisputeAlert";
import {
  sendOutcomePostedAlert,
  type OutcomeVariant,
} from "@/lib/email/sendOutcomePostedAlert";
import { enqueueGorgiasEnrichment } from "@/lib/integrations/gorgias/enqueueEnrichment";
import { withEffectDedup } from "./dispatchOnce";
import { keyForEffect } from "./disputeEventKey";
import type {
  ApplyDisputeSnapshotResult,
  DisputeTransitionEvent,
} from "./applyDisputeSnapshot";

export interface DispatchArgs {
  shopId: string;
  result: ApplyDisputeSnapshotResult;
  source: "webhook" | "cron";
  /** Stable correlation id for log triage across the webhook + dispatch + pipeline span. */
  correlationId?: string;
  client?: SupabaseClient;
  /**
   * Test seam: skip the actual automation pipeline. Defaults to false in
   * production. Used by syncDisputes when the caller already ran the
   * pipeline (legacy path during incremental migration).
   */
  skipAutomation?: boolean;
}

export interface DispatchSummary {
  effectsAttempted: number;
  effectsRan: number;
  effectsSkipped: number;
  errors: string[];
}

export async function dispatchDisputeEffects(
  args: DispatchArgs,
): Promise<DispatchSummary> {
  const summary: DispatchSummary = {
    effectsAttempted: 0,
    effectsRan: 0,
    effectsSkipped: 0,
    errors: [],
  };

  // Only "applied" results have downstream effects to fire.
  if (args.result.outcome !== "applied") return summary;

  for (const event of args.result.events) {
    try {
      await dispatchEvent(args, event, summary);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.errors.push(`${event.type}: ${msg}`);
      console.error(
        "[disputeEffectsDispatcher] effect threw",
        { eventType: event.type, disputeId: event.disputeId, error: msg },
      );
    }
  }

  return summary;
}

async function dispatchEvent(
  args: DispatchArgs,
  event: DisputeTransitionEvent,
  summary: DispatchSummary,
): Promise<void> {
  switch (event.type) {
    case "DISPUTE_OPENED":
      await dispatchDisputeOpened(args, event, summary);
      return;
    case "SUBMISSION_CONFIRMED":
      await dispatchSubmissionConfirmed(args, event, summary);
      return;
    case "OUTCOME_DETECTED":
      await dispatchOutcomeDetected(args, event, summary);
      return;
    case "STATUS_CHANGED":
    case "DUE_DATE_CHANGED":
    case "DISPUTE_CLOSED":
      // No per-event downstream effect today. The dispute_events ledger
      // entry is already written by the diff engine. Skip silently.
      // DISPUTE_CLOSED always fires alongside OUTCOME_DETECTED — the
      // email handler is keyed off the latter so we don't double-fire.
      return;
  }
}

async function dispatchDisputeOpened(
  args: DispatchArgs,
  event: DisputeTransitionEvent,
  summary: DispatchSummary,
): Promise<void> {
  summary.effectsAttempted++;

  const effectName = "evaluate_and_run_pipeline";
  const eventKey = keyForEffect(event, effectName);

  const dedup = await withEffectDedup({
    shopId: args.shopId,
    disputeId: event.disputeId,
    eventKey,
    effectName,
    context: {
      source: args.source,
      correlation_id: args.correlationId ?? null,
      reason: event.context.reason,
      phase: event.context.phase,
      amount: event.context.amount,
      skip_automation: Boolean(args.skipAutomation),
    },
    client: args.client,
    effect: async () => {
      const phase = event.context.phase;
      const phaseForRules =
        phase === "inquiry" || phase === "chargeback" ? phase : null;

      // Historical import: a first sync discovered a dispute Shopify had
      // already resolved (or already evidence-submitted) days/months ago.
      // There is nothing live to act on — running the automation pipeline on
      // a terminal dispute is wasted work and could wrongly park it for
      // review. Burn the `new_dispute_alert_sent_at` claim (so any code path
      // that would otherwise send the "ready for review" alert no-ops) and
      // return without emailing. The dispute row + dispute_events ledger are
      // already written by applyDisputeSnapshot.
      if (event.historicalImport) {
        await claimNewDisputeAlertColumn(args, event);
        return;
      }

      // First-sync backfill of an OPEN, un-submitted dispute: we DO want the
      // evidence pack built (nothing has been submitted to Shopify yet, so the
      // merchant needs a pack ready), but we must NOT send the per-dispute
      // "ready for review" email — one per historical dispute is the install
      // flood. Burn the alert claim FIRST so the pipeline's own deferred email
      // (fired on pack-build completion via claimAndSendDeferredNewDisputeAlert,
      // which checks new_dispute_alert_sent_at) self-suppresses. Then fall
      // through to run the pipeline exactly as normal.
      if (event.suppressEmail) {
        await claimNewDisputeAlertColumn(args, event);
      }

      // Evaluate the rule even when skipAutomation is true — the result
      // controls UI mode display, but we don't fire the pipeline.
      let resolvedMode: AutomationMode = "review";
      let evalResult: Awaited<ReturnType<typeof evaluateRules>> | null = null;
      try {
        evalResult = await evaluateRules({
          id: event.disputeId,
          shop_id: args.shopId,
          reason: event.context.reason,
          status: event.newStatus ?? null,
          amount: event.context.amount,
          phase: phaseForRules,
        });
        resolvedMode = normalizeMode(evalResult.action.mode);
      } catch (err) {
        summary.errors.push(
          `rules(${event.disputeId}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      let pipelineResult: Awaited<ReturnType<typeof runAutomationPipeline>> | null =
        null;
      if (!args.skipAutomation && evalResult) {
        try {
          if (resolvedMode === "review") {
            const sb = args.client ?? getServiceClient();
            await sb
              .from("disputes")
              .update({
                needs_review: true,
                updated_at: new Date().toISOString(),
              })
              .eq("id", event.disputeId);
          }

          pipelineResult = await runAutomationPipeline({
            id: event.disputeId,
            shop_id: args.shopId,
            reason: event.context.reason,
            phase: phaseForRules,
            pack_template_id:
              evalResult.packTemplateId ??
              evalResult.action.pack_template_id ??
              null,
          });
        } catch (err) {
          summary.errors.push(
            `automation(${event.disputeId}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // Gorgias enrichment: fire-and-forget background job that finds the
      // customer's support conversations for merchant review. Runs inside
      // this deduped effect (webhook+cron double-observation can't double-
      // enqueue) and must NEVER block alerts or the pipeline.
      try {
        await enqueueGorgiasEnrichment({
          shopId: args.shopId,
          disputeId: event.disputeId,
          trigger: "dispute_opened",
        });
      } catch (err) {
        summary.errors.push(
          `gorgias_enrich(${event.disputeId}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // Defer the new-dispute email when a build was enqueued — the pipeline
      // sends the alert (review or auto variant) once the build completes.
      // For a suppressed backfill dispute the claim was already burned above,
      // so both this immediate send and the pipeline's deferred send no-op.
      const deferNewDisputeEmail = pipelineResult?.action === "pack_enqueued";
      if (!deferNewDisputeEmail && !event.suppressEmail) {
        await sendOpenedAlertReviewVariant(args, event);
      }
    },
  });

  if (dedup.ran) summary.effectsRan++;
  else summary.effectsSkipped++;
}

/**
 * Atomic claim of `disputes.new_dispute_alert_sent_at` so the alert fires
 * exactly once even if the dispatcher itself is re-entered. The audit_events
 * unique constraint is the primary at-most-once gate; this column is a
 * belt-and-suspenders guard that predates the new layer.
 */
async function sendOpenedAlertReviewVariant(
  args: DispatchArgs,
  event: DisputeTransitionEvent,
): Promise<void> {
  const claimed = await claimNewDisputeAlertColumn(args, event);
  if (!claimed) return;

  const orderName = claimed.orderName;
  void sendNewDisputeAlert({
    shopId: args.shopId,
    disputeId: event.disputeId,
    reason: event.context.reason,
    phase: event.context.phase,
    amount: event.context.amount,
    currencyCode: event.context.currency,
    dueAt: event.context.dueAt,
    orderName,
    resolvedMode: "review",
    shopifyDisputeEvidenceGid: event.context.disputeEvidenceGid,
  });
}

/**
 * Atomically claim `disputes.new_dispute_alert_sent_at` (null → now). Returns
 * the claimed row's order_name when THIS caller won the claim, or null when
 * the column was already set (someone else claimed, or a historical-import
 * pre-claim). Used both to send the review-variant alert exactly once and to
 * silently burn the claim for historical imports so no downstream deferred
 * alert can fire.
 */
async function claimNewDisputeAlertColumn(
  args: DispatchArgs,
  event: DisputeTransitionEvent,
): Promise<{ orderName: string | null } | null> {
  const sb = args.client ?? getServiceClient();
  const { data: claimed } = await sb
    .from("disputes")
    .update({ new_dispute_alert_sent_at: new Date().toISOString() })
    .eq("id", event.disputeId)
    .is("new_dispute_alert_sent_at", null)
    .select("id, order_name");
  if (!claimed || claimed.length === 0) return null;
  return {
    orderName:
      (claimed[0] as { order_name?: string | null })?.order_name ?? null,
  };
}

async function dispatchSubmissionConfirmed(
  args: DispatchArgs,
  event: DisputeTransitionEvent,
  summary: DispatchSummary,
): Promise<void> {
  summary.effectsAttempted++;
  // Historical import / first-sync backfill: evidence was submitted before we
  // ever saw the dispute (or we're backfilling the shop's existing backlog).
  // Nothing to notify the merchant about — skip the email.
  if (event.historicalImport || event.suppressEmail) {
    summary.effectsSkipped++;
    return;
  }
  const effectName = "submission_confirmed_alert";
  const eventKey = keyForEffect(event, effectName);

  const dedup = await withEffectDedup({
    shopId: args.shopId,
    disputeId: event.disputeId,
    eventKey,
    effectName,
    context: {
      source: args.source,
      correlation_id: args.correlationId ?? null,
      evidence_sent_on: event.eventAt,
    },
    client: args.client,
    effect: async () => {
      // The auto variant only makes sense when DisputeDesk's automation
      // submitted the response. claimAndSendDeferredNewDisputeAlert itself
      // checks `new_dispute_alert_sent_at` so re-entry is safe; we still
      // wrap it for observability.
      await claimAndSendDeferredNewDisputeAlert(event.disputeId, "auto");
    },
  });

  if (dedup.ran) summary.effectsRan++;
  else summary.effectsSkipped++;
}

/** Maps the raw `final_outcome` string from `disputes` (won / lost /
 *  refunded / accepted) to the email variant. Unknown values collapse
 *  to "accepted" — the neutral "closed without contest" variant — so
 *  the merchant still gets a notification even if Shopify ships a new
 *  outcome string we don't recognise. */
function outcomeVariantFor(finalOutcome: string | null | undefined): OutcomeVariant {
  if (finalOutcome === "won") return "won";
  if (finalOutcome === "lost") return "lost";
  // "refunded" / "accepted" / any future terminal value → accepted.
  return "accepted";
}

async function dispatchOutcomeDetected(
  args: DispatchArgs,
  event: DisputeTransitionEvent,
  summary: DispatchSummary,
): Promise<void> {
  summary.effectsAttempted++;
  // Historical import / first-sync backfill: the dispute resolved before we
  // ever saw it (or we're backfilling the shop's existing backlog). Discovering
  // a years-old won/lost dispute on a first sync must NOT email the merchant
  // "you won / this chargeback was lost" — that's the flood this gate stops.
  if (event.historicalImport || event.suppressEmail) {
    summary.effectsSkipped++;
    return;
  }
  const effectName = "outcome_posted_alert";
  const eventKey = keyForEffect(event, effectName);
  const variant = outcomeVariantFor(event.context.finalOutcome);

  const dedup = await withEffectDedup({
    shopId: args.shopId,
    disputeId: event.disputeId,
    eventKey,
    effectName,
    context: {
      source: args.source,
      correlation_id: args.correlationId ?? null,
      final_outcome: event.context.finalOutcome ?? null,
      variant,
    },
    client: args.client,
    effect: async () => {
      const sb = args.client ?? getServiceClient();
      // Look up order_name for a more useful subject line. The event
      // context doesn't carry it, but the row does.
      const { data: row } = await sb
        .from("disputes")
        .select("order_name")
        .eq("id", event.disputeId)
        .maybeSingle();
      const orderName =
        (row as { order_name?: string | null } | null)?.order_name ?? null;
      await sendOutcomePostedAlert({
        shopId: args.shopId,
        disputeId: event.disputeId,
        outcome: variant,
        reason: event.context.reason,
        amount: event.context.amount,
        currencyCode: event.context.currency,
        orderName,
        // Inquiries must not be announced as chargebacks — the email
        // helper switches to "dispute"-worded copy for this phase.
        phase: event.context.phase === "inquiry" ? "inquiry" : "chargeback",
      });
    },
  });

  if (dedup.ran) summary.effectsRan++;
  else summary.effectsSkipped++;
}
