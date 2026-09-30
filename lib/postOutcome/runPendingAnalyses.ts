/**
 * The automatic trigger for post-outcome analysis (plan §6.3, first bullet).
 *
 * Until 2026-09-30 the only thing that ever wrote an analysis was
 * `scripts/post-outcome-shadow.mts --persist`, run by hand. It was last run on
 * 2026-09-01; every dispute decided after that had no analysis, and the review
 * queue quietly stopped growing (70 decided disputes by 09-30).
 *
 * This is a sweep rather than a hook on the won/lost write, on purpose. The
 * outcome is set from several places (sync, webhook, refresh cron, reopen
 * reconciliation), and a sweep keyed on "decided but not analysed" catches all
 * of them — including a missed run — without touching any of them.
 *
 * A dispute is pending when it is decided (won/lost), has a package we
 * submitted (the analyzable set, same as the shadow script), and EITHER:
 *   - has no current analysis at all, or
 *   - its current analysis recorded a different outcome — a reopened dispute
 *     decided again. That is plan §13's "outcome correction": the new row
 *     supersedes, the old one and any review on it stay auditable.
 *
 * It never re-analyses a dispute whose outcome is unchanged. Plan §6.3 keeps
 * re-runs for a new analyzer version or a repaired source, and those stay
 * deliberate (`post-outcome-shadow.mts --persist`).
 */

import { getServiceClient } from "@/lib/supabase/server";
import { assembleSnapshot } from "./buildSnapshot";
import { composeAnalysis } from "./composeAnalysis";
import { loadSnapshotInputs } from "./loadSnapshotInputs";
import { persistAnalysis } from "./persistAnalysis";

const PAGE = 1000;

export interface DecidedDispute {
  id: string;
  final_outcome: string;
}

export interface CurrentAnalysis {
  dispute_id: string;
  final_outcome_snapshot: string | null;
}

/**
 * Pure selection, so the rule is testable without a database. Oldest-first
 * order is the caller's (disputes arrive sorted by closed_at).
 */
export function selectPending(
  decided: DecidedDispute[],
  submittedDisputeIds: ReadonlySet<string>,
  current: CurrentAnalysis[],
): string[] {
  const outcomeByDispute = new Map<string, Set<string | null>>();
  for (const a of current) {
    const s = outcomeByDispute.get(a.dispute_id) ?? new Set();
    s.add(a.final_outcome_snapshot);
    outcomeByDispute.set(a.dispute_id, s);
  }
  return decided
    .filter((d) => submittedDisputeIds.has(d.id))
    .filter((d) => {
      const outcomes = outcomeByDispute.get(d.id);
      return !outcomes || !outcomes.has(d.final_outcome);
    })
    .map((d) => d.id);
}

// PostgREST caps an un-ranged select at 1000 rows: every read here pages.
async function pageAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function findPendingAnalyses(): Promise<string[]> {
  const sb = getServiceClient();

  const decided = await pageAll<DecidedDispute>((from, to) =>
    sb
      .from("disputes")
      .select("id, final_outcome")
      .in("final_outcome", ["won", "lost"])
      .order("closed_at", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .range(from, to),
  );

  const submitted = await pageAll<{ dispute_id: string }>((from, to) =>
    sb
      .from("defence_packages")
      .select("dispute_id")
      .not("submitted_at", "is", null)
      .order("id", { ascending: true })
      .range(from, to),
  );

  const current = await pageAll<CurrentAnalysis>((from, to) =>
    sb
      .from("post_outcome_analyses")
      .select("dispute_id, final_outcome_snapshot")
      .is("superseded_by_id", null)
      .order("id", { ascending: true })
      .range(from, to),
  );

  return selectPending(decided, new Set(submitted.map((r) => r.dispute_id)), current);
}

export interface RunPendingResult {
  pending: number;
  analysed: number;
  alreadyExisted: number;
  findingsWritten: number;
  failed: Array<{ disputeId: string; error: string }>;
  /** Pending disputes left for the next run (limit or time budget reached). */
  deferred: number;
}

export async function runPendingAnalyses(options: {
  limit: number;
  deadlineMs: number;
}): Promise<RunPendingResult> {
  const pending = await findPendingAnalyses();
  const result: RunPendingResult = {
    pending: pending.length,
    analysed: 0,
    alreadyExisted: 0,
    findingsWritten: 0,
    failed: [],
    deferred: 0,
  };

  let processed = 0;
  for (const disputeId of pending) {
    if (processed >= options.limit || Date.now() >= options.deadlineMs) break;
    processed++;
    try {
      const inputs = await loadSnapshotInputs(disputeId);
      if (!inputs) throw new Error("dispute not found");
      const build = assembleSnapshot(inputs);
      const analysis = composeAnalysis(build);
      const r = await persistAnalysis(analysis, build.snapshot);
      if (r.alreadyExisted) result.alreadyExisted++;
      else {
        result.analysed++;
        result.findingsWritten += r.findingsWritten;
      }
    } catch (e) {
      // One unanalysable case must not cost the rest of the sweep.
      result.failed.push({ disputeId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  result.deferred = pending.length - processed;
  return result;
}
