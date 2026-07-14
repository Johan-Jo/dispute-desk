/**
 * Job handler: enrich_gorgias_comms
 *
 * Per-dispute Gorgias enrichment: resolve the disputing customer, score
 * their tickets against the disputed order (lib/integrations/gorgias/
 * matchScoring.ts), and persist matched tickets + public-message
 * snapshots for merchant review. `entity_id` = dispute id.
 *
 * State machine (gorgias_enrichment_runs.status):
 *   queued → resolving_customer → searching_tickets → fetching_messages
 *   → [analyzing → ready_for_review | analysis_deferred]  (PR3 — analyzer)
 *   → completed | no_matches | failed_retryable | failed_terminal | cancelled
 *
 * Concurrency: the claim_jobs RPC's MAX_CONCURRENT_PER_SHOP = 1 serializes
 * this handler against every other job of the shop (incl. other disputes'
 * enrichments), which is what keeps the Gorgias 40 req/20s envelope safe.
 * The partial unique index on active runs prevents duplicate runs per
 * dispute; retries RESUME the active run (attempt_count++) instead of
 * creating a new one.
 *
 * Failure classes:
 *   - Gorgias 401/403  → integration needs_attention (reconnect_required),
 *                        run failed_terminal, JobResult retriable:false —
 *                        revoked credentials must never retry-loop.
 *   - anything else    → run failed_retryable + throw (worker backoff).
 *   - enrichment NEVER blocks the dispute pipeline — build_pack is a
 *     separate job and pack generation omits Gorgias evidence until the
 *     merchant approves messages (review-mode collector, PR5).
 */

import { getServiceClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaimedJob, JobResult } from "@/lib/jobs/claimJobs";
import { logSetupEvent } from "@/lib/setup/events";
import {
  createGorgiasClient,
  type GorgiasClient,
  type GorgiasTicket,
} from "@/lib/integrations/gorgias/client";
import {
  loadGorgiasConnection,
  type GorgiasConnection,
} from "@/lib/integrations/gorgias/credentials";
import type { OrderMatchSignals } from "@/lib/integrations/gorgias/matchScoring";
import {
  ACTIVE_RUN_STATUSES,
  customerIdDigits,
  planMessagePersistence,
  planTicketPersistence,
  scoreTicket,
  snapshotMessage,
  type ExistingMessageRow,
  type ExistingTicketRow,
  type MessageSnapshot,
  type ScoredTicket,
} from "@/lib/integrations/gorgias/enrichment";

/** Test seam (same pattern as GorgiasCommDeps). */
export interface EnrichGorgiasDeps {
  loadConnection?: (shopId: string) => Promise<GorgiasConnection | null>;
  createClient?: (creds: GorgiasConnection["credentials"]) => GorgiasClient;
}

interface RunRow {
  id: string;
  status: string;
  attempt_count: number;
  started_at: string;
}

export async function handleEnrichGorgiasComms(
  job: ClaimedJob,
  deps: EnrichGorgiasDeps = {},
): Promise<JobResult> {
  const disputeId = job.entityId;
  if (!disputeId) {
    return { ok: false, reason: "entity_id (dispute id) missing", retriable: false };
  }

  const loadConn = deps.loadConnection ?? loadGorgiasConnection;
  const conn = await loadConn(job.shopId);
  if (!conn) {
    // Disconnected between enqueue and claim. Cancel any queued run so the
    // active-run slot frees up, then stop without retrying.
    await cancelActiveRuns(job.shopId, disputeId, "gorgias_not_connected");
    return { ok: false, reason: "gorgias_not_connected", retriable: false };
  }

  const sb = getServiceClient();
  const run = await acquireRun(sb, job.shopId, disputeId, conn.integrationId);
  if (!run) {
    // Another worker holds the active run — nothing to do here.
    return { ok: true };
  }

  try {
    // queued → resolving_customer (event fires only on this transition,
    // so a resumed retry doesn't double-emit "started").
    const started = await transition(sb, run.id, ["queued"], "resolving_customer");
    if (started) {
      await logSetupEvent(job.shopId, "gorgias_enrichment_started", {
        disputeId,
        runId: run.id,
        attempt: run.attempt_count,
      });
    } else {
      await transition(
        sb,
        run.id,
        [...ACTIVE_RUN_STATUSES],
        "resolving_customer",
      );
    }

    const signals = await loadOrderSignals(sb, job.shopId, disputeId);
    if (!signals) {
      await finishRun(sb, run, "cancelled", { error_code: "dispute_not_found" });
      return { ok: false, reason: "dispute_not_found", retriable: false };
    }
    if (!signals.customerEmail) {
      await finishRun(sb, run, "no_matches", { error_code: "no_customer_email" });
      await logSetupEvent(job.shopId, "gorgias_enrichment_no_matches", {
        disputeId,
        runId: run.id,
        reason: "no_customer_email",
      });
      return { ok: true };
    }

    const client = (deps.createClient ?? ((c) => createGorgiasClient(c)))(
      conn.credentials,
    );

    const customer = await client.resolveCustomerByEmail(signals.customerEmail);
    if (!customer) {
      await finishRun(sb, run, "no_matches", { error_code: "customer_not_found" });
      await logSetupEvent(job.shopId, "gorgias_enrichment_no_matches", {
        disputeId,
        runId: run.id,
        reason: "customer_not_found",
      });
      return { ok: true };
    }

    await transition(sb, run.id, ["resolving_customer"], "searching_tickets");
    const tickets = (await client.listCustomerTickets(customer.id)).filter(
      (t) => !t.trashed_datetime && t.spam !== true,
    );
    if (tickets.length === 0) {
      await finishRun(sb, run, "no_matches", {
        tickets_scanned: 0,
        error_code: "no_tickets",
      });
      await logSetupEvent(job.shopId, "gorgias_enrichment_no_matches", {
        disputeId,
        runId: run.id,
        reason: "no_tickets",
      });
      return { ok: true };
    }

    await transition(sb, run.id, ["searching_tickets"], "fetching_messages");

    // Score with embedded messages first; only medium+ tickets without an
    // embedded messages[] array warrant a per-ticket fetch (rate limit).
    const scored: ScoredTicket[] = [];
    for (const ticket of tickets) {
      let messages = embeddedSnapshots(ticket);
      let result = scoreTicket(ticket, messages, signals);
      if (
        result.result.confidence !== "low" &&
        messages.length === 0 &&
        !Array.isArray(ticket.messages)
      ) {
        const fetched = await client.listTicketMessages(ticket.id);
        messages = fetched
          .map(snapshotMessage)
          .filter((s): s is MessageSnapshot => s !== null);
        result = scoreTicket(ticket, messages, signals);
      }
      scored.push(result);
    }

    const counters = {
      tickets_scanned: scored.length,
      tickets_high: scored.filter((s) => s.result.confidence === "high").length,
      tickets_medium: scored.filter((s) => s.result.confidence === "medium").length,
      tickets_low: scored.filter((s) => s.result.confidence === "low").length,
    };

    const { messagesStored, newMatches } = await persistScoredTickets(
      sb,
      { shopId: job.shopId, disputeId, integrationId: conn.integrationId },
      scored,
    );

    for (const m of newMatches) {
      await logSetupEvent(job.shopId, "gorgias_ticket_matched", {
        disputeId,
        runId: run.id,
        confidence: m.confidence,
        score: m.score,
      });
    }

    // Relevance analysis lands in PR3; until then a run with persisted
    // matches finishes 'completed' with proposal_count 0.
    await finishRun(sb, run, "completed", {
      ...counters,
      messages_stored: messagesStored,
    });
    await logSetupEvent(job.shopId, "gorgias_enrichment_completed", {
      disputeId,
      runId: run.id,
      ...counters,
      messagesStored,
      proposalCount: 0,
    });
    await maybeLogFirstEnriched(sb, job.shopId, run.id, disputeId);

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const authFailure = /gorgias api (401|403)\b/i.test(message);

    if (authFailure) {
      await markReconnectRequired(sb, conn.integrationId);
      await finishRun(sb, run, "failed_terminal", {
        error_code: "reconnect_required",
        error_message_safe: safeError(message),
      });
      await logSetupEvent(job.shopId, "gorgias_enrichment_failed", {
        disputeId,
        runId: run.id,
        errorCode: "reconnect_required",
      });
      return { ok: false, reason: "gorgias_auth_revoked", retriable: false };
    }

    await sb
      .from("gorgias_enrichment_runs")
      .update({
        status: "failed_retryable",
        error_code: "enrichment_error",
        error_message_safe: safeError(message),
        next_retry_at: new Date(Date.now() + (job.attempts + 1) * 30_000).toISOString(),
      })
      .eq("id", run.id);
    await logSetupEvent(job.shopId, "gorgias_enrichment_failed", {
      disputeId,
      runId: run.id,
      errorCode: "enrichment_error",
      willRetry: job.attempts < job.maxAttempts,
    });
    throw err; // worker backoff handles the retry
  }
}

// ── Run lifecycle ────────────────────────────────────────────────────────────

/**
 * Resume the active run for this dispute+integration (normal path: the
 * enqueue helper created it as 'queued'; retries find it 'failed_retryable'
 * → re-activated here). When none exists (job outlived its run), create a
 * 'retry' run; a 23505 collision means another worker won — back off.
 */
async function acquireRun(
  sb: SupabaseClient,
  shopId: string,
  disputeId: string,
  integrationId: string,
): Promise<RunRow | null> {
  const { data: active } = await sb
    .from("gorgias_enrichment_runs")
    .select("id, status, attempt_count, started_at")
    .eq("dispute_id", disputeId)
    .eq("integration_id", integrationId)
    .in("status", [...ACTIVE_RUN_STATUSES])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (active) {
    await sb
      .from("gorgias_enrichment_runs")
      .update({ attempt_count: (active.attempt_count as number) + 1 })
      .eq("id", active.id);
    return { ...(active as unknown as RunRow), attempt_count: (active.attempt_count as number) + 1 };
  }

  // Worker retry of a failed_retryable run: resume that same row (history
  // is preserved — a retry is the same execution, not a new run).
  const { data: retryable } = await sb
    .from("gorgias_enrichment_runs")
    .select("id, status, attempt_count, started_at")
    .eq("dispute_id", disputeId)
    .eq("integration_id", integrationId)
    .eq("status", "failed_retryable")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (retryable) {
    const { data: reclaimed } = await sb
      .from("gorgias_enrichment_runs")
      .update({
        status: "queued",
        attempt_count: (retryable.attempt_count as number) + 1,
        error_code: null,
        error_message_safe: null,
      })
      .eq("id", retryable.id)
      .eq("status", "failed_retryable")
      .select("id, status, attempt_count, started_at");
    if (reclaimed && reclaimed.length > 0) {
      return { ...(reclaimed[0] as unknown as RunRow), status: "queued" };
    }
  }

  const { data: lastRun } = await sb
    .from("gorgias_enrichment_runs")
    .select("run_number")
    .eq("dispute_id", disputeId)
    .eq("integration_id", integrationId)
    .order("run_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: created, error } = await sb
    .from("gorgias_enrichment_runs")
    .insert({
      shop_id: shopId,
      dispute_id: disputeId,
      integration_id: integrationId,
      run_number: ((lastRun?.run_number as number) ?? 0) + 1,
      status: "queued",
      trigger_source: "retry",
      attempt_count: 1,
    })
    .select("id, status, attempt_count, started_at")
    .single();

  if (error || !created) return null;
  return created as unknown as RunRow;
}

/** Guarded state transition; true when THIS caller performed it. */
async function transition(
  sb: SupabaseClient,
  runId: string,
  from: string[],
  to: string,
): Promise<boolean> {
  const { data } = await sb
    .from("gorgias_enrichment_runs")
    .update({ status: to })
    .eq("id", runId)
    .in("status", from)
    .select("id");
  return !!data && data.length > 0;
}

async function finishRun(
  sb: SupabaseClient,
  run: RunRow,
  status: string,
  patch: Record<string, unknown> = {},
): Promise<void> {
  const startedMs = Date.parse(run.started_at);
  await sb
    .from("gorgias_enrichment_runs")
    .update({
      status,
      completed_at: new Date().toISOString(),
      duration_ms: Number.isFinite(startedMs)
        ? Math.max(0, Date.now() - startedMs)
        : 0,
      ...patch,
    })
    .eq("id", run.id);
}

async function cancelActiveRuns(
  shopId: string,
  disputeId: string,
  errorCode: string,
): Promise<void> {
  const sb = getServiceClient();
  await sb
    .from("gorgias_enrichment_runs")
    .update({
      status: "cancelled",
      error_code: errorCode,
      completed_at: new Date().toISOString(),
    })
    .eq("shop_id", shopId)
    .eq("dispute_id", disputeId)
    .in("status", [...ACTIVE_RUN_STATUSES]);
}

async function markReconnectRequired(
  sb: SupabaseClient,
  integrationId: string,
): Promise<void> {
  const { data: row } = await sb
    .from("integrations")
    .select("meta")
    .eq("id", integrationId)
    .maybeSingle();
  const meta = (row?.meta as Record<string, unknown>) ?? {};
  await sb
    .from("integrations")
    .update({
      status: "needs_attention",
      meta: { ...meta, error_code: "reconnect_required" },
      updated_at: new Date().toISOString(),
    })
    .eq("id", integrationId);
}

// ── Signals ──────────────────────────────────────────────────────────────────

async function loadOrderSignals(
  sb: SupabaseClient,
  shopId: string,
  disputeId: string,
): Promise<OrderMatchSignals | null> {
  const { data: dispute } = await sb
    .from("disputes")
    .select("id, customer_email, order_name, order_gid, initiated_at")
    .eq("id", disputeId)
    .eq("shop_id", shopId)
    .maybeSingle();
  if (!dispute) return null;

  let orderRow: {
    customer_email: string | null;
    customer_shopify_id: string | null;
    shopify_order_number: string | null;
    created_at_shopify: string | null;
    fulfilled_at: string | null;
    delivered_at_tracking: string | null;
  } | null = null;

  if (dispute.order_gid) {
    const { data } = await sb
      .from("shopify_orders")
      .select(
        "customer_email, customer_shopify_id, shopify_order_number, created_at_shopify, fulfilled_at, delivered_at_tracking",
      )
      .eq("shop_id", shopId)
      .eq("shopify_order_id", dispute.order_gid)
      .maybeSingle();
    orderRow = data ?? null;
  }

  return {
    orderName:
      (dispute.order_name as string | null) ??
      orderRow?.shopify_order_number ??
      null,
    customerEmail:
      (dispute.customer_email as string | null) ??
      orderRow?.customer_email ??
      null,
    shopifyCustomerId: customerIdDigits(orderRow?.customer_shopify_id ?? null),
    // Tracking numbers are not persisted locally; the +40 signal stays
    // dormant until they are (documented limitation).
    trackingNumbers: [],
    orderCreatedAt: orderRow?.created_at_shopify ?? null,
    deliveredAt:
      orderRow?.delivered_at_tracking ?? orderRow?.fulfilled_at ?? null,
    chargebackAt: (dispute.initiated_at as string | null) ?? null,
  };
}

// ── Persistence ──────────────────────────────────────────────────────────────

function embeddedSnapshots(ticket: GorgiasTicket): MessageSnapshot[] {
  const raw = Array.isArray(ticket.messages) ? ticket.messages : [];
  return raw
    .map(snapshotMessage)
    .filter((s): s is MessageSnapshot => s !== null);
}

async function persistScoredTickets(
  sb: SupabaseClient,
  ids: { shopId: string; disputeId: string; integrationId: string },
  scored: ScoredTicket[],
): Promise<{
  messagesStored: number;
  newMatches: Array<{ confidence: string; score: number }>;
}> {
  const { data: existingRows } = await sb
    .from("gorgias_matched_tickets")
    .select("id, gorgias_ticket_id, match_status")
    .eq("dispute_id", ids.disputeId);
  const existingByTicket = new Map<number, ExistingTicketRow>(
    ((existingRows ?? []) as unknown as ExistingTicketRow[]).map((r) => [
      Number(r.gorgias_ticket_id),
      r,
    ]),
  );

  const rowIdByTicket = new Map<number, string>();
  const newMatches: Array<{ confidence: string; score: number }> = [];

  for (const s of scored) {
    const existing = existingByTicket.get(s.ticket.id) ?? null;
    const plan = planTicketPersistence(existing, s, ids);
    if (plan.action === "insert") {
      const { data: inserted } = await sb
        .from("gorgias_matched_tickets")
        .insert(plan.row)
        .select("id")
        .single();
      if (inserted) {
        rowIdByTicket.set(s.ticket.id, inserted.id as string);
        if (s.result.confidence !== "low") {
          newMatches.push({
            confidence: s.result.confidence,
            score: s.result.score,
          });
        }
      }
    } else {
      if (plan.action === "update") {
        await sb
          .from("gorgias_matched_tickets")
          .update(plan.patch)
          .eq("id", plan.id)
          .eq("match_status", "proposed_match");
      }
      rowIdByTicket.set(s.ticket.id, plan.id);
    }
  }

  // Messages: high + medium tickets only (low = hidden tier, no content).
  let messagesStored = 0;
  for (const s of scored) {
    if (s.result.confidence === "low") continue;
    const matchedTicketId = rowIdByTicket.get(s.ticket.id);
    if (!matchedTicketId || s.messages.length === 0) continue;

    const { data: existingMsgs } = await sb
      .from("gorgias_evidence_messages")
      .select(
        "id, gorgias_message_id, review_status, content_hash, approved_content_hash",
      )
      .eq("matched_ticket_id", matchedTicketId);
    const existingByMsg = new Map<number, ExistingMessageRow>(
      ((existingMsgs ?? []) as unknown as ExistingMessageRow[]).map((r) => [
        Number(r.gorgias_message_id),
        r,
      ]),
    );

    for (const m of s.messages) {
      const plan = planMessagePersistence(
        existingByMsg.get(m.gorgiasMessageId) ?? null,
        m,
        { shopId: ids.shopId, disputeId: ids.disputeId, matchedTicketId },
      );
      if (plan.action === "insert") {
        const { error } = await sb
          .from("gorgias_evidence_messages")
          .insert(plan.row);
        if (!error) messagesStored++;
      } else if (plan.action === "update" || plan.action === "drift_reproposal") {
        await sb
          .from("gorgias_evidence_messages")
          .update(plan.patch)
          .eq("id", plan.id);
        if (plan.action === "drift_reproposal") {
          await logSetupEvent(ids.shopId, "gorgias_message_needs_reapproval", {
            disputeId: ids.disputeId,
            matchedTicketId,
            gorgiasMessageId: m.gorgiasMessageId,
          });
        }
      }
    }
  }

  return { messagesStored, newMatches };
}

async function maybeLogFirstEnriched(
  sb: SupabaseClient,
  shopId: string,
  runId: string,
  disputeId: string,
): Promise<void> {
  const { count } = await sb
    .from("gorgias_enrichment_runs")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .in("status", ["completed", "ready_for_review"])
    .neq("id", runId);
  if ((count ?? 0) === 0) {
    await logSetupEvent(shopId, "gorgias_first_dispute_enriched", {
      disputeId,
      runId,
    });
  }
}

function safeError(message: string): string {
  // Never persist anything credential-shaped; keep it short.
  return message.replace(/Basic [A-Za-z0-9+/=]+/g, "Basic [redacted]").slice(0, 500);
}
