/**
 * Which `defence_packages` rows are CANDIDATES, and which is the current one.
 *
 * ── THE DEFECT THIS CLOSES ────────────────────────────────────────────
 *
 * Every filing path asked the same question the same wrong way:
 *
 *   .from("defence_packages").eq("dispute_id", id)
 *   .order("version", { ascending: false }).limit(1)
 *
 * "The highest version row" and "the package we would file" were treated as
 * one thing. They are not. A `failed` row is not a version of the argument —
 * it is the record of a build that never produced one: no PDF, no validated
 * narrative, nothing that could reach an issuer. But it takes the next version
 * number, so it SHADOWS the last package that did.
 *
 * Measured on production 2026-08-14: blume-box dispute 11051073729 (USD 120)
 * held v4 — `validation_status='ok'`, PDF rendered, and explicitly held by the
 * pipeline to be filed at its deadline (`auto_save_blocked` →
 * `hold_for_deadline`, verdict `eligible`). At 06:03 on the deadline morning
 * the pre-deadline rebuild cron regenerated it; v5 failed narrative validation
 * twice and landed `failed` with no PDF. At 08:01 the deadline cron read "the
 * latest row", found v5, and filed NOTHING. A validated package sat one row
 * below, unreachable, and the dispute went to forfeit. Twelve disputes were in
 * that shape across the fleet, one of them already lost.
 *
 * ── WHAT THIS DOES NOT DO ─────────────────────────────────────────────
 *
 * It does not search for "the newest SAFE version". That search is forbidden
 * by `packageSafety`'s doctrine and the prohibition stands: a candidate the
 * content gate REFUSES stops the filing, and nothing walks past it looking for
 * an older one that passes. The distinction is between a build that was judged
 * and refused (a candidate — stop) and a build that never completed (not a
 * candidate — it was never a version of anything).
 *
 * So the safety gate still runs, unchanged, on whatever row this names. This
 * module only stops an aborted build from standing in for one.
 *
 * ── ONE OWNER ─────────────────────────────────────────────────────────
 *
 * `tests/unit/defencePackageCandidateSelection.test.ts` enumerates the
 * production modules that query `defence_packages` ordered by version and
 * fails on any new call site that does not come through here. The two
 * documented exceptions are the version COUNTER in `lib/defence/enqueue.ts`
 * (which must keep counting aborted builds, or a rebuild would reuse a version
 * number) and this file.
 */

/**
 * The one status that is not a candidate version.
 *
 * `skipped` deliberately IS a candidate: it means "we decided not to build" —
 * covered by Shopify Protect, or no bank-eligible facts — and those are
 * answers, not failures. Falling back past a `skipped` row would file a
 * package for a case the pipeline decided to leave alone.
 */
export const ABORTED_BUILD_STATUS = "failed";

/** A row shape narrow enough that every caller's own select() satisfies it. */
export interface VersionedCandidateRow {
  version: number;
  status?: string | null;
}

export function isAbortedBuild(status: string | null | undefined): boolean {
  return status === ABORTED_BUILD_STATUS;
}

/**
 * The rows a selector may consider, newest first.
 *
 * For the canonical `selectFileablePackage`, which does its own highest-version
 * resolution and its own ambiguity check — hand it this, not the raw query.
 */
export function candidateVersions<T extends VersionedCandidateRow>(
  rows: readonly T[],
): T[] {
  return [...rows]
    .filter((r) => !isAbortedBuild(r.status ?? null))
    .sort((a, b) => b.version - a.version);
}

export interface LatestCandidateResult<T> {
  /** The newest row that represents a completed build, or null if there is none. */
  candidate: T | null;
  /**
   * Aborted builds NEWER than `candidate`, newest first.
   *
   * Load-bearing for the merchant message and the audit row: "we filed v4"
   * and "we filed v4 because v5's build failed this morning" are different
   * facts, and the second is the one that explains a package built from an
   * older evidence snapshot.
   */
  abortedNewer: T[];
  /**
   * Two or more candidates share the top version — no rule picks between them.
   * Callers that cannot express ambiguity may ignore it (they had no such
   * concept before); `selectFileablePackage` owns the real answer.
   */
  ambiguous: boolean;
}

/**
 * The row a filing path should act on, plus what it had to look past.
 *
 * Replaces `order by version desc limit 1` at every site that meant "the
 * package we would file" rather than "the highest version number".
 */
export function latestCandidate<T extends VersionedCandidateRow>(
  rows: readonly T[],
): LatestCandidateResult<T> {
  const ordered = [...rows].sort((a, b) => b.version - a.version);
  const candidates = ordered.filter((r) => !isAbortedBuild(r.status ?? null));
  if (candidates.length === 0) {
    return { candidate: null, abortedNewer: ordered, ambiguous: false };
  }
  const topVersion = candidates[0].version;
  const atTop = candidates.filter((r) => r.version === topVersion);
  return {
    candidate: atTop[0],
    abortedNewer: ordered.filter(
      (r) => isAbortedBuild(r.status ?? null) && r.version > topVersion,
    ),
    ambiguous: atTop.length > 1,
  };
}

/** Minimal Supabase surface — structural so tests can pass a hand-rolled mock. */
type SbLike = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

/**
 * The one row a filing path should act on.
 *
 * Deliberately still `limit(1).maybeSingle()`, with the aborted builds excluded
 * in SQL: what was wrong with the old query was the missing filter, not the
 * limit, and keeping the shape means a caller reads the same way it always did.
 * `latestCandidate` re-applies the predicate in code over whatever comes back,
 * so the rule is enforced by the tested pure function and not only by a query
 * string repeated at six call sites.
 *
 * Use `fetchCandidateRows` instead when the caller needs to KNOW that it looked
 * past an aborted build — the deadline path has to say so.
 */
export async function fetchLatestCandidate<T extends VersionedCandidateRow>(
  sb: SbLike,
  disputeId: string,
  columns: string,
): Promise<{ row: T | null; error: string | null }> {
  const res = await sb
    .from("defence_packages")
    .select(columns)
    .eq("dispute_id", disputeId)
    .neq("status", ABORTED_BUILD_STATUS)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res?.error) return { row: null, error: res.error.message ?? "unknown" };
  const row = (res?.data ?? null) as T | null;
  // Belt and braces: the predicate, not the query, is the contract.
  if (row && isAbortedBuild(row.status ?? null)) return { row: null, error: null };
  return { row, error: null };
}

/**
 * The newest row of ANY status, aborted builds included.
 *
 * Asked only after `fetchLatestCandidate` came back empty, to separate two
 * states a caller must not conflate: no package has ever been built (wait for
 * the build) versus a build ran and failed (waiting cannot help). Same chain
 * shape, one extra round-trip on a path that is already refusing.
 */
export async function fetchLatestAnyVersion<T extends VersionedCandidateRow>(
  sb: SbLike,
  disputeId: string,
  columns: string,
): Promise<{ row: T | null; error: string | null }> {
  const res = await sb
    .from("defence_packages")
    .select(columns)
    .eq("dispute_id", disputeId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res?.error) return { row: null, error: res.error.message ?? "unknown" };
  return { row: (res?.data ?? null) as T | null, error: null };
}

/**
 * Every version for a case, newest first, aborted builds INCLUDED.
 *
 * For the callers that must distinguish "no package was ever built" from "a
 * build ran this morning and failed" — the deadline path, whose merchant
 * message and audit row differ between the two. Unbounded on purpose; a case
 * holds single-digit versions.
 */
export async function fetchCandidateRows<T extends VersionedCandidateRow>(
  sb: SbLike,
  disputeId: string,
  columns: string,
): Promise<{ rows: T[]; error: string | null }> {
  const res = await sb
    .from("defence_packages")
    .select(columns)
    .eq("dispute_id", disputeId)
    .order("version", { ascending: false });
  if (res?.error) {
    return { rows: [], error: res.error.message ?? "unknown" };
  }
  const data = res?.data;
  return { rows: (Array.isArray(data) ? data : []) as T[], error: null };
}
