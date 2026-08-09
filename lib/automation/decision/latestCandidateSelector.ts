/**
 * A `FileableSelectorPort` over TODAY'S storage.
 *
 * THE SWAP POINT. CP-B owns the real selector; CP-C must not wait for it and
 * must not let an executor keep reaching a fileable row directly in the
 * meantime. So the query, the safety verdict and the lifecycle check live here,
 * behind the shared port, and the coordinator replaces this module's
 * implementation with CP-B's at integration. Every executor already calls
 * `selectForNormalExecution` / `selectForDeadline`; none of them changes.
 *
 * LATEST CANDIDATE ONLY. `order by version desc limit 1`, exactly as the save
 * job and the deadline cron already did. This module must NEVER be extended
 * into "find the newest SAFE version": on this fleet the older versions are
 * precisely the unsafe ones, so that fallback would be a fallback INTO the
 * defect (PR-C1).
 */

import type { getServiceClient } from "@/lib/supabase/server";
import type {
  FileableSelection,
  NotFileableReason,
  SelectionTrigger,
} from "@/lib/pipeline/contracts";
import { assessPackageCandidateSafety } from "@/lib/defence/packageSafety";
import type { FileableSelectorPort } from "./executionAdapters";

type ServiceClient = ReturnType<typeof getServiceClient>;

export interface LatestCandidateRow {
  id: string;
  status: string;
  validation_status: string | null;
  pdf_path: string | null;
  version: number;
  failure_code?: string | null;
  content_revision?: string | null;
  facts_json?: unknown;
  narrative_json?: unknown;
}

/**
 * Why the latest candidate was refused, in the vocabulary the merchant-facing
 * deadline email already speaks. Kept beside the `NotFileableReason` rather
 * than folded into it: the selection vocabulary is closed and shared, this one
 * exists so the existing email copy does not change under a refactor whose
 * whole point is that behaviour does not change.
 */
export type CandidateDetail =
  | "missing"
  | "unsafe_address_claim"
  | "validation_failed"
  | "skipped_no_facts"
  | "skipped_covered"
  | "not_finalizable"
  | "no_content_revision"
  | "query_error";

export interface LatestCandidateSelector extends FileableSelectorPort {
  /** The row the last `select()` inspected, so the caller does not re-query. */
  rowFor(caseId: string): LatestCandidateRow | null;
  /** Why it was refused, when it was. */
  detailFor(caseId: string): CandidateDetail | null;
  /** The safety verdict, for the audit row. */
  unsafeReasonsFor(caseId: string): { reasons: string[]; retiredKeys: string[] } | null;
}

const CANDIDATE_COLUMNS =
  "id, status, validation_status, pdf_path, version, failure_code, content_revision, facts_json, narrative_json";

export function createLatestCandidateSelector(
  sb: ServiceClient,
): LatestCandidateSelector {
  const rows = new Map<string, LatestCandidateRow | null>();
  const details = new Map<string, CandidateDetail | null>();
  const unsafe = new Map<string, { reasons: string[]; retiredKeys: string[] } | null>();

  async function select(args: {
    caseId: string;
    trigger: SelectionTrigger;
  }): Promise<FileableSelection> {
    const { caseId, trigger } = args;

    const { data, error } = await sb
      .from("defence_packages")
      .select(CANDIDATE_COLUMNS)
      .eq("dispute_id", caseId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      rows.set(caseId, null);
      details.set(caseId, "query_error");
      unsafe.set(caseId, null);
      return refuse(trigger, "no_package");
    }

    const row = (data as LatestCandidateRow | null) ?? null;
    rows.set(caseId, row);
    unsafe.set(caseId, null);

    if (!row) {
      details.set(caseId, "missing");
      return refuse(trigger, "no_package");
    }

    // Content safety first. An unsafe candidate is refused whatever its
    // lifecycle says — "already finalized, just submit it" must not bypass the
    // gate, and it is the branch that used to.
    const verdict = assessPackageCandidateSafety({
      factsJson: row.facts_json,
      narrativeJson: row.narrative_json,
    });
    if (!verdict.safe) {
      details.set(caseId, "unsafe_address_claim");
      unsafe.set(caseId, {
        reasons: verdict.reasons,
        retiredKeys: verdict.retiredKeys,
      });
      return refuse(trigger, "validation_failed");
    }

    if (row.status === "failed") {
      details.set(caseId, "validation_failed");
      return refuse(trigger, "validation_failed");
    }
    if (row.status === "skipped") {
      // `failure_code` is what distinguishes the coverage gate from
      // no-bank-facts. Reading it is why a Shopify-Protect dispute stops being
      // told its evidence was too thin.
      const covered = row.failure_code === "covered_shopify";
      details.set(caseId, covered ? "skipped_covered" : "skipped_no_facts");
      return refuse(trigger, covered ? "coverage_or_concession" : "no_safe_argument");
    }

    const finalizable =
      (row.status === "draft" || row.status === "stale") &&
      row.validation_status === "ok" &&
      Boolean(row.pdf_path);
    if (row.status !== "final" && !finalizable) {
      details.set(caseId, "not_finalizable");
      return refuse(trigger, "validation_failed");
    }

    // Nothing may be promoted or enqueued without a revision to pin the
    // inspected content to — otherwise the row we judged is not provably the
    // row that gets filed.
    if (!row.content_revision) {
      details.set(caseId, "no_content_revision");
      return refuse(trigger, "artifact_missing");
    }

    details.set(caseId, null);
    return {
      outcome: "selected",
      trigger,
      package: {
        packageId: row.id,
        packageVersion: row.version,
        artifactId: row.pdf_path ?? row.id,
      },
    };
  }

  function refuse(
    trigger: SelectionTrigger,
    reason: NotFileableReason,
  ): FileableSelection {
    return { outcome: "none", trigger, reason };
  }

  return {
    select,
    rowFor: (caseId) => rows.get(caseId) ?? null,
    detailFor: (caseId) => details.get(caseId) ?? null,
    unsafeReasonsFor: (caseId) => unsafe.get(caseId) ?? null,
  };
}
