/**
 * The one-time "final read" of closed / escalated inquiries (see `refundOutcomeData.ts`): read each order's
 * refund settlements live and store them with `final_read_at`, so the per-store results can be computed.
 * Sequencing only; the cron route supplies the I/O.
 *
 * A failed read leaves the dispute without `final_read_at`, so it is retried on a later run and, until then,
 * excluded from the figures (never assumed unrefunded).
 */

import type { RefundState } from "@/lib/disputes/refundState";
import type { FinalReadCandidate } from "@/lib/disputes/refundOutcomeData";

export interface FinalReadDeps {
  readState: (c: FinalReadCandidate) => Promise<RefundState>;
  saveFinal: (c: FinalReadCandidate, s: RefundState) => Promise<void>;
  now: () => number;
}

export interface FinalReadSummary {
  candidates: number;
  read: number;
  skippedByBudget: number;
  errors: Array<{ disputeId: string; error: string }>;
}

export async function runFinalReads(
  candidates: FinalReadCandidate[],
  deps: FinalReadDeps,
  opts: { budgetMs: number },
): Promise<FinalReadSummary> {
  const started = deps.now();
  const summary: FinalReadSummary = { candidates: candidates.length, read: 0, skippedByBudget: 0, errors: [] };
  for (let i = 0; i < candidates.length; i++) {
    if (deps.now() - started > opts.budgetMs) {
      summary.skippedByBudget = candidates.length - i;
      break;
    }
    const c = candidates[i];
    try {
      const state = await deps.readState(c);
      // An unknown read is not a result: leave the dispute unread so it is retried, and excluded meanwhile.
      if (state.kind === "unknown") {
        summary.errors.push({ disputeId: c.disputeId, error: `unknown:${state.reason ?? ""}` });
        continue;
      }
      await deps.saveFinal(c, state);
      summary.read++;
    } catch (err) {
      summary.errors.push({ disputeId: c.disputeId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return summary;
}
