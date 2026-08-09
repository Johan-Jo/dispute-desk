/**
 * Slice 2 / PR 2.0 — the pure calibration contract.
 *
 * READ-ONLY BY CONSTRUCTION. Nothing in this module touches the database,
 * enqueues a job, writes a snapshot, or is imported by any production code
 * path. It lives under `scripts/` for exactly that reason: `lib/` is what the
 * app ships, and the completeness DEPLOYMENT (PR 2.1) is not authorized. This
 * file exists to MEASURE what deploying it would do.
 *
 * WHY A SEPARATE MODULE AND NOT JUST THE `.analysis.ts` FILE.
 * `vitest.analysis.config.ts` collects `scripts/**\/*.analysis.ts` and CI never
 * runs it (it has no prod credentials, and a prod-reading job must never be
 * able to turn CI red). But the calibration's *claims* — that an unavailable
 * record leaves the denominator, that a waived record is satisfied and never
 * available, that completeness cannot move when strength moves — have to be
 * provable without prod. So the contract lives here, deterministically
 * testable from `tests/unit/completenessCalibration.test.ts`, and the
 * `.analysis.ts` harness is a thin prod-reading driver over it.
 *
 * ADAPTER DISCIPLINE, same rule as Slice 1 (`lib/evidence/model/assessment.ts`).
 * This module does NOT restate the weights, the readiness rules, or the gate.
 * It builds a row set under a named semantics and hands it to the REAL
 * `deriveCompletenessMetrics`, and it asks the REAL `evaluateAutoSaveGate` and
 * `evaluateAutoSubmitGuards` for outcomes. A difference this harness reports
 * can therefore only come from the row projection — which is the one thing
 * Slice 2 changes. If it re-implemented the engine, every number would be
 * measuring the re-implementation too, and no reader could tell them apart.
 *
 * ── WHY IT STILL IMPORTS THE RETIRED LADDERS (CP-A/B/C integration) ────
 *
 * `lib/automation/autoSaveGate.ts` and `lib/automation/autoSubmitGuards.ts`
 * have ZERO readers under `lib/` and `app/` — the canonical
 * `deriveCaseAutomationDecision` replaced every one of them, and
 * `branchBoundary.test.ts` fails the build if a production reader reappears.
 * This harness is the last importer anywhere, and it stays that way on purpose.
 *
 * Repointing it at the canonical decision was considered and REJECTED, because
 * it would change what the harness measures — which is the one thing it may not
 * do. The decision is not a renamed gate; it differs from the two ladders in at
 * least three ways this harness deliberately holds constant:
 *
 *   1. It resolves an ABSENT readiness to `"blocked"` (R1), where
 *      `evaluateAutoSaveGate` drops onto the legacy blocker-count arm. Prod
 *      packs with a NULL column would change disposition for a reason that has
 *      nothing to do with the Slice 2 row projection.
 *   2. It folds coverage, fatal-loss and staleness into the SAME verdict the
 *      gate produces, so a covered pack would stop being attributable to the
 *      semantics flags at all.
 *   3. Post-revision-2 it returns `hold_for_deadline` where the guards returned
 *      a block for weak/insufficient, which moves counts in the very column the
 *      calibration reports.
 *
 * The harness's job is to answer "what does production do TODAY, and what would
 * the new row semantics do to that". Both halves of that question are asked of
 * the legacy ladders on purpose. Converging it belongs with the deployment of
 * the canonical decision to the calibration baseline, as its own measured
 * change — not as a side effect of an integration merge.
 */

import {
  deriveCompletenessMetrics,
} from "@/lib/automation/completeness";
import { evaluateAutoSaveGate } from "@/lib/automation/autoSaveGate";
import {
  evaluateAutoSubmitGuards,
  type AutoSubmitGuardInput,
} from "@/lib/automation/autoSubmitGuards";
import type {
  ChecklistItemV2,
  EvidenceItemPriority,
  EvidenceItemStatus,
  SubmissionReadiness,
} from "@/lib/types/evidenceItem";
import { definitionFor } from "@/lib/evidence/model/definitions";
import type { CaseEvidenceModel } from "@/lib/evidence/model/types";
import type { RelevanceLevel } from "@/lib/evidence/model/vocabulary";

/* ═══════════════════════════════════════════════════════════════════════
 *  1. The semantics, as four named switches
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Each flag is ONE approved rule, isolatable. The point of naming them
 * separately is attribution: when a pack's gate outcome changes, the harness
 * flips exactly one flag at a time and reports which rule moved it. Without
 * that, every transition would be "the new semantics did it", which is not a
 * finding a maintainer can act on.
 */
export interface CompletenessSemantics {
  /**
   * A row this ORDER cannot produce leaves the denominator entirely — it is
   * neither satisfied nor a gap. An unfulfilled order is not penalised for
   * having no delivery proof, and a never-refunded order is never asked for a
   * refund record.
   *
   * NOTE: already true in production. Carried as a flag so the calibration can
   * MEASURE that it is inert rather than assert it, and so the deterministic
   * tests can pin it against a variant that gets it wrong.
   */
  excludeUnavailableFromDenominator: boolean;

  /**
   * A waived row counts as SATISFIED (numerator + denominator) and is never
   * reported as AVAILABLE. Waiving means "its absence no longer blocks
   * completion"; it does not conjure the evidence. `FieldStatus` in the model
   * keeps these five concepts apart for precisely this reason.
   *
   * Also already true in production; same rationale as above.
   */
  waivedCountsSatisfied: boolean;

  /**
   * THE ONE SUBSTANTIVE CHANGE. Completeness measures USABLE evidence, not
   * mere collection (maintainer decision, 2026-08-04).
   *
   * `true`  — a row is satisfied when ≥1 of its records has
   *           `validity.state === "valid"`.
   * `false` — a row is satisfied when the field was collected at all, which is
   *           what `evaluateCompletenessV2` does today: `presentFields` is
   *           built from `pack_json.sections[*].fieldsProvided`, so an AVS
   *           payload that came back `N`/`N` — well-formed, and carrying no
   *           assertion anyone can stand behind — counts exactly like a
   *           matching one.
   *
   * Validity is NOT quality and NOT strength. See §3.
   */
  requireUsableEvidence: boolean;

  /**
   * P-1, approved 2026-08-06 and made structural in Slice 1 (#515): a
   * `not_applicable` record enters neither the numerator nor the denominator.
   *
   * `false` reproduces today's behaviour, where
   * `reconcileChecklistWithCollectedFields` APPENDS a row at `optional`
   * priority for any canonical field that was collected but has no template
   * row. Relevance is derived FROM the template
   * (`lib/evidence/model/definitions.ts` `relevanceFor`), so "absent from the
   * template" and "not_applicable" are the same set — which is why this flag,
   * and not a row-set-widening flag, is the correct way to express the
   * difference.
   */
  excludeNotApplicable: boolean;
}

export type SemanticFlag = keyof CompletenessSemantics;

export const SEMANTIC_FLAGS: readonly SemanticFlag[] = [
  "excludeUnavailableFromDenominator",
  "waivedCountsSatisfied",
  "requireUsableEvidence",
  "excludeNotApplicable",
] as const;

/** The approved candidate contract. Not deployed — PR 2.1 is not authorized. */
export const CANDIDATE_SEMANTICS: CompletenessSemantics = {
  excludeUnavailableFromDenominator: true,
  waivedCountsSatisfied: true,
  requireUsableEvidence: true,
  excludeNotApplicable: true,
};

/**
 * What production computes today, expressed in the same four switches so the
 * two are comparable row-for-row.
 *
 * This is a CLAIM, and the harness verifies it per pack: it scores every pack
 * under these semantics and checks the gate outcome matches the outcome of the
 * real `evaluateCompletenessV2` engine re-run on the same inputs. A pack where
 * the two disagree is an `unresolved_blocker`, never a silently-classified
 * transition — the harness may not attribute a change it cannot reproduce.
 */
export const CURRENT_SEMANTICS: CompletenessSemantics = {
  excludeUnavailableFromDenominator: true,
  waivedCountsSatisfied: true,
  requireUsableEvidence: false,
  excludeNotApplicable: false,
};

/** The flags on which two semantics disagree — the ablation axis. */
export function divergentFlags(
  a: CompletenessSemantics,
  b: CompletenessSemantics,
): SemanticFlag[] {
  return SEMANTIC_FLAGS.filter((f) => a[f] !== b[f]);
}

/** `base`, with exactly one flag taken from `target`. */
export function withFlag(
  base: CompletenessSemantics,
  flag: SemanticFlag,
  target: CompletenessSemantics,
): CompletenessSemantics {
  return { ...base, [flag]: target[flag] };
}

/* ═══════════════════════════════════════════════════════════════════════
 *  2. Model → completeness rows, under a named semantics
 * ═══════════════════════════════════════════════════════════════════════ */

const PRIORITY_BY_RELEVANCE: Record<RelevanceLevel, EvidenceItemPriority> = {
  critical: "critical",
  recommended: "recommended",
  optional: "optional",
  // Only reachable when `excludeNotApplicable` is false, i.e. when
  // reproducing `reconcileChecklistWithCollectedFields`, which appends at
  // `optional` so a field the reason never asked for cannot outweigh one it
  // did. Same weight here, for the same reason.
  not_applicable: "optional",
};

/**
 * The completeness row set. Deliberately NOT the scoring row set.
 *
 * Scoring only reads `available` rows, so omitting an empty field there is
 * free. Completeness divides present weight by TOTAL weight, so an omitted
 * empty field shrinks the denominator and silently INFLATES the score — which
 * is the difference between a pack parking and DisputeDesk filing evidence on
 * the merchant's behalf. The two projections answer different questions and
 * must stay separate (`lib/evidence/model/assessment.ts` says the same thing
 * about the shipped pair).
 */
export function completenessRowsFromModel(
  model: CaseEvidenceModel,
  semantics: CompletenessSemantics,
): ChecklistItemV2[] {
  const out: ChecklistItemV2[] = [];

  for (const summary of Object.values(model.fields)) {
    const isNotApplicable = summary.relevance === "not_applicable";

    if (isNotApplicable) {
      if (semantics.excludeNotApplicable) continue;
      // Under the permissive arm we are reproducing the RECONCILE APPEND, and
      // reconcile appends a row only for a field that was actually collected.
      // Emitting empty not-applicable rows here would invent a denominator
      // production has never had, and every measured delta would be an
      // artifact of this file.
      if (summary.records.length === 0) continue;
    }

    const satisfiedByEvidence = semantics.requireUsableEvidence
      ? // ≥1 record with `validity.state === "valid"`.
        summary.status.available
      : // Merely collected — what `presentFields` means today.
        summary.records.length > 0;

    const waived = summary.status.waived !== null;

    // Waived is tested FIRST and wins, which is what makes "satisfied, never
    // available" true: a waived row can never be reported as `available`, so
    // it lands in the completeness numerator and stays out of
    // `evidenceStrengthScore`, which counts only `available`.
    let status: EvidenceItemStatus;
    if (waived && semantics.waivedCountsSatisfied) {
      status = "waived";
    } else if (satisfiedByEvidence) {
      status = "available";
    } else if (summary.status.applicable) {
      status = "missing";
    } else {
      status = semantics.excludeUnavailableFromDenominator
        ? "unavailable"
        : "missing";
    }

    out.push({
      field: summary.fieldKey,
      // Empty by design: `lib/**` emits no English and the scorer never reads
      // it. Merchant-facing text resolves from `def.labelToken`.
      label: "",
      status,
      priority: PRIORITY_BY_RELEVANCE[summary.relevance],
      // Every REASON_TEMPLATES_V2 field is `blocking: false` today. A
      // calibration harness may not invent a hard block that production
      // cannot produce.
      blocking: summary.status.blocking,
      source: definitionFor(summary.fieldKey).merchantSuppliable
        ? "manual_upload"
        : "auto_shopify",
    });
  }

  return out;
}

export interface CompletenessUnderSemantics {
  score: number;
  /** Counts `available` only — waived is deliberately excluded. */
  evidenceStrengthScore: number;
  readiness: SubmissionReadiness;
  blockers: string[];
  rows: ChecklistItemV2[];
  /** Rows that left the denominator because the ORDER cannot produce them. */
  excludedUnavailable: string[];
  /** Rows counted as satisfied because they were waived, not because evidence exists. */
  satisfiedByWaiver: string[];
}

export function completenessUnderSemantics(
  model: CaseEvidenceModel,
  semantics: CompletenessSemantics,
): CompletenessUnderSemantics {
  const rows = completenessRowsFromModel(model, semantics);
  const metrics = deriveCompletenessMetrics(rows);
  return {
    score: metrics.completenessScore,
    evidenceStrengthScore: metrics.evidenceStrengthScore,
    readiness: metrics.submissionReadiness,
    blockers: metrics.blockers,
    rows,
    excludedUnavailable: rows
      .filter((r) => r.status === "unavailable")
      .map((r) => r.field),
    satisfiedByWaiver: rows
      .filter((r) => r.status === "waived")
      .map((r) => r.field),
  };
}

/* ═══════════════════════════════════════════════════════════════════════
 *  3. Independence from case strength
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Completeness answers "how much of what this reason asks for do we hold";
 * strength answers "how much does what we hold prove". `completenessRows-
 * FromModel` reads exactly six things per field — `relevance`,
 * `status.applicable`, `status.available`, `status.waived`, `status.blocking`,
 * and `records.length` — and nothing else. In particular it never reads
 * `summary.quality`, never reads a record's `quality`, and never calls
 * `calculateCaseStrength`.
 *
 * The one place the two touch is `status.available`, which is `≥1 record with
 * validity.state === "valid"`. That is a VALIDITY judgement, not a strength
 * one, and the canonical vocabulary keeps them apart on purpose
 * (`lib/evidence/model/vocabulary.ts`): an AVS payload with no matching codes
 * is `invalid` — sound but proving nothing — while a `contextual` record is
 * perfectly valid and merely weak. A record's quality can move across all
 * three grades without its validity changing, and `completenessScoreIsStrength-
 * Independent` below is the assertion that when it does, completeness does
 * not move. `tests/unit/completenessCalibration.test.ts` proves it over the
 * full quality cross-product.
 */

/**
 * The declared input surface of the completeness computation. Exported so a
 * test can assert it, rather than a comment claiming it.
 */
export const COMPLETENESS_INPUTS = [
  "relevance",
  "status.applicable",
  "status.available",
  "status.waived",
  "status.blocking",
  "records.length",
] as const;

/** Nothing on this list may be read by the completeness projection. */
export const COMPLETENESS_FORBIDDEN_INPUTS = [
  "summary.quality",
  "record.quality",
  "CaseStrengthResult",
  "CaseAssessment.strength",
] as const;

/* ═══════════════════════════════════════════════════════════════════════
 *  4. Gate outcome and eligibility
 * ═══════════════════════════════════════════════════════════════════════ */

export type GateOutcome = "auto_save" | "block";

export interface ShopGateSettings {
  autoSaveEnabled: boolean;
  autoSaveMinScore: number;
  enforceNoBlockers: boolean;
}

/**
 * Per-shop settings, read from `shop_settings` and NEVER defaulted.
 *
 * `auto_save_min_score` is a per-shop column. A calibration that substituted a
 * house number for a missing or null row would report crossings against a
 * threshold no shop has, and the report's whole purpose is to say what happens
 * to THESE shops. So a shop whose settings cannot be read produces `null`
 * here, which the caller turns into a `missing_shop_settings` blocker — not a
 * quiet 0, and not a quiet 60.
 *
 * Note that a quiet 0 would be the WORST default available: every pack clears
 * a threshold of 0, so the report would show a fleet auto-filing cleanly and
 * conclude the change is safe.
 */
export function resolveShopGateSettings(
  row:
    | {
        auto_save_enabled?: boolean | null;
        auto_save_min_score?: number | null;
        enforce_no_blockers?: boolean | null;
      }
    | null
    | undefined,
): ShopGateSettings | null {
  if (!row) return null;
  if (typeof row.auto_save_min_score !== "number") return null;
  return {
    autoSaveEnabled: row.auto_save_enabled === true,
    autoSaveMinScore: row.auto_save_min_score,
    enforceNoBlockers: row.enforce_no_blockers === true,
  };
}

/**
 * The REAL gate. Not a re-implementation of `score >= threshold` — the gate
 * also consults `auto_save_enabled` and readiness, and a calibration that
 * modelled only the threshold would report crossings for shops whose gate
 * never opens.
 */
export function gateOutcome(args: {
  score: number;
  settings: ShopGateSettings;
  readiness: SubmissionReadiness;
  blockers: string[];
}): GateOutcome {
  return evaluateAutoSaveGate({
    autoSaveEnabled: args.settings.autoSaveEnabled,
    autoSaveMinScore: args.settings.autoSaveMinScore,
    enforceNoBlockers: args.settings.enforceNoBlockers,
    completenessScore: args.score,
    blockers: args.blockers,
    submissionReadiness: args.readiness,
  }).action;
}

/**
 * TODAY'S REAL DISPOSITION — the gate as `pipeline.ts` actually calls it.
 *
 * WHY THIS EXISTS SEPARATELY FROM `gateOutcome`. `evaluateAndMaybeAutoSave`
 * does not recompute completeness. It reads the columns
 * (`pipeline.ts:804-811`):
 *
 *     completenessScore:    pack.completeness_score ?? 0
 *     blockers:             (pack.blockers as string[]) ?? []
 *     submissionReadiness:  (pack.submission_readiness as …) ?? undefined
 *
 * Those are a SNAPSHOT written at build time, and 67 of 115 open packs carry a
 * `completeness_score` the current engine no longer reproduces. So a
 * calibration that asks "what does the gate do today" by re-running the engine
 * is answering a different question from "what did the gate do": it silently
 * substitutes a score production has never seen for the one production reads.
 *
 * The two baselines answer different questions and both are needed:
 *
 *   recalculated-current → candidate   isolates the SEMANTICS. Both sides run
 *                                      on the same fresh inputs, so a delta is
 *                                      attributable to a semantics rule and to
 *                                      nothing else. Attribution is only sound
 *                                      here, because the harness can reproduce
 *                                      this baseline from the model.
 *
 *   persisted-live      → candidate    is the OPERATIONAL truth. This is the
 *                                      disposition a deployment would actually
 *                                      change, so crossing counts and threshold
 *                                      trade-offs must use it.
 *
 * Note the three faithful details that a re-implementation would get wrong and
 * that change answers: `?? 0` (a NULL score is 0, not "skip"), `?? undefined`
 * for readiness (which drops `evaluateAutoSaveGate` onto the LEGACY blocker-
 * count path rather than the readiness path), and `?? []` for blockers.
 */
export function persistedLiveGateOutcome(args: {
  settings: ShopGateSettings;
  persistedCompletenessScore: number | null;
  persistedSubmissionReadiness: string | null;
  persistedBlockers: string[] | null;
}): GateOutcome {
  return evaluateAutoSaveGate({
    autoSaveEnabled: args.settings.autoSaveEnabled,
    autoSaveMinScore: args.settings.autoSaveMinScore,
    enforceNoBlockers: args.settings.enforceNoBlockers,
    completenessScore: args.persistedCompletenessScore ?? 0,
    blockers: args.persistedBlockers ?? [],
    submissionReadiness:
      (args.persistedSubmissionReadiness as SubmissionReadiness | null) ??
      undefined,
  }).action;
}

/**
 * Reasons a pack never reaches the completeness gate at all.
 *
 * `pipeline.ts` runs `evaluateAutoSubmitGuards` BEFORE
 * `evaluateAutoSaveGate`, and review-mode packs return earlier still. So the
 * completeness threshold is only load-bearing for the subset that gets past
 * both. Reporting a threshold crossing on a pack that parks for review — or
 * that is covered, fatally lost, or Moderate — would overstate the blast
 * radius of P-7 by counting packs whose disposition the threshold cannot
 * change.
 */
export type IneligibilityReason =
  | "rule_mode_review"
  | "covered_shopify"
  | "fatal_loss"
  | "moderate_strength"
  | "weak"
  | "insufficient";

/**
 * WHICH arm of the guard let the pack through. Three different justifications
 * with the same operational outcome, and calibration evidence is only as good
 * as the arm it rests on:
 *
 *   `strong`             — the intended path. PRD §9: auto mode executes on Strong.
 *   `credit`             — a fully-covering credit issued before the dispute.
 *                          Its own named branch in `evaluateAutoSubmitGuards`,
 *                          decided explicitly rather than inherited from the
 *                          Strong floor.
 *   `legacy_no_strength` — `pack_json.case_strength` is ABSENT, so the guard
 *                          falls through to `proceed`. These packs predate the
 *                          field. They are genuinely eligible today, but a
 *                          threshold recommendation resting on them is resting
 *                          on packs nobody ever judged Strong, and the report
 *                          must say so rather than count them as Strong.
 */
export type EligibilityPath = "strong" | "credit" | "legacy_no_strength";

export interface EligibilityResult {
  eligible: boolean;
  reason: IneligibilityReason | null;
  path: EligibilityPath | null;
}

/**
 * The Strong/credited eligibility condition, asked of the real guard.
 *
 * `evaluateAutoSubmitGuards` returns `proceed` for: a fully-covering credit
 * issued before the dispute, Strong, or a legacy pack with no recorded
 * strength. Everything else parks or blocks before completeness is consulted.
 */
export function completenessGateEligibility(args: {
  ruleMode: "auto" | "review";
  guards: AutoSubmitGuardInput;
}): EligibilityResult {
  if (args.ruleMode !== "auto") {
    return { eligible: false, reason: "rule_mode_review", path: null };
  }
  const verdict = evaluateAutoSubmitGuards(args.guards);
  if (verdict.decision !== "proceed") {
    return { eligible: false, reason: verdict.reason, path: null };
  }

  // Order matters and mirrors the guard's own precedence: the credit branch
  // returns before strength is read at all.
  const credited =
    args.guards.creditAlreadyIssued?.triggered === true &&
    args.guards.creditAlreadyIssued?.coversDisputedAmount === true;

  const path: EligibilityPath = credited
    ? "credit"
    : args.guards.caseStrength === "strong"
      ? "strong"
      : "legacy_no_strength";

  return { eligible: true, reason: null, path };
}

/* ═══════════════════════════════════════════════════════════════════════
 *  5. Transition classification
 * ═══════════════════════════════════════════════════════════════════════ */

export type TransitionClass =
  | "current_wrong_corrected"
  | "current_correct_preserved"
  | "intended_policy_change_requires_approval"
  | "unresolved_blocker";

export type BlockerReason =
  | "missing_shop_settings"
  | "missing_pack_sections"
  | "unparseable_checklist"
  | "harness_cannot_reproduce_current_engine"
  | "evidence_semantics_mismatch";

/**
 * A field is STRUCTURALLY unusable when it is collected across the fleet and
 * `categorizeEvidenceField` grades it `invalid` every single time. Zero valid
 * observations out of many is not a fleet whose evidence happens to be
 * worthless — it means the producer and the grader are not describing the same
 * fact, and the completeness semantics are not what makes it fail.
 *
 * THE LIVE EXAMPLE, and note carefully what it is NOT.
 * `canonicalEvidence.ts:153-160` defines `billing_address_match` as
 * "Strong when AVS-confirmed billing matches the CARDHOLDER. Invalid
 * otherwise." `orderSource.ts:109-113` emits the field when Shopify's billing
 * and shipping addresses share a city and country — two merchant-held
 * addresses, geographic similarity, no AVS anywhere, no cardholder anywhere.
 * Result: collected 95, valid 0.
 *
 * This is NOT a plumbing bug with a mechanical fix. Writing `match: true` into
 * the payload, or teaching the grader to read the field's presence, would both
 * promote billing/shipping geographic similarity into strong AVS-confirmed
 * cardholder evidence — a materially stronger claim than the data supports,
 * and one that would reach an issuer. The grader's `invalid` is the SAFE
 * answer, and the honest description is that two files own the meaning of one
 * field name and disagree about which fact it names.
 *
 * Why it is a blocker for calibration. If the `invalid` grade were counted as
 * "collected but not usable", the report would show the usable-evidence rule
 * stripping real evidence off every fraud pack, and a maintainer would read an
 * unresolved evidence-semantics question as a completeness finding and lower a
 * threshold to compensate. Any transition attributed to such a field is
 * therefore an `unresolved_blocker`: the harness cannot say whether the
 * candidate semantics are right about a field whose meaning is unsettled, and
 * it may not guess.
 */
export function structurallyUnusableFields(
  fleetStats: Map<string, { collected: number; valid: number }>,
  /** Ignore fields seen too rarely to distinguish a defect from a bad payload. */
  minObservations = 3,
): Set<string> {
  const out = new Set<string>();
  for (const [field, stat] of fleetStats) {
    if (stat.collected >= minObservations && stat.valid === 0) out.add(field);
  }
  return out;
}

export interface TransitionInput {
  /**
   * Gate outcome today: the real `evaluateCompletenessV2` engine re-run NOW on
   * the current template. Re-run rather than read from
   * `evidence_packs.completeness_score`, because a persisted score can predate
   * a template change and comparing it to the candidate would measure template
   * drift, not this slice. Persisted-vs-runtime staleness is reported
   * separately as its own finding.
   */
  currentOutcome: GateOutcome | null;
  /** Gate outcome under `CURRENT_SEMANTICS` rebuilt from the model. */
  reconstructedOutcome: GateOutcome | null;
  /** Gate outcome under `CANDIDATE_SEMANTICS`. */
  candidateOutcome: GateOutcome | null;
  /**
   * For each flag on which current and candidate disagree: the outcome when
   * ONLY that flag is switched. This is the attribution mechanism.
   */
  singleFlagOutcomes: Partial<Record<SemanticFlag, GateOutcome>>;
  /** Inputs the harness needed and did not have. Any entry forces a blocker. */
  missingInputs: BlockerReason[];
  /**
   * True when at least one of this pack's newly-unusable fields is
   * structurally unusable fleet-wide (see `structurallyUnusableFields`). The
   * usable-evidence attribution is then contaminated and may not be reported
   * as a correction.
   */
  usableEvidenceAttributionContaminated?: boolean;
}

export interface TransitionVerdict {
  classification: TransitionClass;
  /** The flags whose single-flag flip reproduces the change. */
  causes: SemanticFlag[];
  blockerReason: BlockerReason | null;
}

/**
 * Total over its input: every pack gets exactly one of the four classes, and
 * `unresolved_blocker` is the honest bucket rather than a fallthrough that
 * quietly picks a class. A blocker BLOCKS completion of PR 2.0; it is not a
 * finding to be reasoned past.
 *
 * WHY `requireUsableEvidence` ALONE IS A CORRECTION, NOT A POLICY CHANGE.
 * When that single flag flips a pack's outcome, the current gate reached its
 * decision by counting a row as satisfied whose only records are `invalid` —
 * a payload we parsed and which carries no assertion we can stand behind.
 * Today's number therefore asserts something untrue about the case: that the
 * evidence the reason asks for is held. Correcting a false input to a decision
 * is not a change of policy, so it is classified as such. Every pack in this
 * bucket is reported with the exact fields that changed state, so the
 * maintainer can check that claim case by case rather than take it.
 *
 * EVERYTHING ELSE THAT MOVES AN OUTCOME REQUIRES APPROVAL. The P-1 row-set
 * rule is approved as SEMANTICS, but the decision sheet defers P-7 —
 * thresholds — precisely so that a semantics change may not silently
 * redecide dispositions. A transition attributable to it, to an interaction
 * between flags, or to no single flag at all is therefore
 * `intended_policy_change_requires_approval`. This harness does not approve
 * it.
 */
export function classifyTransition(input: TransitionInput): TransitionVerdict {
  if (input.missingInputs.length > 0) {
    return {
      classification: "unresolved_blocker",
      causes: [],
      blockerReason: input.missingInputs[0],
    };
  }

  const { currentOutcome, reconstructedOutcome, candidateOutcome } = input;

  if (
    currentOutcome === null ||
    reconstructedOutcome === null ||
    candidateOutcome === null
  ) {
    return {
      classification: "unresolved_blocker",
      causes: [],
      blockerReason: "harness_cannot_reproduce_current_engine",
    };
  }

  // The harness must be able to reproduce today's gate outcome from the model
  // before it is allowed to attribute a change away from it. If it cannot, the
  // difference has an unexplained component and no attribution is honest.
  if (reconstructedOutcome !== currentOutcome) {
    return {
      classification: "unresolved_blocker",
      causes: [],
      blockerReason: "harness_cannot_reproduce_current_engine",
    };
  }

  if (candidateOutcome === currentOutcome) {
    return {
      classification: "current_correct_preserved",
      causes: [],
      blockerReason: null,
    };
  }

  const causes = SEMANTIC_FLAGS.filter((flag) => {
    const outcome = input.singleFlagOutcomes[flag];
    return outcome !== undefined && outcome !== reconstructedOutcome;
  });

  // A flip that leans on a field whose collector/categorizer contract is
  // broken is not attributable to the semantics at all. Report it as a
  // blocker rather than as a correction OR a policy change — both would be
  // claims about a rule the evidence cannot support.
  if (
    causes.includes("requireUsableEvidence") &&
    input.usableEvidenceAttributionContaminated === true
  ) {
    return {
      classification: "unresolved_blocker",
      causes,
      blockerReason: "evidence_semantics_mismatch",
    };
  }

  const onlyUsableEvidence =
    causes.length === 1 && causes[0] === "requireUsableEvidence";

  return {
    classification: onlyUsableEvidence
      ? "current_wrong_corrected"
      : "intended_policy_change_requires_approval",
    causes,
    blockerReason: null,
  };
}

/* ═══════════════════════════════════════════════════════════════════════
 *  6. Candidate thresholds
 * ═══════════════════════════════════════════════════════════════════════ */

export interface ThresholdTradeOff {
  threshold: number;
  /** Packs blocked at today's threshold that this threshold would auto-file. */
  newlyAutoFiles: number;
  /** Packs auto-filing today that this threshold would block. */
  newlyBlocks: number;
  /** Packs whose disposition is unchanged. */
  preserved: number;
}

export interface ThresholdCandidateInput {
  /**
   * Whether the pack auto-files TODAY — the full
   * `persistedLiveGateOutcome`, not `score >= threshold`.
   *
   * It has to be the outcome and not a score comparison, because the live gate
   * also consults `auto_save_enabled`, persisted readiness and persisted
   * blockers. Recomputing "does it clear the bar" from a freshly recalculated
   * score would compare a disposition production never took against one it
   * might — and on this fleet 67 of 115 persisted scores differ from the
   * recalculated ones, so the two disagree often enough to change the answer.
   */
  filesToday: boolean;
  /** Score under the approved candidate semantics. */
  candidateScore: number;
}

/**
 * Every distinct candidate score is a real decision boundary, so the trade-off
 * table enumerates all of them plus today's threshold. Sampling round numbers
 * would hide the boundary that actually matters — on this fleet the interval
 * between two adjacent packs is a single point.
 */
export function thresholdTradeOffs(
  packs: ThresholdCandidateInput[],
  currentThreshold: number,
): ThresholdTradeOff[] {
  const candidates = [
    ...new Set([...packs.map((p) => p.candidateScore), currentThreshold]),
  ].sort((a, b) => a - b);

  return candidates.map((threshold) => {
    let newlyAutoFiles = 0;
    let newlyBlocks = 0;
    let preserved = 0;
    for (const p of packs) {
      const filesUnder = p.candidateScore >= threshold;
      if (p.filesToday === filesUnder) preserved += 1;
      else if (filesUnder) newlyAutoFiles += 1;
      else newlyBlocks += 1;
    }
    return { threshold, newlyAutoFiles, newlyBlocks, preserved };
  });
}

/**
 * The highest threshold that changes no disposition, when one exists.
 *
 * Returns `null` when the candidate semantics REORDER rather than merely
 * rescale — i.e. when some pack blocked today outscores some pack that files
 * today. That is a real finding, not a failure: it means no threshold can
 * preserve today's behaviour and the maintainer must choose which dispositions
 * change. The harness reports the conflict and the trade-off table; it does
 * not pick.
 */
export function dispositionPreservingThreshold(
  packs: ThresholdCandidateInput[],
): number | null {
  const filesToday = packs.filter((p) => p.filesToday);
  const blockedToday = packs.filter((p) => !p.filesToday);
  if (filesToday.length === 0) return null;

  const floor = Math.min(...filesToday.map((p) => p.candidateScore));
  const ceiling = blockedToday.length
    ? Math.max(...blockedToday.map((p) => p.candidateScore))
    : null;

  if (ceiling !== null && floor <= ceiling) return null;
  return floor;
}
