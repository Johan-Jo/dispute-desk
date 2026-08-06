/**
 * TEST-ONLY gate fixture for `calculateCaseStrength`.
 *
 * `CaseGateAssessment` is a required, branded object with required members, so
 * adding a sixth gate breaks every call site at compile time — the alarm that
 * was missing when the credit-already-issued floor was wired into `buildPack`
 * alone (blume-box 162042cd, 2026-08-01).
 *
 * That guarantee only holds while production call sites STATE each gate. If
 * `NO_GATES` were importable from `lib/`, a new gate would break the constant
 * and nothing else, and every site using the shorthand would keep compiling
 * with the gate silently absent — the original defect, one level up. Hence:
 * this lives under `tests/`, and `lib/**` / `app/**` are barred from importing
 * it by the `no-restricted-imports` rule in `eslint.config.mjs`.
 *
 * Tests may share it because their intent is different: a test asserting
 * gate-free scoring wants ALL gates off, which is a property of the test, not
 * an unrecorded decision about a real dispute. That is exactly what
 * `gate_free_query` means, so the fixture goes through the canonical builder
 * like everything else — it does not fabricate an assessment.
 *
 * See `lib/argument/caseGateAssessment.ts` and
 * `docs/plans/case-strength-gates-object.plan.md` §2.
 */
import {
  buildCaseGateAssessment,
  gateNotProvided,
  gateProvided,
  type CaseGateAssessment,
  type CaseGateSources,
} from "@/lib/argument/caseGateAssessment";

/** The gate values a test may override, in the shape the scorer reads. */
type GateValues = {
  [K in keyof CaseGateAssessment as K extends keyof CaseGateSources ? K : never]: CaseGateAssessment[K];
};

const GATE_KEYS = [
  "coverage",
  "fatalLoss",
  "riskWeakness",
  "nameMismatch",
  "creditAlreadyIssued",
] as const satisfies readonly (keyof CaseGateSources)[];

/**
 * `NO_GATES` with specific gates overridden. A key present in `overrides` is
 * stated as provided (even when its value is `null`); every other key is
 * stated as `gate_free_query`.
 */
export function gatesWith(overrides: Partial<GateValues>): CaseGateAssessment {
  const sources: Record<string, unknown> = {};
  for (const key of GATE_KEYS) {
    sources[key] = Object.prototype.hasOwnProperty.call(overrides, key)
      ? gateProvided((overrides as Record<string, unknown>)[key] ?? null)
      : gateNotProvided("gate_free_query");
  }
  return buildCaseGateAssessment(sources as unknown as CaseGateSources);
}

/** Every gate off. Frozen: a shared mutable fixture is its own footgun, and
 *  one test mutating it would silently re-score the others. */
export const NO_GATES: Readonly<CaseGateAssessment> = Object.freeze(gatesWith({}));
