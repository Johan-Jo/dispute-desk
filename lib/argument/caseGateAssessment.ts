/**
 * `CaseGateAssessment` — the one canonical gate contract the scorer accepts.
 *
 * Slice 1 of the canonical case pipeline (decision sheet 2026-08-06, P-1;
 * execution plan §"1 — Canonical gates and scoring").
 *
 * ── What this closes ──────────────────────────────────────────────────
 *
 * The gates already arrived as a REQUIRED object with REQUIRED members
 * (2026-08-01, `docs/plans/case-strength-gates-object.plan.md`), so a new
 * gate has broken every call site at compile time since then. That fixed
 * *omission*. It did not fix *conflation*: every member is `T | null`, and
 * `null` was being written by four independent object literals to mean two
 * completely different things —
 *
 *   "this case has no such gate"        (buildPack: the order says no fatal loss)
 *   "this call site cannot see the gate" (the list route never loads the order)
 *
 * — with nothing in the type, and nothing at the call site, telling them
 * apart. The 2026-08-05 audit measured the consequence: on a fraud case with
 * a cardholder-name mismatch the client scored Strong while the server capped
 * Moderate, on one screen, because the client literal wrote
 * `nameMismatch: null` for the second reason and the server wrote a real
 * value (`docs/evidence-model/p4/legacy-removal-inventory.md`, the four
 * gate-set variants).
 *
 * ── How ───────────────────────────────────────────────────────────────
 *
 * 1. `CaseGateSources` requires every gate to be STATED, as either
 *    `gateProvided(value)` — where `null` now unambiguously means "this case
 *    has no such gate" — or `gateNotProvided(reason)`, a named, auditable
 *    "this call site cannot see it". A gate cannot disappear through an
 *    optional property, a default, or a partial object.
 * 2. `CaseGateAssessment` is BRANDED. An object literal does not satisfy it;
 *    only `buildCaseGateAssessment()` produces one. So no caller — present or
 *    future — can hand the scorer a hand-rolled gate set, which is what the
 *    four divergent literals were.
 * 3. The scored values are unchanged: `buildCaseGateAssessment` collapses
 *    both states back to the same `T | null` the scorer has always read.
 *    Introducing this contract is behaviour-preserving by construction; the
 *    only approved behavioural change in Slice 1 is P-1, which lives in
 *    `lib/evidence/model/assessment.ts`.
 *
 * The brand is TYPE-ONLY — the runtime object carries no extra key beyond
 * `notProvided`, so nothing that serialises a gate set changes shape.
 */

import type {
  CaseCoverageInput,
  CaseCreditAlreadyIssuedInput,
  CaseFatalLossInput,
  CaseNameMismatchInput,
  CaseRiskWeaknessInput,
} from "./caseStrength";

/**
 * Why a gate carries no value AT THIS CALL SITE.
 *
 * This is a closed, repository-approved vocabulary on purpose: "I could not
 * see it" must be a statement someone chose, not a `null` that reads the same
 * as "the case does not have it". Add a member only with the same scrutiny as
 * adding a gate.
 */
export type GateNotProvidedReason =
  /** The site holds no Shopify order, and this gate is derived from one.
   *  `buildPack` owns those derivations and persists its verdict. */
  | "order_not_loaded"
  /** The site reads a persisted pack that carries no such block. */
  | "not_persisted_in_pack"
  /** Browser surface: the gate is server-derived and the API response does
   *  not ship it. */
  | "not_shipped_to_client"
  /** The caller is asking a deliberately gate-free counting question — "how
   *  many strong/moderate signals does the evidence itself carry" — where
   *  every gate is a verdict override that leaves those counts untouched. */
  | "gate_free_query";

/** One gate, as stated by the call site. */
export type GateSource<T> =
  | { readonly provided: true; readonly value: T | null }
  | { readonly provided: false; readonly reason: GateNotProvidedReason };

/** "This site derived the gate." `null` means the case has no such gate. */
export function gateProvided<T>(value: T | null): GateSource<T> {
  return { provided: true, value };
}

/** "This site cannot see the gate", with the reason on the record. */
export function gateNotProvided<T>(reason: GateNotProvidedReason): GateSource<T> {
  return { provided: false, reason };
}

/**
 * Every gate the scorer consults, each REQUIRED and each explicitly stated.
 *
 * A sixth gate added here breaks every call site at compile time — the alarm
 * that was missing when the credit-already-issued floor was wired into
 * `buildPack` alone (blume-box 162042cd, 2026-08-01) and again when only
 * three of four sites were repaired.
 */
export interface CaseGateSources {
  /** Coverage Gate (PRD §4). Highest-priority routing signal. */
  coverage: GateSource<CaseCoverageInput>;
  /** Fatal-loss Gate (PRD §5). Caps `overall` at "weak". */
  fatalLoss: GateSource<CaseFatalLossInput>;
  /** Risk-weakness Gate. Diagnostics only — never caps `overall`. */
  riskWeakness: GateSource<CaseRiskWeaknessInput>;
  /** Cardholder-name-mismatch Gate. Fraud family only; caps at "moderate". */
  nameMismatch: GateSource<CaseNameMismatchInput>;
  /** Credit-already-issued FLOOR, not a signal. */
  creditAlreadyIssued: GateSource<CaseCreditAlreadyIssuedInput>;
}

/** The gate keys, so the provenance record cannot drift from the contract. */
export type CaseGateKey = keyof CaseGateSources;

/** Type-only brand. Never present on the runtime object. */
declare const CANONICAL_GATE_ASSESSMENT: unique symbol;

/**
 * The scorer's gate input. Constructible ONLY through
 * `buildCaseGateAssessment` — an object literal is not assignable, which is
 * what keeps the four hand-rolled gate sets from coming back.
 */
export interface CaseGateAssessment {
  readonly coverage: CaseCoverageInput | null;
  readonly fatalLoss: CaseFatalLossInput | null;
  readonly riskWeakness: CaseRiskWeaknessInput | null;
  readonly nameMismatch: CaseNameMismatchInput | null;
  readonly creditAlreadyIssued: CaseCreditAlreadyIssuedInput | null;
  /**
   * Which gates the call site could not see, and why. Empty when the site
   * derived all five. Diagnostic — the scorer never reads it — but it is the
   * record that distinguishes "no fatal loss" from "nobody looked", which is
   * exactly the distinction the four literals lost.
   */
  readonly notProvided: Readonly<Partial<Record<CaseGateKey, GateNotProvidedReason>>>;
  readonly [CANONICAL_GATE_ASSESSMENT]: true;
}

/**
 * Every member of `CaseGateAssessment` EXCEPT the nominal brand.
 *
 * This exists so the builder can be type-checked against the full contract
 * before the brand is applied. The brand is the one thing a cast must supply,
 * and a cast is blind: `{...} as CaseGateAssessment` would have accepted an
 * object missing a newly-required member, which is the exact class of failure
 * — a new gate silently absent at a site that still compiles — that this whole
 * file exists to make impossible. Widening the cast to cover the data as well
 * as the brand reinstated it one level down, inside the builder.
 *
 * So: the builder annotates its result with THIS type (a real check), and
 * casts only to add the brand. Adding a required member to
 * `CaseGateAssessment` now breaks `buildCaseGateAssessment` itself until the
 * member is populated.
 */
export type CaseGateAssessmentFields = Omit<
  CaseGateAssessment,
  typeof CANONICAL_GATE_ASSESSMENT
>;

/**
 * The ONE way to produce a `CaseGateAssessment`.
 *
 * Behaviour-preserving: a stated gate scores exactly as its value, and an
 * unstated one scores exactly as `null` did before. The difference is that
 * the second case is now named and recorded rather than indistinguishable
 * from the first.
 */
export function buildCaseGateAssessment(sources: CaseGateSources): CaseGateAssessment {
  const notProvided: Partial<Record<CaseGateKey, GateNotProvidedReason>> = {};
  const resolve = <T>(key: CaseGateKey, source: GateSource<T>): T | null => {
    if (source.provided) return source.value;
    notProvided[key] = source.reason;
    return null;
  };
  // Fully checked against the contract MINUS the brand. Do not inline this
  // into the `return` — an annotated local is what makes a missing member an
  // error here rather than something the cast swallows.
  const assessment: CaseGateAssessmentFields = {
    coverage: resolve("coverage", sources.coverage),
    fatalLoss: resolve("fatalLoss", sources.fatalLoss),
    riskWeakness: resolve("riskWeakness", sources.riskWeakness),
    nameMismatch: resolve("nameMismatch", sources.nameMismatch),
    creditAlreadyIssued: resolve("creditAlreadyIssued", sources.creditAlreadyIssued),
    notProvided,
  };
  // The cast adds the nominal brand and nothing else. The brand is type-only,
  // so the runtime object is unchanged.
  return assessment as CaseGateAssessment;
}
