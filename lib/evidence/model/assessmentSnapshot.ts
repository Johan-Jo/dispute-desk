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
function gateFingerprint(gates: CaseGateAssessment): unknown {
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

export interface AssessmentInputs {
  model: CaseEvidenceModel;
  gates: CaseGateAssessment;
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
    gateDecided: isGateDecided(gates),
    freshness,
  };
}

/**
 * `gateDecided` — coverage or fatal-loss has already decided the case.
 *
 * Read from the gate set, never re-derived from the model: `COVERED_STATUSES`
 * stays exactly `{PROTECTED, ACTIVE}` and lives in `coverageSource.ts`, and a
 * second predicate here would be a second place for it to drift. Coverage
 * beats fatal-loss, which is why coverage is tested first even though the
 * boolean cannot tell them apart — the ORDER is the documented rule and the
 * next person to add a third gate needs to see it.
 *
 * A gate that was never looked at (`gateNotProvided`) is NOT "decided".
 * Collapsing "nobody looked" into "no gate" is the exact conflation
 * `CaseGateAssessment` exists to prevent.
 */
export function isGateDecided(gates: CaseGateAssessment): boolean {
  const g = gates as unknown as {
    coverage: { state?: string | null } | null;
    fatalLoss: { triggered?: boolean } | null;
  };
  if (g.coverage?.state === "covered_shopify") return true;
  if (g.fatalLoss?.triggered === true) return true;
  return false;
}
