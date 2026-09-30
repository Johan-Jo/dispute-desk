/**
 * Response cycles — a reopened dispute, or an inquiry escalated to a
 * chargeback, needs a NEW response.
 *
 * Shopify reports the sequence as `needs_response → under_review` (a response
 * went in) followed later by `under_review → needs_response` with a fresh
 * `evidence_due_by`. Before this module the first response's "sent" state
 * survived the reopen, so the dispute showed "Under review" with a live
 * deadline and neither the deadline cron nor the reminders selected it
 * (Mein Maison #99142 / #99348, 2026-09-27).
 *
 * The one writer of cycle state is the SQL function
 * `reconcile_response_cycle` (migration 20260927120000). It is idempotent
 * per `anchorKey`, so the live sync, the history reconstruction and the live
 * repair can all call it, in any order, any number of times, and the dispute
 * ends on the same cycle with the same artifacts retired.
 *
 * Plan: docs/plans/mein-maison-status-and-no-return.plan.md, Fix B.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Anything before 1971 is Shopify's epoch placeholder, not a deadline. */
const EPOCH_PLACEHOLDER_MS = Date.UTC(1971, 0, 1);

export function hasRealDeadline(dueAt: string | null | undefined): boolean {
  if (!dueAt) return false;
  const ms = new Date(dueAt).getTime();
  return Number.isFinite(ms) && ms >= EPOCH_PLACEHOLDER_MS;
}

/** Submission states that mean "a response for the current cycle went in". */
const RESPONDED_SUBMISSION_STATES = new Set([
  "submitted_confirmed",
  "saved_to_shopify",
  "responded_via_shopify",
  "under_review_unattributed",
]);

/** Responses we only observed as a Shopify status (Fix A). Kept literal here
 *  so this module does not import `respondedViaShopify.ts`, which imports it. */
const STATUS_OBSERVED_STATES = new Set([
  "responded_via_shopify",
  "under_review_unattributed",
]);

export interface PriorResponseRow {
  status: string | null;
  due_at: string | null;
  submitted_at: string | null;
  submission_state: string | null;
  evidence_saved_to_shopify_at?: string | null;
  shopify_updated_at?: string | null;
}

/**
 * True when the row RECORDS a response for its current cycle: Shopify's
 * `evidence_sent_on` (`submitted_at`), our own save, or a responded
 * submission state.
 *
 * Deliberately NOT `under_review` on its own. Inquiries flip between
 * `needs_response` and `under_review` with the SAME deadline and nothing
 * sent — the buyer and the merchant messaging in Shopify (prod, 6a8848-dd,
 * #99143: three flips in four days, `not_saved` throughout). Treating each
 * flip as a reopen would archive and rebuild the pack every time. The bug a
 * new cycle fixes is a stale "sent" state; with nothing recorded there is
 * nothing stale, and the dispute already shows as needing a response.
 */
export function hasPriorResponse(row: PriorResponseRow): boolean {
  if (row.submission_state && RESPONDED_SUBMISSION_STATES.has(row.submission_state)) {
    return true;
  }
  return Boolean(row.submitted_at || row.evidence_saved_to_shopify_at);
}

/**
 * B1: a new response cycle opens when Shopify asks for a response again
 * (`needs_response` with a real deadline) after one was already given.
 *
 * It must be a TRANSITION into `needs_response`: a row that is already
 * `needs_response` with `saved_to_shopify` is a save Shopify has not yet
 * acted on, not a reopen. Rows that were already `needs_response` before this
 * shipped are found by the live repair (plan B4), not here.
 */
export function opensNewResponseCycle(args: {
  existing: PriorResponseRow;
  newStatus: string | null;
  newDueAt: string | null | undefined;
}): boolean {
  if (args.newStatus !== "needs_response") return false;
  if (args.existing.status === "needs_response") return false;
  if (!hasRealDeadline(args.newDueAt)) return false;
  if (!hasPriorResponse(args.existing)) return false;
  // A response we only observed as a status (Fix A) is re-asked with the SAME
  // deadline whenever an inquiry's buyer writes back (#99143). That is not a
  // reopen: the dispute returns to "needs response" in the same cycle
  // (applyDisputeSnapshot resets the state). Only a new deadline is a reopen.
  const e = args.existing;
  const onlyObserved =
    !e.submitted_at &&
    !e.evidence_saved_to_shopify_at &&
    e.submission_state != null &&
    STATUS_OBSERVED_STATES.has(e.submission_state);
  if (onlyObserved && sameDeadline(e.due_at, args.newDueAt)) return false;
  return true;
}

function sameDeadline(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return new Date(a).getTime() === new Date(b).getTime();
}

/** Second precision, UTC — the same instant always yields the same key. */
function normalizeInstant(ts: string): string | null {
  const ms = new Date(ts).getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 19) + "Z";
}

/**
 * The anchor of a new cycle is the prior response it follows. Every path
 * (live sync, history reconstruction, live repair) MUST derive it with this
 * precedence, or the same cycle gets two ledger rows:
 *
 *   1. `submitted_at`                 — Shopify's `evidence_sent_on`
 *   2. `evidence_saved_to_shopify_at` — our save, when Shopify never echoed one
 *   3. `shopify_updated_at`           — the `under_review`-with-deadline
 *                                       transition, for a response sent
 *                                       outside DisputeDesk
 */
export function responseAnchorKey(row: PriorResponseRow): string | null {
  const ts =
    row.submitted_at ??
    row.evidence_saved_to_shopify_at ??
    (row.status === "under_review" && hasRealDeadline(row.due_at)
      ? row.shopify_updated_at ?? null
      : null);
  if (!ts) return null;
  const norm = normalizeInstant(ts);
  return norm ? `resp:${norm}` : null;
}

export type ResponseCycleTrigger = "reopen" | "escalation";
export type ResponseCycleSource =
  | "live"
  | "webhook_history"
  | "event_history"
  | "live_repair";

export interface ReconcileResponseCycleResult {
  /** A ledger row was added by this call. */
  inserted: boolean;
  /** The dispute was reset and the previous cycle's artifacts retired. */
  reset: boolean;
  cycle: number;
  reopenedAt: string | null;
  previous?: {
    submitted_at: string | null;
    submission_state: string | null;
    review_state: string | null;
    evidence_saved_to_shopify_at: string | null;
  };
  retiredPackIds: string[];
  retiredApprovals: Array<{ pack_id: string; approved_for_save_at: string }>;
  supersededDefencePackageIds: string[];
  restampedPackIds: string[];
}

export async function reconcileResponseCycle(
  sb: SupabaseClient,
  disputeId: string,
  args: {
    anchorKey: string;
    startedAt: string;
    trigger: ResponseCycleTrigger;
    source: ResponseCycleSource;
  },
): Promise<ReconcileResponseCycleResult> {
  const { data, error } = await sb.rpc("reconcile_response_cycle", {
    p_dispute_id: disputeId,
    p_anchor_key: args.anchorKey,
    p_started_at: args.startedAt,
    p_trigger: args.trigger,
    p_source: args.source,
  });
  if (error) {
    throw new Error(`reconcile_response_cycle failed: ${error.message}`);
  }
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    inserted: Boolean(r.inserted),
    reset: Boolean(r.reset),
    cycle: Number(r.cycle ?? 1),
    reopenedAt: (r.reopened_at as string | null) ?? null,
    previous: r.previous as ReconcileResponseCycleResult["previous"],
    retiredPackIds: (r.retired_pack_ids as string[] | undefined) ?? [],
    retiredApprovals:
      (r.retired_approvals as ReconcileResponseCycleResult["retiredApprovals"] | undefined) ?? [],
    supersededDefencePackageIds:
      (r.superseded_defence_package_ids as string[] | undefined) ?? [],
    restampedPackIds: (r.restamped_pack_ids as string[] | undefined) ?? [],
  };
}

/**
 * B0 invariant: an artifact from cycle N is never filed, auto-filed or
 * approved once the dispute is on cycle N+1. Columns default to 1, so a
 * missing value on either side compares as cycle 1.
 */
export function isStaleCycle(
  artifactCycle: number | null | undefined,
  disputeCycle: number | null | undefined,
): boolean {
  return (artifactCycle ?? 1) !== (disputeCycle ?? 1);
}
