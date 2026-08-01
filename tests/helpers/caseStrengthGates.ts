/**
 * TEST-ONLY gate fixture for `calculateCaseStrength`.
 *
 * `CaseStrengthGates` is a required object with required fields so that
 * adding a sixth gate breaks every call site at compile time — the alarm
 * that was missing when the credit-already-issued floor was wired into
 * `buildPack` alone (blume-box 162042cd, 2026-08-01).
 *
 * That guarantee only holds while production call sites write the object
 * out literally. If `NO_GATES` were importable from `lib/`, a new gate
 * would break the constant and nothing else, and every site using the
 * shorthand would keep compiling with the gate silently absent — the
 * original defect, one level up. Hence: this lives under `tests/`, and
 * `lib/**` / `app/**` are barred from importing it by the
 * `no-restricted-imports` rule in `eslint.config.mjs`.
 *
 * Tests may share it because their intent is different: a test asserting
 * gate-free scoring wants ALL gates off, which is a property of the
 * test, not an unrecorded decision about a real dispute.
 *
 * See `docs/plans/case-strength-gates-object.plan.md` §2.
 */
import type { CaseStrengthGates } from "@/lib/argument/caseStrength";

/** Every gate off. Frozen: a shared mutable fixture is its own footgun,
 *  and one test mutating it would silently re-score the others. */
export const NO_GATES: Readonly<CaseStrengthGates> = Object.freeze({
  coverage: null,
  fatalLoss: null,
  riskWeakness: null,
  nameMismatch: null,
  creditAlreadyIssued: null,
});

/** `NO_GATES` with specific gates overridden. Spreads into a fresh
 *  object, so the frozen fixture is never mutated. */
export function gatesWith(overrides: Partial<CaseStrengthGates>): CaseStrengthGates {
  return { ...NO_GATES, ...overrides };
}
