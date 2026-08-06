/**
 * COMPILE-TIME invariant for the canonical `CaseGateAssessment`.
 *
 * This file is never executed. It is not a vitest test (vitest does not
 * typecheck), it exports nothing, and it only exists so that
 * `npx tsc --noEmit` — and therefore `npm run build` and CI — fails if
 * the gate contract ever weakens. It replaces
 * `tests/unit/caseStrengthGateParity.test.ts`, a text-level guard that
 * grepped call sites for the string `creditAlreadyIssued` because the
 * type system could not be asked the question.
 *
 * Each `@ts-expect-error` below is an ASSERTION: if the line ever stops
 * being an error, TypeScript reports the unused directive and the build
 * fails. Four directions are pinned, because a half-finished migration
 * would slip past any one alone:
 *
 *   1. a gate cannot be omitted from the sources;
 *   2. the assessment argument itself cannot be omitted;
 *   3. the old positional gate arguments stay gone;
 *   4. a hand-rolled object literal cannot reach the scorer — only
 *      `buildCaseGateAssessment` produces a `CaseGateAssessment`. This is
 *      the one that structurally retires the four divergent gate literals
 *      the 2026-08-05 audit found.
 *
 * IF THIS FILE STOPS BEING COMPILED, IT SILENTLY ASSERTS NOTHING.
 * `tsconfig.json` includes every .ts file in the repo and excludes only
 * `node_modules`, `docs/figma-reference` and `archive`, so the `tests`
 * tree is compiled today. If that changes, or this file moves, confirm:
 *   npx tsc --noEmit --listFiles | grep caseStrengthGates.typecheck
 *
 * See `lib/argument/caseGateAssessment.ts` and
 * `docs/plans/case-strength-gates-object.plan.md` §6.2.
 */
import {
  calculateCaseStrength,
  computeContributions,
} from "@/lib/argument/caseStrength";
import {
  buildCaseGateAssessment,
  gateNotProvided,
  gateProvided,
  type CaseGateAssessment,
  type CaseGateSources,
} from "@/lib/argument/caseGateAssessment";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";

const checklist: ChecklistItemV2[] = [];
const reason: string | null = null;
const payloadSource = undefined;

/* ── 1. Every gate must be STATED — omitting one must not compile ── */

// @ts-expect-error creditAlreadyIssued is required
const _missingGate: CaseGateSources = {
  coverage: gateNotProvided("gate_free_query"),
  fatalLoss: gateNotProvided("gate_free_query"),
  riskWeakness: gateNotProvided("gate_free_query"),
  nameMismatch: gateNotProvided("gate_free_query"),
};

/* ── 2. The assessment argument is required ── */

// @ts-expect-error the gate assessment is required
calculateCaseStrength(checklist, reason, payloadSource);

/* ── 3. The old positional gate arguments are gone ── */

// @ts-expect-error positional gate arguments are no longer accepted
calculateCaseStrength(checklist, reason, payloadSource, undefined, undefined);

/* ── 4. Only the canonical builder produces an assessment ──
 *
 * The five-nullable-fields literal below is EXACTLY what each of the four
 * production call sites used to write by hand. It must not typecheck. */

// @ts-expect-error a hand-rolled gate literal is not a CaseGateAssessment
const _handRolled: CaseGateAssessment = {
  coverage: null,
  fatalLoss: null,
  riskWeakness: null,
  nameMismatch: null,
  creditAlreadyIssued: null,
  notProvided: {},
};

// @ts-expect-error the scorer accepts no hand-rolled gate set either
calculateCaseStrength(checklist, reason, payloadSource, {
  coverage: null,
  fatalLoss: null,
  riskWeakness: null,
  nameMismatch: null,
  creditAlreadyIssued: null,
  notProvided: {},
});

/* ── 5. Same contract for computeContributions ── */

// @ts-expect-error reason is required (it may be null, but must be stated)
computeContributions({ checklist, payloadSource });

// @ts-expect-error positional arguments are no longer accepted
computeContributions(checklist, payloadSource, reason);

/* ── The passing shapes, so a typo in the assertions above is visible ── */

const _ok = calculateCaseStrength(
  checklist,
  reason,
  payloadSource,
  buildCaseGateAssessment({
    coverage: gateProvided(null),
    fatalLoss: gateNotProvided("order_not_loaded"),
    riskWeakness: gateNotProvided("order_not_loaded"),
    nameMismatch: gateNotProvided("not_shipped_to_client"),
    creditAlreadyIssued: gateNotProvided("not_persisted_in_pack"),
  }),
);
const _okContributions = computeContributions({ checklist, payloadSource, reason });

void _missingGate;
void _handRolled;
void _ok;
void _okContributions;
