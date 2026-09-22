/**
 * Batched artifact facts for a set of disputes — plan §5.
 *
 * `gatherPresentations` already batches evidence-pack, rules and integration
 * reads for the list and dashboard surfaces. It does NOT read
 * `defence_packages`, which is why no surface could answer "does a document
 * exist?" and why eight open disputes rendered `ready` with no PDF.
 *
 * This gatherer adds that dimension under the same constraints: ONE query for
 * the whole batch (plan §5 forbids a query per rendered dispute), no narrative
 * bodies (`narrative_json` and `plan_json` are deliberately not selected — a
 * list row must not pull an LLM payload to compute a status), and tenant scope
 * preserved via `shop_id`.
 *
 * A failed read yields `readOk: false` for EVERY dispute in the batch, so the
 * resolver reports `unknown` rather than `absent`. That is the difference
 * between "we could not check" and "there is no document", and it is the whole
 * point of the contract.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { latestCandidate } from "@/lib/defence/candidateVersions";
import {
  resolveArtifact,
  type ArtifactFreshness,
  type ArtifactObservation,
  type ObservedPackageRow,
} from "./resolveArtifact";
import {
  resolveBuildAttempt,
  type BuildAttempt,
  type ObservedActiveJob,
  type ObservedAttemptRow,
} from "./resolveBuildAttempt";

export interface ArtifactFacts {
  artifact: ArtifactObservation;
  attempt: BuildAttempt;
}

/** Columns needed to resolve dimensions 5 and 6. Deliberately excludes
 *  narrative_json / plan_json / facts_json — see the header note. */
const PACKAGE_COLUMNS =
  "id, dispute_id, version, source_pack_id, content_revision, pdf_path, " +
  "status, validation_status, failure_code";

interface RawPackageRow {
  id: string;
  dispute_id: string | null;
  version: number | null;
  source_pack_id: string | null;
  content_revision: string | null;
  pdf_path: string | null;
  status: string | null;
  validation_status: string | null;
  failure_code: string | null;
}

/**
 * Freshness is owned by the existing rules (`evaluateFreshness` via
 * `selectFileablePackage`). This gatherer does NOT re-derive it — callers
 * that have consulted the owner pass a verdict in; everyone else gets
 * `"unknown"`, which is honest rather than guessed.
 */
export interface GatherArtifactOptions {
  freshnessByDispute?: ReadonlyMap<string, ArtifactFreshness>;
  activeJobsByDispute?: ReadonlyMap<string, ObservedActiveJob>;
}

export async function gatherArtifactFacts(
  sb: SupabaseClient,
  shopId: string,
  disputeIds: readonly string[],
  opts: GatherArtifactOptions = {},
): Promise<Map<string, ArtifactFacts>> {
  const out = new Map<string, ArtifactFacts>();
  if (disputeIds.length === 0) return out;

  // ONE query for the batch, newest version first.
  const { data, error } = await sb
    .from("defence_packages")
    .select(PACKAGE_COLUMNS)
    .eq("shop_id", shopId)
    .in("dispute_id", disputeIds as string[])
    .order("version", { ascending: false });

  const readOk = !error;

  const byDispute = new Map<string, RawPackageRow[]>();
  for (const r of (data ?? []) as unknown as RawPackageRow[]) {
    if (!r.dispute_id) continue;
    const list = byDispute.get(r.dispute_id);
    if (list) list.push(r);
    else byDispute.set(r.dispute_id, [r]);
  }

  for (const disputeId of disputeIds) {
    const rawAll = byDispute.get(disputeId) ?? [];

    /*
     * "Highest version" is NOT "the package we would file". A failed build
     * takes the next version number without producing anything, so it
     * SHADOWS the last real package — the defect `candidateVersions` exists
     * to close, after it cost blume-box dispute 11051073729 (USD 120) at its
     * deadline on 2026-08-14.
     *
     * The batched query above stays (plan §5 forbids a per-dispute fetch, so
     * `fetchCandidateRows` is not usable here), but SELECTION is delegated to
     * the one owner. `abortedNewer` is exactly the §3.4 distinction: "we hold
     * v4" and "we hold v4 because v5's build failed" are different facts.
     */
    const selection = latestCandidate(
      rawAll.map((r) => ({ ...r, version: r.version ?? Number.NaN, status: r.status })),
    );
    const raw: RawPackageRow[] = selection.candidate ? [selection.candidate] : [];
    const abortedNewer = selection.abortedNewer;

    const artifactRows: ObservedPackageRow[] = raw.map((r) => ({
      id: r.id,
      version: r.version ?? Number.NaN,
      sourcePackId: r.source_pack_id,
      contentRevision: r.content_revision,
      pdfPath: r.pdf_path,
      validationStatus: r.validation_status,
      failureCode: r.failure_code,
    }));

    /*
     * The ATTEMPT dimension is the opposite question: it must see the aborted
     * builds the artifact dimension looks past, or a failed rebuild would be
     * invisible and the case would read as "succeeded" off the older package.
     * Newest-first, aborted rows included.
     */
    const attemptSource: RawPackageRow[] = [...abortedNewer, ...raw];

    const attemptRows: ObservedAttemptRow[] = attemptSource.map((r) => ({
      id: r.id,
      version: r.version ?? Number.NaN,
      status: (r.status ?? "draft") as ObservedAttemptRow["status"],
      validationStatus: r.validation_status as ObservedAttemptRow["validationStatus"],
      failureCode: r.failure_code,
      // "Succeeded" requires a real document, not a terminal-looking status.
      hasValidatedArtifact: r.pdf_path != null && r.pdf_path !== "" && r.validation_status === "ok",
    }));

    out.set(disputeId, {
      artifact: resolveArtifact({
        readOk,
        rows: artifactRows,
        freshness: opts.freshnessByDispute?.get(disputeId) ?? "unknown",
      }),
      attempt: resolveBuildAttempt({
        readOk,
        // Job observations are supplied by the caller; when absent we have
        // not read the queue, so `jobReadOk` is false and no in-flight claim
        // can be licensed from silence.
        jobReadOk: opts.activeJobsByDispute != null,
        rows: attemptRows,
        activeJob: opts.activeJobsByDispute?.get(disputeId) ?? null,
      }),
    });
  }

  return out;
}
