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
 *   - STATUS_CHANGED, OUTCOME_DETECTED, DUE_DATE_CHANGED, DISPUTE_CLOSED:
 *     no per-event effects today; the dispute_events ledger entry is
 *     already written by the diff engine. We still pass them through
 *     `withEffectDedup` so they show up in audit_events for observability.
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
    case "STATUS_CHANGED":
    case "OUTCOME_DETECTED":
    case "DUE_DATE_CHANGED":
    case "DISPUTE_CLOSED":
      // No per-event downstream effect today. The dispute_events ledger
      // entry is already written by the diff engine. Skip silently.
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

      // Defer the new-dispute email when a build was enqueued — the pipeline
      // sends the alert (review or auto variant) once the build completes.
      const deferNewDisputeEmail = pipelineResult?.action === "pack_enqueued";
      if (!deferNewDisputeEmail) {
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
  const sb = args.client ?? getServiceClient();
  const { data: claimed } = await sb
    .from("disputes")
    .update({ new_dispute_alert_sent_at: new Date().toISOString() })
    .eq("id", event.disputeId)
    .is("new_dispute_alert_sent_at", null)
    .select("id, order_name");
  if (!claimed || claimed.length === 0) return;

  const orderName = (claimed[0] as { order_name?: string | null })?.order_name ?? null;
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

async function dispatchSubmissionConfirmed(
  args: DispatchArgs,
  event: DisputeTransitionEvent,
  summary: DispatchSummary,
): Promise<void> {
  summary.effectsAttempted++;
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
