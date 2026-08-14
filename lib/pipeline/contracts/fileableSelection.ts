/**
 * `FileableSelection` — the one answer to "what, if anything, may be filed".
 *
 * THREE OUTCOMES, AND THE THIRD IS THE POINT.
 *
 *   selected — exactly one current, validated package.
 *   none     — a TYPED reason. Not null, not false, not an empty array.
 *   ambiguous— two or more candidates and no rule that picks between them.
 *              This is an ERROR that alerts, never a silent choice.
 *
 * `ambiguous` exists because the alternative — "take the newest" — is how a
 * superseded package reaches an issuer. If the selector cannot name one
 * package, filing stops and a human is told.
 *
 * WHAT THIS SUBSUMES. `packageSafety` (C-11, in production since 2026-08-08) is
 * already consulted at the save job, the manual save route, the deadline cron's
 * candidate selection and the workspace readiness projection. The selector
 * REPLACES those call sites; it does not sit beside them. Measured behaviour to
 * preserve: 212 of 280 package versions blocked, matching the pre-release
 * census exactly. A different count on the same population is a defect until
 * explained.
 */

import type { StalenessReason } from "./freshness";

/**
 * KNOWN GAP, deliberately not filled in this delivery: there is no `"manual"`
 * trigger. The merchant-confirmed save is genuinely a third trigger with
 * different semantics (the merchant may acknowledge warnings a machine may
 * not), and the manual save route is NOT converted to the selector in this
 * delivery — so adding the member now would create a case with no
 * implementation behind it. Whoever converts that route adds it then.
 */
export type SelectionTrigger = "normal" | "deadline";

/**
 * A candidate row, as the selector sees it before choosing (revision 1, Agent
 * B's frictions 4 and 5).
 *
 * The first cut described only the selector's OUTPUT, so each epic invented its
 * own candidate and "current inputs" shapes — which is how two layers end up
 * disagreeing about which package is current. Both live here now.
 */
export interface FileablePackageCandidate {
  packageId: string;
  packageVersion: number;
  artifactId: string | null;
  /** Package lifecycle state as stored. `"final"` is the only fileable value. */
  status: string;
  planInputHash: string | null;
  policyVersion: number | null;
  validationPassed: boolean | null;
}

/** What a candidate must match to be current. Compared, never recomputed here. */
export interface CurrentPipelineInputs {
  assessmentInputHash: string;
  planInputHash: string;
  decisionInputHash: string;
  policyVersion: number;
}

/**
 * Every way "nothing may be filed" can be true, enumerated.
 *
 * Enumerated rather than free-text because each one routes differently in the
 * UI and in alerting, and because a reviewer must be able to prove the list is
 * exhaustive. `deadline_only_not_yet_due` is not a failure — it is the normal
 * trigger correctly declining a package the deadline trigger may later take.
 */
export type NotFileableReason =
  | "no_package"
  /**
   * A candidate exists but is not `final` (revision 1, Agent B's friction 1).
   * Distinct from `no_package` because the live HTTP contract already splits
   * them — `preflightHttpRefusal` answers 409 `PACKAGE_NOT_FILEABLE` here and
   * 422 `PACKAGE_REVIEW_REQUIRED` for missing/blocked/not-current — and the
   * merchant action differs: approve it, versus regenerate it, versus wait.
   */
  | "not_final"
  | "no_safe_argument"
  | "validation_failed"
  /**
   * A HARD BLOCK IS AN HONESTY CONDITION, NEVER AN ODDS CONDITION.
   * Revision 2. Defined here because leaving it to inference produced a real
   * defect: `FIXTURE_WEAK` mapped weak strength onto `hard_block`, which would
   * have stopped the deadline path filing thin-but-honest cases.
   *
   * Shopify auto-compiles and files its OWN scrape when we file nothing, there
   * is no accept/concede mutation, and VDMP/VAMP compute the dispute ratio from
   * disputes *received* — so losing a representment costs nothing. A guard
   * therefore never chooses "submit vs stay silent"; it chooses OUR DOCUMENT vs
   * SHOPIFY'S SCRAPE. "We might lose" can never justify withholding.
   * Source: docs/evidence-model — 2026-07-30 finding; PR #465.
   *
   * Hard block means exactly: coverage/concession (nothing to win), fatal-loss
   * (our own order record contradicts the letter), or an unsafe claim
   * (packageSafety / C-11). Weak or insufficient STRENGTH is none of those — a
   * thin but honest argument beats a scrape and must still be filed.
   */
  | "hard_block"
  | "coverage_or_concession"
  | "stale"
  | "artifact_missing"
  | "superseded"
  | "deadline_only_not_yet_due";

export interface SelectedPackage {
  packageId: string;
  packageVersion: number;
  /** The generated artifact this selection stands behind. Never inferred. */
  artifactId: string;
  /**
   * This package is authorised to be filed, but is not `final` yet — the
   * executor must promote it through `finalize_defence_package` first.
   *
   * WHY THIS EXISTS. Rung 10 refused everything that was not already `final`,
   * and on 2026-08-14 production held 58 open unsubmitted cases of which
   * **zero** were final: 49 drafts and 9 failed builds. The deadline route has
   * a draft-promotion branch, but it sits AFTER the `outcome !== "selected"`
   * early return, so it could never run — activation would have filed nothing,
   * for every case, while looking like a selector working correctly.
   *
   * The alternative shapes were a fourth union member (explicit, but every
   * consumer and `isFileable` change) and finalizing before selecting (small,
   * but it promotes a package the gate may then refuse — leaving a `final` row
   * that should not exist, in the status the save worker files on). A flag on
   * the existing member keeps promotion downstream of authorization without
   * touching a single consumer that does not care.
   *
   * `false` on the normal trigger, always: only a deadline may file a package
   * the merchant has not approved, and that is the one relaxation P-6 permits
   * beyond `deadline_only_not_yet_due`.
   */
  requiresFinalize: boolean;
}

export type FileableSelection =
  | { outcome: "selected"; trigger: SelectionTrigger; package: SelectedPackage }
  | {
      outcome: "none";
      trigger: SelectionTrigger;
      reason: NotFileableReason;
      /** Present only when `reason === "stale"`; says which freshness rule failed. */
      staleness?: StalenessReason;
    }
  | {
      outcome: "ambiguous";
      trigger: SelectionTrigger;
      /** Every candidate, so the alert can show what the selector saw. */
      candidateIds: string[];
    };

/** Narrowing helper so no consumer re-implements the check with a string compare. */
export function isFileable(
  selection: FileableSelection,
): selection is Extract<FileableSelection, { outcome: "selected" }> {
  return selection.outcome === "selected";
}
