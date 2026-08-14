/**
 * The REAL `FileableSelectorPort` — `selectFileablePackage` over persisted rows.
 *
 * ── WHAT THIS REPLACES ────────────────────────────────────────────────
 *
 * `lib/automation/decision/latestCandidateSelector.ts`, the placeholder CP-C
 * shipped so its executors could be built and tested before CP-B's selector
 * existed. The placeholder did `order by version desc limit 1` and applied the
 * content and lifecycle checks — which is the shipped behaviour, faithfully,
 * and is exactly why it must not survive: it can never answer "is this package
 * CURRENT", because nothing it reads records what the package was built from.
 * It is deleted in the same change that introduces this module.
 *
 * ── WHAT THIS MODULE DOES AND DOES NOT DECIDE ─────────────────────────
 *
 * It loads and it compares. Every verdict is `selectFileablePackage`'s: the
 * three outcomes, the ordering of the rungs, the ambiguity error, the one
 * outcome a deadline may change. Adding a rule here — "…unless it is nearly
 * current", "…take the newest safe one" — would put a second selector beside
 * the one selector, which is the whole defect.
 *
 * ── ALL VERSIONS, NOT THE LATEST ROW ──────────────────────────────────
 *
 * The query fetches every candidate for the case and the selector picks the
 * highest version itself. That is not redundant: `limit 1` cannot distinguish
 * "one candidate at the top version" from "two", and the second case is
 * `ambiguous` — an error that alerts, never a silent pick. A superseded package
 * reaching an issuer is precisely what "take the newest" produces when two rows
 * tie.
 *
 * ── STALENESS IS COMPUTED, NOT ASSUMED ────────────────────────────────
 *
 * `current` is derived HERE from live inputs, through the same
 * `derivePlanForCase` the build job wrote the package with. If the two used
 * different bridges the hashes could never match and every package would read
 * stale against itself. A package with no `plan_input_hash` is
 * `snapshot_absent` — non-fileable, not grandfathered, exactly as the kickoff
 * hash decision requires.
 */

import type { getServiceClient } from "@/lib/supabase/server";
import type {
  CaseArgumentPlanSnapshot,
  CaseAssessmentSnapshot,
  CaseAutomationDecisionSnapshot,
  CurrentPipelineInputs,
  FileableSelection,
  SelectionTrigger,
} from "@/lib/pipeline/contracts";
import type { DocumentFailureCode } from "./documentValidation";
import { assessPackageCandidateSafety } from "../packageSafety";
import { candidateVersions } from "../candidateVersions";
import {
  selectFileablePackage,
  type SelectableCandidate,
} from "./selectFileablePackage";

type ServiceClient = ReturnType<typeof getServiceClient>;

/**
 * Everything the selector compares against, assembled by the CALLER.
 *
 * Passed in rather than fetched here because the callers already hold it: the
 * pack pipeline and the deadline cron have both derived the decision by the
 * time they ask for a package, and re-deriving it inside the loader would let
 * the selection be judged against a decision different from the one the
 * executor is acting on.
 */
export interface FileableSelectionContext {
  assessment: CaseAssessmentSnapshot | null;
  decision: CaseAutomationDecisionSnapshot | null;
  /** The plan as it is NOW. Compared against what each candidate was built from. */
  plan: CaseArgumentPlanSnapshot | null;
  current: CurrentPipelineInputs;
}

/** The candidate columns the selection reads. Nothing else is consulted. */
const CANDIDATE_COLUMNS = [
  "id",
  "version",
  "status",
  "validation_status",
  "pdf_path",
  "superseded_by_id",
  "facts_json",
  "narrative_json",
  "plan_input_hash",
  "plan_policy_version",
  "plan_deadline_only",
  "document_validation_passed",
  "document_failure_codes",
  // Not a selection input — the enqueue RPC pins the inspected content to the
  // row it promotes with it, so the executor needs it off the SAME row the
  // selector judged rather than from a second query that could race.
  "content_revision",
].join(", ");

interface CandidateRow {
  id: string;
  version: number;
  status: string;
  validation_status: string | null;
  pdf_path: string | null;
  superseded_by_id: string | null;
  facts_json: unknown;
  narrative_json: unknown;
  plan_input_hash: string | null;
  plan_policy_version: number | null;
  plan_deadline_only: boolean | null;
  document_validation_passed: boolean | null;
  document_failure_codes: unknown;
  content_revision: string | null;
}

/**
 * The row the selection judged, for an executor that must act on exactly it.
 *
 * The placeholder exposed `rowFor()` for the same purpose. Kept, because the
 * alternative is the executor re-querying — and a re-query can return a
 * different row than the one the verdict was about, which is the whole class of
 * bug `content_revision` exists to close.
 */
export interface JudgedCandidate {
  packageId: string;
  version: number;
  status: string;
  contentRevision: string | null;
}

function failureCodesOf(raw: unknown): readonly DocumentFailureCode[] {
  return Array.isArray(raw) ? (raw as DocumentFailureCode[]) : [];
}

export function toSelectableCandidate(row: CandidateRow): SelectableCandidate {
  return {
    packageId: row.id,
    packageVersion: row.version,
    /* The artifact identity is the PDF *and* the revision that pins it.
     *
     * A row with a `pdf_path` but no `content_revision` cannot be promoted or
     * enqueued, because the row we judged is not provably the row that gets
     * filed — the enqueue and finalize RPCs both take the revision as their
     * expected value. Collapsing that into `artifactId` is deliberate: it is
     * the same question ("is there a document we can stand behind and prove we
     * inspected?"), and the selector already refuses a missing artifact as
     * `artifact_missing`. Leaving the check to the executor is what let a
     * candidate reach the promotion branch and be refused there, silently, with
     * no merchant notification. */
    artifactId: row.pdf_path && row.content_revision ? row.pdf_path : null,
    status: row.status,
    planInputHash: row.plan_input_hash,
    policyVersion: row.plan_policy_version,
    validationPassed: row.document_validation_passed,
    validationStatus: row.validation_status,
    supersededById: row.superseded_by_id,
    // UNPARSED, exactly as stored. The C-11 predicate fails closed on any shape
    // it has not measured, and parsing here would move that judgement out of
    // its owner.
    factsJson: row.facts_json,
    narrativeJson: row.narrative_json,
    planDeadlineOnly: row.plan_deadline_only ?? undefined,
    documentFailureCodes: failureCodesOf(row.document_failure_codes),
  };
}

export interface LoadFileableSelectionArgs {
  sb: ServiceClient;
  caseId: string;
  trigger: SelectionTrigger;
  context: FileableSelectionContext;
}

/**
 * Load the candidates and answer through `selectFileablePackage`.
 *
 * A query error is `no_package`, not a throw: a selector that throws turns a
 * transient database blip into an unhandled failure inside a cron that is
 * iterating disputes, and "we could not establish that anything is fileable" is
 * the honest — and safe — answer to a failed read.
 */
export async function loadFileableSelection(
  args: LoadFileableSelectionArgs,
): Promise<FileableSelection> {
  const { sb, caseId, trigger, context } = args;

  const { data, error } = await sb
    .from("defence_packages")
    .select(CANDIDATE_COLUMNS)
    .eq("dispute_id", caseId)
    .order("version", { ascending: false });

  if (error) return { outcome: "none", trigger, reason: "no_package" };

  const candidates = candidateVersions(
    (data ?? []) as unknown as CandidateRow[],
  ).map(toSelectableCandidate);

  return selectFileablePackage({
    caseId,
    trigger,
    candidates,
    assessment: context.assessment,
    plan: context.plan,
    decision: context.decision,
    current: context.current,
  });
}

/**
 * The port the execution adapters take, bound to one case's context.
 *
 * `selectForNormalExecution` / `selectForDeadline` call `select({caseId,
 * trigger})` and nothing else; binding the context here keeps the adapters
 * ignorant of the argument layer, which is the branch boundary they exist to
 * respect — automation may consume a selected package's operational identity,
 * never the argument that produced it.
 */
export interface CanonicalSelector {
  select(a: {
    caseId: string;
    trigger: SelectionTrigger;
  }): Promise<FileableSelection>;
  /** The highest-version row the last `select()` for this case inspected. */
  judgedFor(caseId: string): JudgedCandidate | null;
  /**
   * Whether that row was refused by the C-11 CONTENT verdict specifically.
   *
   * `selectFileablePackage` folds an unsafe claim and a failed document
   * validation into one `validation_failed` reason, correctly — both mean "this
   * document may not be filed". But the merchant copy and the audit event
   * distinguish them: an unsafe address claim gets its own event type and its
   * own email reason, and flattening that would lose the one refusal whose
   * cause the merchant can actually act on.
   */
  unsafeContentFor(caseId: string): boolean;
}

export function createCanonicalSelector(args: {
  sb: ServiceClient;
  /** Per-case context. The cron derives one per dispute as it iterates. */
  contextFor(caseId: string): FileableSelectionContext | null;
}): CanonicalSelector {
  const judged = new Map<string, JudgedCandidate | null>();
  const unsafe = new Map<string, boolean>();

  return {
    async select(a) {
      const context = args.contextFor(a.caseId);
      // No context means the caller could not derive a current plan/decision
      // for this case. That is `no_package`, never a pass: judging a candidate
      // against inputs we do not have is how a stale package looks current.
      if (!context) {
        judged.set(a.caseId, null);
        unsafe.set(a.caseId, false);
        return { outcome: "none", trigger: a.trigger, reason: "no_package" };
      }
      const loaded = await loadCandidateRows(args.sb, a.caseId);
      const top = topCandidate(loaded);
      judged.set(a.caseId, top);
      // The SAME predicate the selector runs, on the same two persisted
      // columns. Recomputed rather than plumbed out of the selector so the
      // selector's vocabulary stays closed; it is pure, so the two cannot
      // disagree.
      const topRow = top
        ? (loaded.find((r) => r.id === top.packageId) ?? null)
        : null;
      unsafe.set(
        a.caseId,
        topRow
          ? !assessPackageCandidateSafety({
              factsJson: topRow.facts_json,
              narrativeJson: topRow.narrative_json,
            }).safe
          : false,
      );
      return selectFileablePackage({
        caseId: a.caseId,
        trigger: a.trigger,
        candidates: loaded.map(toSelectableCandidate),
        assessment: context.assessment,
        plan: context.plan,
        decision: context.decision,
        current: context.current,
      });
    },
    judgedFor: (caseId) => judged.get(caseId) ?? null,
    unsafeContentFor: (caseId) => unsafe.get(caseId) ?? false,
  };
}

/**
 * Every CANDIDATE for the case, newest first.
 *
 * `failed` rows are dropped here rather than inside `selectFileablePackage`,
 * and the placement is the point: the selector's invariant is "the highest
 * version of the candidates I was given, never a fallback", and that stays
 * literally true. What changes is what counts as a candidate — a build that
 * never produced a PDF or a validated narrative is not a version of the
 * argument, and it may not shadow the last one that was. See
 * `lib/defence/candidateVersions.ts` for the production incident.
 *
 * Ambiguity is unaffected: two candidates tying at the top version is still
 * the selector's error to raise, now over the filtered set.
 */
async function loadCandidateRows(
  sb: ServiceClient,
  caseId: string,
): Promise<CandidateRow[]> {
  const { data, error } = await sb
    .from("defence_packages")
    .select(CANDIDATE_COLUMNS)
    .eq("dispute_id", caseId)
    .order("version", { ascending: false });
  if (error) return [];
  return candidateVersions((data ?? []) as unknown as CandidateRow[]);
}

/**
 * The highest version, or null when there is no single highest.
 *
 * `null` on a tie is deliberate and matches the selector: when two rows share
 * the top version there is no "the candidate", and handing the executor either
 * one would be the arbitrary pick `ambiguous` exists to prevent.
 */
function topCandidate(rows: readonly CandidateRow[]): JudgedCandidate | null {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.version));
  const atMax = rows.filter((r) => r.version === max);
  if (atMax.length !== 1) return null;
  const row = atMax[0];
  return {
    packageId: row.id,
    version: row.version,
    status: row.status,
    contentRevision: row.content_revision,
  };
}

/**
 * A `NotFileableReason` in the vocabulary the deadline fallback EMAIL already
 * speaks.
 *
 * The placeholder carried a parallel `CandidateDetail` enum for this. Mapping
 * from the selection's own typed reason instead means there is one refusal
 * vocabulary, and the merchant copy stops depending on a selector-private type
 * that PR 3 deletes.
 */
export type DeadlineFallbackReason =
  | "validation_failed"
  | "skipped_no_facts"
  | "skipped_covered"
  | "missing"
  | "unsafe_address_claim";

export function fallbackReasonForSelection(
  selection: FileableSelection,
): DeadlineFallbackReason {
  if (selection.outcome !== "none") {
    // `ambiguous`, or a selected package the executor refused downstream.
    // "Regenerate it" is the only honest instruction either way.
    return "validation_failed";
  }
  switch (selection.reason) {
    case "no_package":
      return "missing";
    case "coverage_or_concession":
      return "skipped_covered";
    case "no_safe_argument":
      return "skipped_no_facts";
    // `validation_failed` covers both the C-11 content verdict and a failed
    // document validation. The two are distinguishable in the audit row via
    // `documentFailureCodes`; the merchant instruction is the same.
    default:
      return "validation_failed";
  }
}
