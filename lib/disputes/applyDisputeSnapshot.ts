/**
 * applyDisputeSnapshot — shared diff engine for both the webhook (Layer A
 * fresh delivery) and cron (hourly reconciliation) paths.
 *
 * Resolves the local dispute row by (shop_id, dispute_gid), applies the
 * monotonic guards, upserts the disputes row, writes inline side-effect
 * columns (closed_at, submission_state, submitted_at) and emits per-change
 * `dispute_events` ledger entries.
 *
 * Returns a `DisputeTransitionEvent[]` describing the changes; the
 * dispatcher (Phase 5) consumes those events to fire downstream effects
 * (pipeline run, emails, audit rows) under its own idempotency layer.
 *
 * Monotonic guards:
 *   - Stale snapshot: snapshot.shopifyUpdatedAt older than existing → reject.
 *   - evidence_sent_on walk-back: timestamp → null → preserved, warning emitted.
 *   - Terminal-state downgrade: final_outcome set + snapshot pre-terminal →
 *     preserved, warning emitted.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase/server";
import { emitDisputeEvent } from "@/lib/disputeEvents/emitEvent";
import { updateNormalizedStatus } from "@/lib/disputeEvents/updateNormalizedStatus";
import {
  DISPUTE_OPENED,
  STATUS_CHANGED,
  DUE_DATE_CHANGED,
  OUTCOME_DETECTED,
  DISPUTE_CLOSED,
  SUBMISSION_CONFIRMED,
} from "@/lib/disputeEvents/eventTypes";
import type { DisputeSnapshot } from "./disputeSnapshot";

const TERMINAL_STATUSES = new Set([
  "won",
  "lost",
  "charge_refunded",
  "accepted",
]);

const OUTCOME_MAP: Record<string, string> = {
  won: "won",
  lost: "lost",
  charge_refunded: "refunded",
  accepted: "accepted",
};

export type DisputeTransitionEventType =
  | "DISPUTE_OPENED"
  | "STATUS_CHANGED"
  | "DUE_DATE_CHANGED"
  | "SUBMISSION_CONFIRMED"
  | "OUTCOME_DETECTED"
  | "DISPUTE_CLOSED";

export interface DisputeTransitionEvent {
  type: DisputeTransitionEventType;
  disputeId: string;
  shopId: string;
  eventAt: string;
  /** Stable string used for Layer B effect idempotency in audit_events. */
  eventKey: string;
  /** Convenience: status when the event implies one. */
  oldStatus?: string | null;
  newStatus?: string | null;
  /** Snapshot fields the dispatcher needs to fire downstream effects. */
  context: {
    reason: string | null;
    phase: string | null;
    amount: number | null;
    currency: string | null;
    dueAt: string | null;
    orderGid: string | null;
    disputeEvidenceGid: string | null;
    finalOutcome?: string | null;
  };
}

export type ApplyOutcome =
  | "applied"
  | "skipped_unchanged"
  | "skipped_stale"
  | "skipped_monotonic_guard"
  | "skipped_unknown_shop"
  | "error";

export interface ApplyDisputeSnapshotArgs {
  shopId: string;
  source: "webhook" | "cron";
  snapshot: DisputeSnapshot;
  /**
   * Optional GraphQL resolver for missing fields. The webhook path passes one
   * that calls `dispute(id:)`. The cron path can omit it because the list
   * query already populates disputeEvidence.id.
   */
  fetchDisputeDetail?: (
    disputeGid: string,
  ) => Promise<Partial<DisputeSnapshot> | null>;
  client?: SupabaseClient;
}

export interface ApplyDisputeSnapshotResult {
  outcome: ApplyOutcome;
  localDisputeId: string | null;
  events: DisputeTransitionEvent[];
  guardWarnings: string[];
  /** True when a fresh row was inserted, false on update or skip. */
  created: boolean;
}

export async function applyDisputeSnapshot(
  args: ApplyDisputeSnapshotArgs,
): Promise<ApplyDisputeSnapshotResult> {
  const sb = args.client ?? getServiceClient();
  const { shopId, snapshot, source } = args;
  const nowIso = new Date().toISOString();
  const events: DisputeTransitionEvent[] = [];
  const guardWarnings: string[] = [];

  // Sanity: caller MUST have already resolved an actual shop.
  if (!shopId) {
    return {
      outcome: "skipped_unknown_shop",
      localDisputeId: null,
      events: [],
      guardWarnings: [],
      created: false,
    };
  }

  interface ExistingRow {
    id: string;
    status: string | null;
    due_at: string | null;
    submitted_at: string | null;
    final_outcome: string | null;
    submission_state: string | null;
    new_dispute_alert_sent_at: string | null;
    shopify_updated_at: string | null;
    dispute_evidence_gid: string | null;
  }

  const existingQuery = await sb
    .from("disputes")
    .select(
      "id, status, due_at, submitted_at, final_outcome, submission_state, " +
        "new_dispute_alert_sent_at, shopify_updated_at, dispute_evidence_gid",
    )
    .eq("shop_id", shopId)
    .eq("dispute_gid", snapshot.disputeGid)
    .maybeSingle();
  const existing = existingQuery.data as ExistingRow | null;
  const existingErr = existingQuery.error as { message: string } | null;

  if (existingErr) {
    return {
      outcome: "error",
      localDisputeId: null,
      events: [],
      guardWarnings: [
        `existence check failed: ${existingErr.message}`,
      ],
      created: false,
    };
  }

  // Monotonic guard: stale snapshot.
  if (
    existing?.shopify_updated_at &&
    snapshot.shopifyUpdatedAt &&
    new Date(snapshot.shopifyUpdatedAt).getTime() <
      new Date(existing.shopify_updated_at).getTime()
  ) {
    return {
      outcome: "skipped_stale",
      localDisputeId: existing.id ?? null,
      events: [],
      guardWarnings: [
        `stale snapshot: ${snapshot.shopifyUpdatedAt} < ${existing.shopify_updated_at}`,
      ],
      created: false,
    };
  }

  // Monotonic guards: evidence_sent_on walk-back + terminal downgrade.
  // These are LOG-AND-PRESERVE: keep the existing value, continue with the
  // rest of the diff. The PR description's reasoning is that monotonic
  // protection should not block legitimate forward progress on other fields.
  const newEvidenceSentOn =
    existing?.submitted_at && !snapshot.evidenceSentOn
      ? existing.submitted_at // preserve
      : snapshot.evidenceSentOn ?? existing?.submitted_at ?? null;

  if (existing?.submitted_at && !snapshot.evidenceSentOn) {
    guardWarnings.push(
      `evidence_sent_on walk-back rejected (existing=${existing.submitted_at}, snapshot=null)`,
    );
  }

  const snapshotIsTerminal = snapshot.status
    ? TERMINAL_STATUSES.has(snapshot.status)
    : false;
  if (
    existing?.final_outcome &&
    snapshot.status &&
    !snapshotIsTerminal
  ) {
    guardWarnings.push(
      `terminal-state downgrade rejected (final_outcome=${existing.final_outcome}, snapshot status=${snapshot.status})`,
    );
  }

  // For new disputes, optionally resolve missing display + identity fields
  // via a targeted GraphQL fallback. The REST webhook payload carries the
  // dispute fields but NOT order.name, customer details, or the
  // ShopifyPaymentsDisputeEvidence sub-object GID.
  let disputeEvidenceGid = snapshot.disputeEvidenceGid;
  let orderName = snapshot.orderName ?? null;
  let orderGid = snapshot.orderGid ?? null;
  if (!existing && args.fetchDisputeDetail) {
    try {
      const fallback = await args.fetchDisputeDetail(snapshot.disputeGid);
      if (fallback) {
        if (!disputeEvidenceGid && fallback.disputeEvidenceGid) {
          disputeEvidenceGid = fallback.disputeEvidenceGid;
        }
        if (!orderName && fallback.orderName) {
          orderName = fallback.orderName;
        }
        if (!orderGid && fallback.orderGid) {
          orderGid = fallback.orderGid;
        }
      }
    } catch (err) {
      guardWarnings.push(
        `fetchDisputeDetail failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const amountNumber =
    snapshot.amount != null && snapshot.amount !== ""
      ? Number(snapshot.amount)
      : null;
  const amount = Number.isFinite(amountNumber) ? (amountNumber as number) : null;
  const newStatus = snapshot.status ?? null;
  const phase = snapshot.type ?? null;

  // Compute the upsert row. dispute_evidence_gid, order_gid, and order_name
  // are all CONDITIONAL — they come from the GraphQL backfill (or a prior
  // backfill on an existing row), NOT from the REST webhook payload. Writing
  // them as null on the update path would clobber a correct value the create
  // path wrote 500ms earlier when Shopify ships disputes/create + disputes/
  // update back-to-back (the 2026-05-20 #1081 incident: create populated
  // order_gid via fetchDisputeDetail, update arrived right after, !existing
  // was false so the backfill was skipped, the unconditional upsert wrote
  // `order_gid: null` and overwrote the create's value).
  const upsertRow: Record<string, unknown> = {
    shop_id: shopId,
    dispute_gid: snapshot.disputeGid,
    phase,
    status: newStatus,
    reason: snapshot.reason ?? null,
    amount,
    currency_code: snapshot.currency ?? null,
    initiated_at: snapshot.initiatedAt ?? null,
    due_at: snapshot.evidenceDueBy ?? null,
    last_synced_at: nowIso,
    shopify_updated_at: snapshot.shopifyUpdatedAt ?? null,
  };
  if (disputeEvidenceGid) {
    upsertRow.dispute_evidence_gid = disputeEvidenceGid;
  }
  if (orderName) {
    upsertRow.order_name = orderName;
  }
  if (orderGid) {
    upsertRow.order_gid = orderGid;
  }

  // Guard: terminal-downgrade — don't overwrite a terminal status with a
  // pre-terminal one. We do still allow status writes when the snapshot is
  // terminal or matches.
  if (
    existing?.final_outcome &&
    snapshot.status &&
    !snapshotIsTerminal
  ) {
    delete upsertRow.status;
  }

  const { data: upserted, error: upsertErr } = await sb
    .from("disputes")
    .upsert(upsertRow, { onConflict: "shop_id,dispute_gid" })
    .select("id")
    .single();

  if (upsertErr || !upserted?.id) {
    return {
      outcome: "error",
      localDisputeId: existing?.id ?? null,
      events: [],
      guardWarnings: [
        ...guardWarnings,
        `upsert failed: ${upsertErr?.message ?? "no id returned"}`,
      ],
      created: false,
    };
  }

  const disputeId: string = upserted.id;
  const sourceTypeForEvent = source === "webhook" ? "webhook" : "shopify_sync";
  const ctxBase = {
    reason: snapshot.reason ?? null,
    phase,
    amount,
    currency: snapshot.currency ?? null,
    dueAt: snapshot.evidenceDueBy ?? null,
    orderGid: snapshot.orderGid ?? null,
    disputeEvidenceGid: disputeEvidenceGid ?? null,
  };

  if (!existing) {
    // Brand-new dispute.
    const openedAt = snapshot.initiatedAt ?? nowIso;
    void emitDisputeEvent({
      disputeId,
      shopId,
      eventType: DISPUTE_OPENED,
      description: `${snapshot.type ?? "Dispute"} opened — ${snapshot.reason ?? "unknown reason"}`,
      eventAt: openedAt,
      actorType: "shopify",
      sourceType: sourceTypeForEvent,
      metadataJson: {
        reason: snapshot.reason,
        phase,
        amount,
        currency_code: snapshot.currency,
      },
      dedupeKey: `${disputeId}:${DISPUTE_OPENED}`,
    });
    events.push({
      type: "DISPUTE_OPENED",
      disputeId,
      shopId,
      eventAt: openedAt,
      eventKey: `${disputeId}:DISPUTE_OPENED`,
      newStatus,
      context: ctxBase,
    });

    if (newStatus && TERMINAL_STATUSES.has(newStatus)) {
      const outcome = OUTCOME_MAP[newStatus];
      const at = snapshot.finalizedOn ?? nowIso;
      void emitDisputeEvent({
        disputeId,
        shopId,
        eventType: OUTCOME_DETECTED,
        eventAt: at,
        actorType: "shopify",
        sourceType: sourceTypeForEvent,
        metadataJson: { final_outcome: outcome },
        dedupeKey: `${disputeId}:${OUTCOME_DETECTED}:${outcome}`,
      });
      await sb
        .from("disputes")
        .update({ closed_at: at })
        .eq("id", disputeId);
      events.push({
        type: "OUTCOME_DETECTED",
        disputeId,
        shopId,
        eventAt: at,
        eventKey: `${disputeId}:OUTCOME_DETECTED:${outcome}`,
        newStatus,
        context: { ...ctxBase, finalOutcome: outcome },
      });
    }

    if (snapshot.evidenceSentOn) {
      await sb
        .from("disputes")
        .update({
          submission_state: "submitted_confirmed",
          submitted_at: snapshot.evidenceSentOn,
        })
        .eq("id", disputeId);
      void emitDisputeEvent({
        disputeId,
        shopId,
        eventType: SUBMISSION_CONFIRMED,
        eventAt: snapshot.evidenceSentOn,
        actorType: "shopify",
        sourceType: sourceTypeForEvent,
        dedupeKey: `${disputeId}:${SUBMISSION_CONFIRMED}:${snapshot.evidenceSentOn}`,
      });
      events.push({
        type: "SUBMISSION_CONFIRMED",
        disputeId,
        shopId,
        eventAt: snapshot.evidenceSentOn,
        eventKey: `${disputeId}:SUBMISSION_CONFIRMED:${snapshot.evidenceSentOn}`,
        context: ctxBase,
      });
    }

    void updateNormalizedStatus(disputeId);

    return {
      outcome: "applied",
      localDisputeId: disputeId,
      events,
      guardWarnings,
      created: true,
    };
  }

  // Existing dispute — diff against the previous row.
  let anyChange = false;

  if (existing.status !== newStatus && newStatus) {
    anyChange = true;
    void emitDisputeEvent({
      disputeId,
      shopId,
      eventType: STATUS_CHANGED,
      description: `${existing.status ?? "unknown"} → ${newStatus}`,
      eventAt: nowIso,
      actorType: "shopify",
      sourceType: sourceTypeForEvent,
      metadataJson: {
        old_status: existing.status,
        new_status: newStatus,
      },
      dedupeKey: `${disputeId}:${STATUS_CHANGED}:${existing.status}_${newStatus}`,
    });
    events.push({
      type: "STATUS_CHANGED",
      disputeId,
      shopId,
      eventAt: nowIso,
      eventKey: `${disputeId}:STATUS_CHANGED:${existing.status}_${newStatus}`,
      oldStatus: existing.status ?? null,
      newStatus,
      context: ctxBase,
    });

    if (TERMINAL_STATUSES.has(newStatus) && !existing.final_outcome) {
      const outcome = OUTCOME_MAP[newStatus];
      const at = snapshot.finalizedOn ?? nowIso;
      void emitDisputeEvent({
        disputeId,
        shopId,
        eventType: OUTCOME_DETECTED,
        description: `Outcome: ${outcome ?? newStatus}`,
        eventAt: at,
        actorType: "shopify",
        sourceType: sourceTypeForEvent,
        metadataJson: {
          final_outcome: outcome,
          amount,
          currency_code: snapshot.currency,
        },
        dedupeKey: `${disputeId}:${OUTCOME_DETECTED}:${outcome}`,
      });
      void emitDisputeEvent({
        disputeId,
        shopId,
        eventType: DISPUTE_CLOSED,
        eventAt: at,
        actorType: "shopify",
        sourceType: sourceTypeForEvent,
        dedupeKey: `${disputeId}:${DISPUTE_CLOSED}`,
      });
      await sb
        .from("disputes")
        .update({ closed_at: at })
        .eq("id", disputeId);
      events.push({
        type: "OUTCOME_DETECTED",
        disputeId,
        shopId,
        eventAt: at,
        eventKey: `${disputeId}:OUTCOME_DETECTED:${outcome}`,
        newStatus,
        context: { ...ctxBase, finalOutcome: outcome },
      });
      events.push({
        type: "DISPUTE_CLOSED",
        disputeId,
        shopId,
        eventAt: at,
        eventKey: `${disputeId}:DISPUTE_CLOSED`,
        newStatus,
        context: { ...ctxBase, finalOutcome: outcome },
      });
    }
  }

  // Due date change — compare by epoch ms to tolerate timezone-only changes.
  if (snapshot.evidenceDueBy) {
    const oldMs = existing.due_at ? new Date(existing.due_at).getTime() : null;
    const newMs = new Date(snapshot.evidenceDueBy).getTime();
    const changed = Number.isFinite(newMs) && oldMs !== newMs;
    if (changed) {
      anyChange = true;
      void emitDisputeEvent({
        disputeId,
        shopId,
        eventType: DUE_DATE_CHANGED,
        description: `Due date changed to ${new Date(newMs).toISOString()}`,
        eventAt: nowIso,
        actorType: "shopify",
        sourceType: sourceTypeForEvent,
        metadataJson: {
          old_due_at: existing.due_at,
          new_due_at: snapshot.evidenceDueBy,
        },
        dedupeKey: `${disputeId}:${DUE_DATE_CHANGED}:${newMs}`,
      });
      events.push({
        type: "DUE_DATE_CHANGED",
        disputeId,
        shopId,
        eventAt: nowIso,
        eventKey: `${disputeId}:DUE_DATE_CHANGED:${newMs}`,
        context: ctxBase,
      });
    }
  }

  // Submission confirmation — evidence_sent_on transition null → timestamp.
  if (
    snapshot.evidenceSentOn &&
    existing.submission_state !== "submitted_confirmed" &&
    !existing.submitted_at
  ) {
    anyChange = true;
    await sb
      .from("disputes")
      .update({
        submission_state: "submitted_confirmed",
        submitted_at: snapshot.evidenceSentOn,
      })
      .eq("id", disputeId);
    void emitDisputeEvent({
      disputeId,
      shopId,
      eventType: SUBMISSION_CONFIRMED,
      description: "Representment submission confirmed by Shopify",
      eventAt: snapshot.evidenceSentOn,
      actorType: "shopify",
      sourceType: sourceTypeForEvent,
      dedupeKey: `${disputeId}:${SUBMISSION_CONFIRMED}:${snapshot.evidenceSentOn}`,
    });
    events.push({
      type: "SUBMISSION_CONFIRMED",
      disputeId,
      shopId,
      eventAt: snapshot.evidenceSentOn,
      eventKey: `${disputeId}:SUBMISSION_CONFIRMED:${snapshot.evidenceSentOn}`,
      context: ctxBase,
    });
  }

  void updateNormalizedStatus(disputeId);

  // Silence unused-var warnings when no changes fired but we still upserted
  // (e.g. last_synced_at refresh).
  void newEvidenceSentOn;

  return {
    outcome: anyChange ? "applied" : "skipped_unchanged",
    localDisputeId: disputeId,
    events,
    guardWarnings,
    created: false,
  };
}
