/**
 * COMPILE-TIME invariant for `calculateCaseStrength`'s gates object.
 *
 * This file is never executed. It is not a vitest test (vitest does not
 * typecheck), it exports nothing, and it only exists so that
 * `npx tsc --noEmit` — and therefore `npm run build` and CI — fails if
 * the gates ever stop being required. It replaces
 * `tests/unit/caseStrengthGateParity.test.ts`, a text-level guard that
 * grepped call sites for the string `creditAlreadyIssued` because the
 * type system could not be asked the question.
 *
 * Each `@ts-expect-error` below is an ASSERTION: if the line ever stops
 * being an error, TypeScript reports the unused directive and the build
 * fails. Both directions are pinned — a missing field, and the old
 * positional shape — because a half-finished migration would slip past
 * either one alone.
 *
 * IF THIS FILE STOPS BEING COMPILED, IT SILENTLY ASSERTS NOTHING.
 * `tsconfig.json` includes every .ts file in the repo and excludes only
 * `node_modules`, `docs/figma-reference` and `archive`, so the `tests`
 * tree is compiled today. If that changes, or this file moves, confirm:
 *   npx tsc --noEmit --listFiles | grep caseStrengthGates.typecheck
 *
 * See `docs/plans/case-strength-gates-object.plan.md` §6.2.
 */
import {
  calculateCaseStrength,
  computeContributions,
  type CaseStrengthGates,
} from "@/lib/argument/caseStrength";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";

const checklist: ChecklistItemV2[] = [];
const reason: string | null = null;
const payloadSource = undefined;

/* ── 1. Every gate is required — omitting one must not compile ── */

// @ts-expect-error creditAlreadyIssued is required
const _missingGate: CaseStrengthGates = {
  coverage: null,
  fatalLoss: null,
  riskWeakness: null,
  nameMismatch: null,
};

/* ── 2. The gates object itself is required ── */

// @ts-expect-error the gates object is required
calculateCaseStrength(checklist, reason, payloadSource);

/* ── 3. The old positional gate arguments are gone ── */

// @ts-expect-error positional gate arguments are no longer accepted
calculateCaseStrength(checklist, reason, payloadSource, undefined, undefined);

/* ── 4. Same contract for computeContributions ── */

// @ts-expect-error reason is required (it may be null, but must be stated)
computeContributions({ checklist, payloadSource });

// @ts-expect-error positional arguments are no longer accepted
computeContributions(checklist, payloadSource, reason);

/* ── The passing shapes, so a typo in the assertions above is visible ── */

const _ok = calculateCaseStrength(checklist, reason, payloadSource, {
  coverage: null,
  fatalLoss: null,
  riskWeakness: null,
  nameMismatch: null,
  creditAlreadyIssued: null,
});
const _okContributions = computeContributions({ checklist, payloadSource, reason });

void _missingGate;
void _ok;
void _okContributions;
