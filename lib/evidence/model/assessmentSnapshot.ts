/**
 * CP-A — the persisted, versioned form of `CaseAssessment`.
 *
 * `lib/evidence/model/assessment.ts` derives the assessment in-process.
 * This module wraps that derivation in the shared `CaseAssessmentSnapshot`
 * contract and gives it the one thing the in-process form cannot have: a
 * `SnapshotFreshness` whose `inputHash` covers EVERY result-bearing input.
 *
 * ── WHY THE HASH IS THE WHOLE POINT ───────────────────────────────────
 *
 * `computedAt` is not a staleness signal (see `contracts/freshness.ts`), and
 * the previous generation of this pipeline proved why: 67 of 115 prod packs
 * carried a `completeness_score` the current engine no longer reproduces, and
 * nothing in the row said so. A timestamp only records that somebody computed
 * something; the hash records WHAT they computed it from. If any input that
 * can change the result changes, the hash must change — otherwise a snapshot
 * derived from evidence the merchant has since replaced will present itself
 * as current, and the auto-save gate will read a number that describes a case
 * that no longer exists.
 *
 * ── WHAT COUNTS AS RESULT-BEARING ─────────────────────────────────────
 *
 * Exactly the inputs `deriveCaseAssessment` consumes, enumerated rather than
 * summarised, because a summary is where the next silent divergence hides:
 *
 *   1. `model.reason`                — picks the template AND the reason family
 *   2. `model.modelVersion`          — the derivation's own shape
 *   3. `model.definitionRegistryVersion` — relevance/citation rules
 *   4. per field, in a STABLE order:
 *        `fieldKey` · `relevance` · `status.{applicable,available,waived,
 *        blocking,required,satisfied}` · record count · each record's
 *        `validity.state`, `quality`, `citation.eligibility`, and its
 *        normalized `payload`
 *   5. the resolved gate set — each of the five gates as either its provided
 *      value or its `notProvided` reason. `gateProvided(null)` and
 *      `gateNotProvided("order_not_loaded")` MUST hash differently: they are
 *      the pair whose conflation let the browser show Strong on a case the
 *      server had capped at Moderate.
 *
 * Note 4 includes the PAYLOAD. `calculateCaseStrength` runs the categorizer
 * over payloads, so an AVS payload that changes from `Y` to `N` changes the
 * band without changing a single status flag. A hash over statuses alone
 * would call that snapshot fresh.
 *
 * DELIBERATELY EXCLUDED: `derivedFrom.packId`, `evidenceItemIds`, any
 * timestamp, and `nonEvidence.operational.*`. None of them can change the
 * assessment, and hashing them would invalidate snapshots on every rebuild —
 * a false-stale is not "safe", it is a fleet that permanently needs
 * recalculation and therefore never files.
 *
 * `nonEvidence.coverage` IS hashed, because it feeds the coverage gate.
 */

import { createHash } from "crypto";
import type { CaseGateAssessment } from "@/lib/argument/caseGateAssessment";
import type { EvidencePayloadSource } from "@/lib/argument/caseStrength";
import type {
  CaseAssessmentSnapshot,
  CompletenessSnapshot,
  GateDecision,
  InputHash,
  SnapshotFreshness,
} from "@/lib/pipeline/contracts";
import { deriveCaseAssessment, SCORING_POLICY_VERSION } from "./assessment";
import { deriveCompletenessSnapshot } from "./completenessSnapshot";
import type { CaseEvidenceModel } from "./types";

/**
 * The SHAPE version of the persisted snapshot. Distinct from
 * `freshness.policyVersion` (the rules) and from `model.modelVersion` (what
 * evidence exists). Bump when a consumer reading an old row would
 * misinterpret it.
 */
export const ASSESSMENT_VERSION = 1;

/**
 * The rules applied. A bump invalidates every persisted snapshot even when
 * the inputs are byte-identical — which is the correct behaviour and the
 * reason `policyVersion` is not folded into the hash.
 *
 * Derived from `SCORING_POLICY_VERSION` so a scoring-policy bump cannot be
 * made without also invalidating assessments. Completeness has no separate
 * policy version today; if it gains one, combine it here rather than adding
 * a second freshness field.
 */
export const ASSESSMENT_POLICY_VERSION = SCORING_POLICY_VERSION;

/* ── canonical JSON ────────────────────────────────────────────────── */

/**
 * Deterministic serialization: object keys sorted at every depth, arrays
 * left in their given order (order is meaningful for records, and the caller
 * sorts them before we get here).
 *
 * `undefined` and `null` are normalized to the SAME token deliberately —
 * `{ a: undefined }` and `{ a: null }` mean the same thing to every consumer
 * in this codebase, and letting them hash differently would produce spurious
 * staleness the moment a collector switched between the two spellings.
 */
function canonical(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = canonical(src[key]);
    return out;
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

/* ── gate fingerprint ──────────────────────────────────────────────── */

/**
 * The five gates as the scorer will actually read them.
 *
 * `CaseGateAssessment` collapses `GateSource<T>` down to `T | null` plus a
 * `notProvided` record. Both halves are hashed: the VALUE decides the band,
 * and the NOT-PROVIDED reason decides whether a later call site that CAN see
 * the gate should be treated as computing something different. Two snapshots
 * that scored identically for different reasons are not interchangeable.
 */
function gateFingerprint(
  gates: CaseGateAssessment | PersistedGateFingerprint,
): unknown {
  const g = gates as unknown as Record<string, unknown>;
  return {
    coverage: g.coverage ?? null,
    fatalLoss: g.fatalLoss ?? null,
    riskWeakness: g.riskWeakness ?? null,
    nameMismatch: g.nameMismatch ?? null,
    creditAlreadyIssued: g.creditAlreadyIssued ?? null,
    notProvided: g.notProvided ?? null,
  };
}

/* ── payload fingerprint ───────────────────────────────────────────── */

/**
 * The payloads the scorer's categorizer can read, keyed by field.
 *
 * Both `EvidencePayloadSource` forms reduce to the same thing — the set of
 * (field → payload) pairs a categorizer could resolve — so the fingerprint is
 * form-independent. That matters: `buildPack` passes the `list` form and the
 * workspace route passes the `byField` form for the SAME case, and a
 * form-sensitive hash would report every case stale on the other surface.
 */
function payloadFingerprint(
  source: EvidencePayloadSource | undefined,
  fieldKeys: readonly string[],
): unknown {
  if (!source) return null;
  const out: Record<string, unknown> = {};
  for (const fieldKey of [...fieldKeys].sort()) {
    let payload: unknown = null;
    if (source.kind === "byField") {
      payload = source.map[fieldKey]?.payload ?? null;
    } else {
      for (const item of source.items) {
        const fields = (item.payload?.fieldsProvided as string[] | undefined) ?? [];
        if (fields.includes(fieldKey)) {
          payload = item.payload ?? null;
          break;
        }
      }
    }
    if (payload !== null && payload !== undefined) out[fieldKey] = payload;
  }
  return out;
}

/* ── model fingerprint ─────────────────────────────────────────────── */

function modelFingerprint(model: CaseEvidenceModel): unknown {
  const fields = Object.values(model.fields)
    .slice()
    .sort((a, b) => (a.fieldKey < b.fieldKey ? -1 : a.fieldKey > b.fieldKey ? 1 : 0))
    .map((summary) => ({
      fieldKey: summary.fieldKey,
      relevance: summary.relevance,
      // `waived` is reduced to a boolean on purpose: WHO waived it and WHEN
      // cannot move a score, and hashing the timestamp would make every
      // re-read of a waived field look like a new input.
      status: {
        applicable: summary.status.applicable,
        available: summary.status.available,
        required: summary.status.required,
        blocking: summary.status.blocking,
        satisfied: summary.status.satisfied,
        waived: summary.status.waived !== null,
      },
      merchantOverride: summary.merchantOverride,
      quality: summary.quality,
      representativeId: summary.representativeId,
      citableIds: [...summary.citableIds].sort(),
      records: summary.records
        .slice()
        .sort((a, b) => (a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0))
        .map((record) => ({
          recordId: record.recordId,
          validity: record.validity.state,
          quality: record.quality,
          citation: record.citation.eligibility,
          payload: record.payload,
        })),
    }));

  return {
    reason: model.reason,
    modelVersion: model.modelVersion,
    definitionRegistryVersion: model.definitionRegistryVersion,
    // Coverage feeds the coverage gate. `riskSignals` and `disputeMetadata`
    // are carried because a reason-code module keys off networkReasonCode.
    coverage: model.nonEvidence.coverage,
    disputeMetadata: model.nonEvidence.disputeMetadata,
    fields,
  };
}

/* ── the hash ──────────────────────────────────────────────────────── */

/**
 * The gate half of the hash, as it can be PERSISTED and read back.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * The input hash covers model + gates + payloads. A reader can rebuild the
 * model and the payloads from `pack_json`; it cannot rebuild the GATES,
 * because three of the five are derived from the Shopify order and only
 * `buildPack` loads it. Without them a reader has two bad options: hash a
 * different gate set — which reports every snapshot stale — or skip the hash
 * and compare the snapshot against itself, which detects nothing.
 *
 * So the writer persists exactly the fields the fingerprint reads. The gates
 * term is then CONSTANT between write and read, which is correct rather than
 * convenient: a reader that cannot see the order also cannot observe a gate
 * changing, and claiming otherwise would be the `order_not_loaded` lie in a
 * new place. What the reader CAN observe — the evidence moving underneath the
 * snapshot — is exactly what the model and payload terms carry.
 *
 * Plain data, no brand. The brand on `CaseGateAssessment` stops a hand-rolled
 * literal reaching the SCORER; nothing here is ever scored with.
 */
export interface PersistedGateFingerprint {
  coverage: unknown;
  fatalLoss: unknown;
  riskWeakness: unknown;
  nameMismatch: unknown;
  creditAlreadyIssued: unknown;
  notProvided: unknown;
}

/**
 * The gate fields to persist beside a snapshot, taken from the real gates.
 *
 * Deliberately produced by the SAME function the hash uses, so the persisted
 * value and the hashed value cannot drift into two shapes.
 */
export function persistableGateFingerprint(
  gates: CaseGateAssessment,
): PersistedGateFingerprint {
  return gateFingerprint(gates) as PersistedGateFingerprint;
}

/**
 * Read a persisted fingerprint back, or `null` when it is absent/malformed.
 *
 * `null` propagates to "no current hash can be reconstructed", which
 * `projectMerchantAssessment` renders as `needsRecalculation`. Guessing a
 * default here would manufacture a hash that matches nothing, reporting a
 * fresh snapshot stale, or — worse, if the default happened to match —
 * reporting a stale one fresh.
 */
export function readPersistedGateFingerprint(
  value: unknown,
): PersistedGateFingerprint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const keys = [
    "coverage",
    "fatalLoss",
    "riskWeakness",
    "nameMismatch",
    "creditAlreadyIssued",
    "notProvided",
  ] as const;
  // Every key must be PRESENT — `null` is a meaningful value here ("no such
  // gate"), so a missing key is a different thing from a null one and must
  // not be coerced into it.
  for (const k of keys) {
    if (!(k in v)) return null;
  }
  return {
    coverage: v.coverage ?? null,
    fatalLoss: v.fatalLoss ?? null,
    riskWeakness: v.riskWeakness ?? null,
    nameMismatch: v.nameMismatch ?? null,
    creditAlreadyIssued: v.creditAlreadyIssued ?? null,
    notProvided: v.notProvided ?? null,
  };
}

export interface AssessmentInputs {
  model: CaseEvidenceModel;
  /**
   * The live gates at write time, or the persisted fingerprint at read time.
   *
   * ONE hash function, two callers — `gateFingerprint` reads plain fields and
   * never touches the brand, so the writer's branded object and the reader's
   * persisted record produce byte-identical terms. A second
   * `computeHashFromParts` would be a second hash, which is the divergence
   * this whole layer exists to end.
   */
  gates: CaseGateAssessment | PersistedGateFingerprint;
  payloadSource: EvidencePayloadSource | undefined;
}

/**
 * The single input hash for `CaseAssessmentSnapshot`.
 *
 * Opaque by contract: never parse it, never order by it, never compare
 * substrings. The only legal operation is equality, and only through
 * `evaluateFreshness`.
 */
export function computeAssessmentInputHash(inputs: AssessmentInputs): InputHash {
  const fieldKeys = Object.values(inputs.model.fields).map((f) => f.fieldKey);
  return sha256({
    v: 1,
    model: modelFingerprint(inputs.model),
    gates: gateFingerprint(inputs.gates),
    payloads: payloadFingerprint(inputs.payloadSource, fieldKeys),
  });
}

/**
 * WHICH of the three terms moved — for diagnosis only, never for a decision.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * `evaluateFreshness` collapses model + gates + payloads into ONE equality,
 * so a mismatch says only "something changed". On 2026-09-01 a merchant was
 * shown "the evidence on this case changed after it was last assessed" on a
 * case whose snapshot re-derived byte-identically from `pack_json` — and the
 * composite hash could not say which half of the comparison was lying. The
 * whole investigation was spent reconstructing, by hand, what this function
 * returns in one line.
 *
 * Per-term SUB-HASHES, not the terms themselves: a term is the full evidence
 * payload for the case, and this value reaches a log. A 16-char prefix is
 * enough to say "the model term moved and the other two did not", which is
 * the only question being asked, and it cannot leak merchant content.
 *
 * NOT A SECOND HASH. It calls the same three private fingerprint functions
 * `computeAssessmentInputHash` calls, so it cannot drift from the predicate it
 * explains. Nothing branches on the result — `evaluateFreshness` remains the
 * one freshness authority.
 */
export interface AssessmentHashTermDigests {
  model: string;
  gates: string;
  payloads: string;
}

export function assessmentInputHashTerms(
  inputs: AssessmentInputs,
): AssessmentHashTermDigests {
  const fieldKeys = Object.values(inputs.model.fields).map((f) => f.fieldKey);
  const short = (v: unknown) => sha256(v).slice(0, 16);
  return {
    model: short(modelFingerprint(inputs.model)),
    gates: short(gateFingerprint(inputs.gates)),
    payloads: short(payloadFingerprint(inputs.payloadSource, fieldKeys)),
  };
}

/* ── the snapshot ──────────────────────────────────────────────────── */

/**
 * Build the persisted snapshot.
 *
 * `now` is injected rather than read from the clock so a test can pin it —
 * and, more importantly, so nobody is tempted to make freshness depend on it.
 * It lands in `computedAt`, which is audit-only.
 *
 * STRENGTH AND COMPLETENESS ARE COMPUTED SEPARATELY HERE, and that is not an
 * implementation detail. `deriveCaseAssessment` already runs them off two
 * different checklist projections; this function re-derives completeness
 * through `deriveCompletenessSnapshot` so there is a named, independently
 * testable entry point that takes NO strength input at all. Nothing in this
 * file reads `strength` to produce `completeness` or the reverse.
 */
export function buildCaseAssessmentSnapshot(args: {
  caseId: string;
  model: CaseEvidenceModel;
  gates: CaseGateAssessment;
  payloadSource: EvidencePayloadSource | undefined;
  /**
   * How many `review_required` items the case carries (contract revision 1).
   *
   * PASSED IN, never derived here. The count is the argument plan's
   * observation (layer 3, Agent B) and this module is layer 2 — deriving it
   * would make the assessment depend on the plan, inverting the layering. A
   * caller that has no plan yet passes nothing and gets 0, which is the honest
   * reading of "no plan has excluded anything".
   */
  reviewRequiredCount?: number;
  /** ISO-8601. Audit only. */
  now: string;
}): CaseAssessmentSnapshot {
  const { caseId, model, gates, payloadSource, now } = args;
  const derived = deriveCaseAssessment({ model, gates, payloadSource });
  const completeness: CompletenessSnapshot = deriveCompletenessSnapshot(model);

  const freshness: SnapshotFreshness = {
    inputHash: computeAssessmentInputHash({ model, gates, payloadSource }),
    policyVersion: ASSESSMENT_POLICY_VERSION,
    computedAt: now,
  };

  return {
    caseId,
    assessmentVersion: ASSESSMENT_VERSION,
    strength: derived.strength,
    completeness,
    gateDecision: resolveGateDecision(gates),
    reviewRequiredCount: args.reviewRequiredCount ?? 0,
    modelVersion: model.modelVersion,
    freshness,
  };
}

/**
 * `gateDecision` — WHICH gate already decided the case, when one has.
 *
 * CONTRACT REVISION 1 replaced the boolean `gateDecided` this function used to
 * return. The boolean was a real loss: coverage and fatal-loss are not
 * interchangeable. Coverage BEATS fatal-loss, they emit different reason codes
 * (`coverage_active` vs `fatal_loss`), and the fatal-loss reason may never
 * reach bank-facing text while a coverage status may be shown to the merchant.
 * A downstream reader holding only `true` cannot honour any of that.
 *
 * Read from the gate set, never re-derived from the model: `COVERED_STATUSES`
 * stays exactly `{PROTECTED, ACTIVE}` and lives in `coverageSource.ts`, and a
 * second predicate here would be a second place for it to drift. Coverage is
 * tested FIRST, and now the order is observable in the return value rather than
 * only in this comment.
 *
 * A gate that was never looked at (`gateNotProvided`) is NOT "decided".
 * Collapsing "nobody looked" into "no gate" is the exact conflation
 * `CaseGateAssessment` exists to prevent.
 */
export function resolveGateDecision(gates: CaseGateAssessment): GateDecision {
  const g = gates as unknown as {
    coverage: { state?: string | null } | null;
    fatalLoss: { triggered?: boolean } | null;
    returnedToSender: { triggered?: boolean } | null;
  };
  if (g.coverage?.state === "covered_shopify") return "coverage";
  if (g.fatalLoss?.triggered === true) return "fatal_loss";
  if (g.returnedToSender?.triggered === true) return "returned_to_sender";
  return null;
}


/* ── usability ─────────────────────────────────────────────────────── */

/**
 * The ONE answer to "may this persisted snapshot be used at all?"
 *
 * ── WHY IT HAS TO BE ONE PREDICATE ────────────────────────────────────
 *
 * Three surfaces need it — the list's strength pill, the list's `?strength=`
 * pre-filter, and the P-7 gate — and each had its own partial version. The
 * costs were not symmetric:
 *
 *   * the pill checked policy version and `rebuild_pending`; the FILTER
 *     checked neither, so `?strength=strong` returned disputes the list then
 *     rendered as unassessed — a filter and a display disagreeing about one
 *     row;
 *   * the P-7 branch checked only that a canonical score was a number, so a
 *     STALE canonical score could be judged against the calibrated 60 — the
 *     illegal pairing, arriving through a different door than the one
 *     `resolveEffectiveCompleteness` closed.
 *
 * Four conditions, checked together, or the snapshot is not usable:
 *
 *   1. it exists;
 *   2. `assessmentVersion` is the current shape;
 *   3. `freshness.policyVersion` is the current policy;
 *   4. the pack is not flagged `rebuild_pending`.
 *
 * NOT included: the input-hash comparison. Reconstructing that needs the
 * model, which the list deliberately does not load and the gate has no reason
 * to. This predicate is the cheap, always-checkable floor; the workspace route
 * additionally reconstructs the hash. Both can only WITHHOLD a verdict, never
 * manufacture one, so a surface that can afford less is stricter than one that
 * can afford more — never looser.
 */
export interface SnapshotUsabilityInput {
  snapshot: unknown;
  /** `evidence_packs.rebuild_pending`. */
  rebuildPending: unknown;
}

export type SnapshotUnusableReason =
  | "absent"
  | "assessment_version"
  | "policy_version"
  | "rebuild_pending"
  | "missing_strength";

export type SnapshotUsability =
  | { usable: true; strength: CaseAssessmentSnapshot["strength"] }
  | { usable: false; reason: SnapshotUnusableReason };

/**
 * `strength.overall` is the field every reader renders, so its ABSENCE is a
 * distinct unusable reason rather than a silent `undefined` reaching a pill.
 * A snapshot written by a future shape with a renamed field would otherwise
 * pass the version checks and render nothing.
 */
export function assessmentSnapshotUsability(
  input: SnapshotUsabilityInput,
): SnapshotUsability {
  if (input.rebuildPending === true) return { usable: false, reason: "rebuild_pending" };

  const snap = input.snapshot;
  if (!snap || typeof snap !== "object" || Array.isArray(snap)) {
    return { usable: false, reason: "absent" };
  }
  const s = snap as Partial<CaseAssessmentSnapshot>;

  if (s.assessmentVersion !== ASSESSMENT_VERSION) {
    return { usable: false, reason: "assessment_version" };
  }
  if (s.freshness?.policyVersion !== ASSESSMENT_POLICY_VERSION) {
    return { usable: false, reason: "policy_version" };
  }

  const strength = s.strength;
  if (!strength || typeof strength !== "object" || typeof strength.overall !== "string") {
    return { usable: false, reason: "missing_strength" };
  }
  return { usable: true, strength: strength as CaseAssessmentSnapshot["strength"] };
}
