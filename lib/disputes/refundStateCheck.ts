/**
 * The refund-state check, as a function over injected I/O (docs/plans/pending-refund-advice.plan.md, PR B).
 *
 * For every open credit-not-processed inquiry: read the order's refund state LIVE from Shopify, store it
 * (`dispute_refund_state`, which the dispute page reads), and, when `decideRefundAdvice` says so, email the
 * merchant. The cron route (`app/api/cron/refund-state-check/route.ts`) supplies the Supabase-backed I/O; this
 * file holds the sequencing so it can be tested with plain objects.
 *
 * Guarantees:
 *  - A read that throws leaves the stored state untouched and sends nothing ("unknown" is never "none").
 *  - Before ANY send the order is read AGAIN and the decision must still be the same send: the merchant may
 *    have refunded since the first read.
 *  - `dryRun` reads Shopify and decides, but writes nothing and sends nothing.
 *  - At most `perShopCap` emails per shop per run, so a freshly connected store with a backlog is never
 *    flooded; the rest wait for the next run.
 *  - If the dedupe row of a sent email cannot be written, sending halts for the run (a repeat email is worse than a late one).
 *  - A time budget: candidates not reached are COUNTED in the summary, not silently dropped.
 */

import { decideRefundAdvice, type RefundAdviceDecision, type RefundAdviceSkipReason } from "./refundAdviceDecision";
import type { RefundState } from "./refundState";

export interface RefundCheckCandidate {
  disputeId: string;
  shopId: string;
  shopDomain: string | null;
  orderGid: string;
  orderName: string | null;
  phase: string | null;
  status: string | null;
  reason: string | null;
  amount: number;
  currencyCode: string;
  dueAt: string | null;
  responseCycle: number;
  paymentMethod: string | null;
  optedOut: boolean;
  /** Raw `teamEmail` (may hold several comma-separated addresses); null when unset. */
  teamEmail: string | null;
  locale: string | null;
  alreadySent: boolean;
  /** Last live read of this dispute, or null when never read. */
  lastCheckedAt: string | null;
}

export interface RefundCheckDeps {
  /** Live read + interpretation. MUST throw on a transport / GraphQL error. */
  readState: (c: RefundCheckCandidate) => Promise<RefundState>;
  saveState: (c: RefundCheckCandidate, s: RefundState) => Promise<void>;
  /** Deliver the email. `ok: false` leaves the dispute eligible for the next run. */
  send: (c: RefundCheckCandidate, variant: "none" | "failed") => Promise<{ ok: boolean; error?: string }>;
  /** Stamp the dedupe row after a successful send. */
  recordSent: (c: RefundCheckCandidate, variant: "none" | "failed", s: RefundState) => Promise<void>;
  now: () => number;
}

export interface RefundCheckOptions {
  emailsEnabled: boolean;
  dryRun: boolean;
  /** Stop starting new candidates after this many ms. */
  budgetMs: number;
  perShopCap: number;
  /** Skip a candidate read less than this long ago. */
  minRecheckMs: number;
}

export interface RefundCheckSummary {
  candidates: number;
  checked: number;
  skippedRecent: number;
  skippedByBudget: number;
  readErrors: Array<{ disputeId: string; error: string }>;
  states: Record<string, number>;
  skips: Partial<Record<RefundAdviceSkipReason, number>>;
  sent: number;
  failedSends: number;
  racedBeforeSend: number;
  deferredByShopCap: number;
  /** Sends whose dedupe row could not be written (retried once). Sending halts for the rest of the run. */
  dedupeWriteFailures: string[];
  /** dryRun only: what WOULD be emailed. */
  wouldSend: Array<{ disputeId: string; orderName: string | null; variant: "none" | "failed" }>;
}

export async function runRefundStateCheck(
  candidates: RefundCheckCandidate[],
  deps: RefundCheckDeps,
  opts: RefundCheckOptions,
): Promise<RefundCheckSummary> {
  const started = deps.now();
  const summary: RefundCheckSummary = {
    candidates: candidates.length,
    checked: 0,
    skippedRecent: 0,
    skippedByBudget: 0,
    readErrors: [],
    states: {},
    skips: {},
    sent: 0,
    failedSends: 0,
    racedBeforeSend: 0,
    deferredByShopCap: 0,
    dedupeWriteFailures: [],
    wouldSend: [],
  };
  let sendingHalted = false;
  const sentPerShop = new Map<string, number>();

  const decide = (c: RefundCheckCandidate, state: RefundState): RefundAdviceDecision =>
    decideRefundAdvice({
      emailsEnabled: opts.emailsEnabled,
      phase: c.phase,
      status: c.status,
      reason: c.reason,
      state,
      paymentMethod: c.paymentMethod,
      optedOut: c.optedOut,
      hasTeamEmail: !!c.teamEmail && c.teamEmail.trim().length > 0,
      alreadySent: c.alreadySent,
    });

  for (let idx = 0; idx < candidates.length; idx++) {
    const c = candidates[idx];
    if (deps.now() - started > opts.budgetMs) {
      summary.skippedByBudget = candidates.length - idx;
      break;
    }
    if (c.lastCheckedAt && deps.now() - Date.parse(c.lastCheckedAt) < opts.minRecheckMs) {
      summary.skippedRecent++;
      continue;
    }

    try {
      const state = await deps.readState(c);
      summary.checked++;
      summary.states[state.kind] = (summary.states[state.kind] ?? 0) + 1;
      if (!opts.dryRun) await deps.saveState(c, state);

      const decision = decide(c, state);
      if (decision.action === "skip") {
        summary.skips[decision.reason] = (summary.skips[decision.reason] ?? 0) + 1;
        continue;
      }

      if (opts.dryRun) {
        summary.wouldSend.push({ disputeId: c.disputeId, orderName: c.orderName, variant: decision.variant });
        continue;
      }
      if (sendingHalted || (sentPerShop.get(c.shopId) ?? 0) >= opts.perShopCap) {
        summary.deferredByShopCap++;
        continue;
      }

      // The merchant may have refunded since the read above: confirm against a fresh read.
      const fresh = await deps.readState(c);
      const again = decide(c, fresh);
      if (again.action !== "send" || again.variant !== decision.variant) {
        await deps.saveState(c, fresh);
        summary.racedBeforeSend++;
        continue;
      }

      const res = await deps.send(c, decision.variant);
      if (!res.ok) {
        summary.failedSends++;
        continue;
      }
      // The email is out. If its dedupe row cannot be written the next run would send it again, so retry once
      // and, failing that, stop sending for the rest of this run and say so loudly.
      try {
        await deps.recordSent(c, decision.variant, fresh);
      } catch {
        try {
          await deps.recordSent(c, decision.variant, fresh);
        } catch {
          summary.dedupeWriteFailures.push(c.disputeId);
          sendingHalted = true;
        }
      }
      sentPerShop.set(c.shopId, (sentPerShop.get(c.shopId) ?? 0) + 1);
      summary.sent++;
    } catch (err) {
      summary.readErrors.push({ disputeId: c.disputeId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return summary;
}
