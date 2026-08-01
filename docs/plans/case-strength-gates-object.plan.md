# `calculateCaseStrength` — collapse the trailing optional gates

**Status:** IMPLEMENTED 2026-08-01 (scope B). Signature landed, all call sites migrated, `tests/unit/caseStrengthGateParity.test.ts` deleted, parity verified on 66 prod packs. See §8 for what shipped and the two deliberate behaviour changes.
**Raised:** 2026-08-01, after the fifth instance in one day of the same defect shape.
**Supersedes:** `tests/unit/caseStrengthGateParity.test.ts`, which is an explicitly weaker stopgap and should be deleted by this work.

---

## 1. The defect shape

```ts
export function calculateCaseStrength(
  checklist: ChecklistItemV2[],
  reason?: string | null,
  payloadSource?: EvidencePayloadSource,
  coverage?: CaseCoverageInput,
  fatalLoss?: CaseFatalLossInput,
  riskWeakness?: CaseRiskWeaknessInput,
  nameMismatch?: CaseNameMismatchInput,
  creditAlreadyIssued?: CaseCreditAlreadyIssuedInput,   // ← added 2026-08-01
): CaseStrengthResult
```

Five trailing optional gates. Adding a sixth and wiring it at one call site leaves every other call site compiling, running, and returning a **plausible wrong number**. There is no signal — not a type error, not a test failure, not a runtime warning.

### What it cost

On 2026-08-01 the credit-already-issued floor was added to `buildPack` only:

| Call site | Gate | Consequence |
|---|---|---|
| `lib/packs/buildPack.ts` | ✅ | scored **strong** → auto-submit filed evidence to Shopify → merchant emailed "Evidence submitted" |
| `app/api/disputes/[id]/workspace/route.ts` | ❌ | dispute page rendered **"Weak case"** |
| `app/(embedded)/…/useDisputeWorkspace.ts` | ❌ | "why this strength" copy + *"Add Delivery confirmation"* on an already-refunded order |
| `app/api/disputes/route.ts` | ❌ | list strength |

One half of the system filed a defence; the other half told the merchant the case was weak and advised work that could not change the argument. Both halves were "correct" against the signature they were compiled against.

The same shape produced four other errors the same day (absent `disputeFreeHistory` read as "clean"; a coverage comparison across two different scales; a claim time-scoped like a count; amounts compared across currencies). Each is a case of **absence silently resolving to a plausible value**. The signature is the one instance we can make structurally impossible.

---

## 2. Proposed signature

```ts
export interface CaseStrengthGates {
  coverage: CaseCoverageInput | null;
  fatalLoss: CaseFatalLossInput | null;
  riskWeakness: CaseRiskWeaknessInput | null;
  nameMismatch: CaseNameMismatchInput | null;
  creditAlreadyIssued: CaseCreditAlreadyIssuedInput | null;
}

export function calculateCaseStrength(
  checklist: ChecklistItemV2[],
  reason: string | null | undefined,
  payloadSource: EvidencePayloadSource | undefined,
  gates: CaseStrengthGates,          // REQUIRED
): CaseStrengthResult
```

Every field **required and explicitly nullable**. Not `Partial<>`, not optional — that would restore the hole. A caller with no data for a gate writes `null`, which is a decision on the record; a caller that forgets one does not compile.

Adding a sixth gate then breaks **every** call site at compile time, which is exactly the alarm that was missing.

### Production call sites write the object literally

No shorthand. Every absence is a decision recorded at the site that made it:

```ts
calculateCaseStrength(checklist, reason, payloadSource, {
  coverage: coverageInput(order),
  fatalLoss: null,
  riskWeakness: null,
  nameMismatch: null,
  creditAlreadyIssued: creditAlreadyIssuedInput(packRow?.pack_json),
});
```

**`NO_GATES` ships from a test helper (`tests/helpers/caseStrengthGates.ts`), never from `lib/`.** A production-importable shorthand rebuilds the same hole one level up: with it available, adding a sixth gate breaks only the shared constant — the four sites that matter keep compiling, and the guarantee claimed above stops being true. Tests may share a fixture because their intent is different: a test asserting gate-free scoring wants *all gates off*, not a per-case decision.

```ts
// tests/helpers/caseStrengthGates.ts — test-only
export const NO_GATES: Readonly<CaseStrengthGates> = Object.freeze({
  coverage: null,
  fatalLoss: null,
  riskWeakness: null,
  nameMismatch: null,
  creditAlreadyIssued: null,
});
```

Frozen unconditionally, not "deep-frozen in dev": the object is flat, so `Object.freeze` is the whole job, and an env-conditional freeze makes behaviour differ between dev and prod for no gain.

If a genuinely gate-free **production** pathway turns up during the migration, do not reach for a generic escape hatch — export a named constant for that pathway (`PREVIEW_ONLY_GATES`, or whatever it is) carrying a comment saying why no gate can apply, so the next gate addition still forces someone to revisit it. Cheap enforcement: an ESLint `no-restricted-imports` entry barring `tests/**` imports from `lib/**` and `app/**`.

**In-repo precedent:** `evaluateAutoSubmitGuards(input: AutoSubmitGuardInput)` already takes a single object. This aligns the two.

---

## 3. Migration — measured, not estimated

I previously guessed "~40 call sites of mechanical churn, several delicate". The actual counts:

| Shape | Count | Work |
|---|---|---|
| Production call sites | **4** | replace positional gates with the object |
| Test calls, 3 positional args only | **37** | append `, NO_GATES` + the helper import — mechanical, scriptable |
| Test calls passing gates positionally | **4** | restructure by hand |
| Definition + doc references | 3 | — |

So the delicate work is **4 test calls**, not "several dozen". Those live in `lib/argument/__tests__/nameMismatch.test.ts` and read:

```ts
calculateCaseStrength(checklist(), "FRAUDULENT", payloadSource,
  undefined, undefined, undefined, { triggered: true, … })
```

Three `undefined` placeholders to reach the fourth gate — the smell in its purest form, and the clearest argument for the change.

### Order of work

1. Add `CaseStrengthGates` (in `lib/`) + `NO_GATES` (in `tests/helpers/`); change the signature. Everything breaks — that is the point.
2. Fix the 4 production call sites first, deliberately, one at a time. These are the ones that matter.
3. Script the 37 trivial test appends; eyeball the diff.
4. Hand-convert the 4 gate-passing test calls.
5. Delete `tests/unit/caseStrengthGateParity.test.ts` — the type system now enforces what it approximated.

---

## 4. Scope decision needed

`computeContributions(checklist, payloadSource?, reason?)` and `calculateImprovement(checklist, reason, payloadSource?)` carry the same trailing-optional shape. `computeContributions` already has a comment warning that omitting `reason` makes the UI show a Strong pill the scorer counted as moderate — i.e. **the same failure mode has already been observed there**.

Options:

- **A — `calculateCaseStrength` only.** Smallest, fixes the one that caused a prod incident.
- **B — include `computeContributions`.** It has a documented instance of the same bug. Modest extra churn.
- **C — all three.** Most consistent, largest diff.

**Recommendation: B.** `calculateImprovement` takes no gates and its optional param is genuinely optional, so it does not share the defect.

### B, specified

Object for **all** inputs, not just a trailing bag — the problem here is not gates, it is two semantically meaningful optional values sitting side by side:

```ts
export interface ContributionInput {
  checklist: ChecklistItemV2[];
  payloadSource: EvidencePayloadSource | undefined;
  reason: string | null | undefined;
}

export function computeContributions(input: ContributionInput): CaseStrengthContributions
```

Every field **required**, values may be `undefined`/`null` — same rule as the gates object. Anything less and the documented `reason` omission stays possible.

The positional form is also actively misleading today: the two neighbouring helpers disagree on order — `computeContributions(checklist, payloadSource, reason)` vs `calculateImprovement(checklist, reason, payloadSource)`. Naming the fields removes a real trap, not a stylistic one.

**Migration impact (measured):**

| Shape | Where | Work |
|---|---|---|
| Production call | `app/(embedded)/…/useDisputeWorkspace.ts:1013` | 1 site, already passes all three — wrap in an object |
| Test calls | `lib/argument/__tests__/productFamilyStrength.test.ts:162,166` | 2 calls, both pass all three |
| **Inline copy** | `app/api/disputes/[id]/workspace/route.ts:752-788` | not a call site — a hand-copied reimplementation the type change cannot reach |

**The inline copy is a live defect, found while specifying this.** `route.ts:752` reimplements the dedupe-by-`signalId` loop but **omits the fraud-family `account_history` strong→moderate demotion** that `computeContributions` applies (`caseStrength.ts:959-962`). It never consults `reason` at all. So the dispute page can render a Strong "What supports your case" pill for prior-order history on a fraud dispute that the scorer counted as moderate — precisely the failure the source comment warns about, shipped, from a copy rather than an omitted argument.

Fold that route onto `computeContributions` as part of B. Note it is **not** a pure refactor: on fraud + `account_history` the pill legitimately moves Strong → Moderate. Call it out explicitly in the PR and expect the parity harness in §6 to flag exactly those cases — a difference there is the fix landing, not a regression. Every other difference is a defect.

---

## 5. Risks

- **Large mechanical diff.** Mitigated by doing production call sites by hand and scripting only the uniform 3-arg test appends.
- **A wrong `null` where real data existed.** The refactor makes omission explicit but cannot tell you a gate *should* have been populated. Mitigation: the replay harness in §6 — same inputs, same **whole** `CaseStrengthResult`, before and after.
- **Doing it carelessly.** This is a fragility fix; introducing a bug while making the code safer would be worse than the status quo. It wants a session where it is the only change in flight.

---

## 6. Verification

- `npx tsc --noEmit` — the real proof. Nothing compiles until every site is converted.
- `npm test` green, with **no assertion values changed**. If a test's expected strength changes, the refactor altered behaviour and something is wrong.

### 6.1 Parity harness — record on `master`, replay on the branch

"Recompute a sample" is not a procedure. This is:

1. **Record (on `master`).** A script pulls each sampled pack's scorer inputs — `checklist`, `payloadSource`, `reason`, and each gate input as the current call site derives it — plus the resulting `CaseStrengthResult`, and writes `{ disputeId, input, result }` to a fixture file. Read via `npm run db:query:dev -- --file scripts/sql/case-strength-parity-sample.sql` (never `tail` the output). The fixture holds merchant data: write it to the scratchpad, never commit it.
2. **Replay (on the branch).** Feed the recorded inputs through the new signature and deep-compare against the recorded results.

**Compared:** the entire `CaseStrengthResult` by deep equality — `overall`, `score`, `coveragePercent`, `strongCount`, `moderateCount`, `supportingCount`, `supportedClaims`, `totalClaims`, `strengthReasonI18n`, and the improvement token. Comparing `overall` alone would pass a refactor that silently changed contributions, caps, explanation copy, or the recommended next action while landing on the same label. Under scope B, also compare `computeContributions` output.

**Sample — deterministic and stated, not "some recent packs":**

| Stratum | Minimum |
|---|---|
| Most recent packs, ordered by `created_at desc` | 50 |
| Each of the 5 gates, activated | 3 each |
| Two or more gates active on one dispute | 5 |
| All gates absent | 10 |
| The blume-box `162042cd` credit-already-issued shape | 1, by id |

If a stratum has fewer real rows than the minimum, hand-build the shortfall as synthetic fixture cases and **say so in the PR** — a stratum quietly returning 0 rows reads as "covered" when it is the opposite.

**Expected result:** byte-identical, with the single documented exception of the §4 fraud + `account_history` pill demotion if scope B lands. Anything else is a defect, not a rounding difference.

### 6.2 Compile-time invariant

Pin the invariant in a plain `.ts` file (it is a compile-time artifact — vitest does not typecheck, so a runtime test proves nothing here):

```ts
// @ts-expect-error creditAlreadyIssued is required
const missingGate: CaseStrengthGates = {
  coverage: null,
  fatalLoss: null,
  riskWeakness: null,
  nameMismatch: null,
};

// @ts-expect-error positional gate arguments are no longer accepted
calculateCaseStrength(checklist, reason, payloadSource, undefined, undefined);
```

Both directions: a missing field, and the old positional shape. The second catches a partial migration that the first would wave through.

**This only works if `tsc` actually reads the file.** Verified against the current `tsconfig.json`: `include` is `**/*.ts` and `exclude` is only `node_modules`, `docs/figma-reference`, `archive` — so `tests/**` and `lib/**/__tests__/**` *are* compiled by `npx tsc --noEmit` today. Two consequences: put the file anywhere except those three directories, and confirm it with `npx tsc --noEmit --listFiles | grep caseStrengthGates` in the same session. An excluded file makes `@ts-expect-error` vacuous — no error is raised, and nothing reports that nothing was checked.

---

## 7. Out of scope

- Changing any gate's behaviour or precedence. Pure signature change.
- The other four defect instances from 2026-08-01 — already fixed individually.
- `decideFileAttachments`, which only reads `calculateCaseStrength().overall` and is unaffected.

---

## 8. What shipped (2026-08-01)

Scope **B**, as recommended. `calculateImprovement` keeps its signature.

| Item | Where |
|---|---|
| `CaseStrengthGates` (required object, required nullable fields) | `lib/argument/caseStrength.ts` |
| `ContributionInput` for `computeContributions` | `lib/argument/caseStrength.ts` |
| `NO_GATES` + `gatesWith()` — **test-only** | `tests/helpers/caseStrengthGates.ts` |
| Compile-time invariant (5 `@ts-expect-error` assertions) | `tests/types/caseStrengthGates.typecheck.ts` |
| `no-restricted-imports`: `lib/**` + `app/**` may not import `tests/**` | `eslint.config.mjs` |
| Gate behaviour + precedence tests (16) | `lib/argument/__tests__/caseStrengthGates.test.ts` |
| Parity harness + stratified sample query | `scripts/case-strength-parity.mjs`, `scripts/sql/case-strength-parity-sample.sql` |
| Stopgap deleted | ~~`tests/unit/caseStrengthGateParity.test.ts`~~ |

Call sites migrated: 4 production, 32 mechanical test calls (the "37" estimate counted duplicates), 4 hand-converted gate-passing test calls, 2 `computeContributions` test calls, 1 internal call inside `calculateImprovement`, and 2 untyped `.mjs` scripts (`seed-staged-defence-packages`, `verify-hero-variant` — the latter was already broken, calling the engine with a stale leading `null`).

### Two deliberate behaviour changes

Both were forced into the open by making the gates explicit; neither is a side effect.

1. **The workspace API's contributions rows now apply the fraud demotion.** `app/api/disputes/[id]/workspace/route.ts` carried a hand-copied reimplementation of `computeContributions` that never read `reason`, so a fraud dispute with prior-order history rendered a **Strong** pill for a row the scorer counted as **moderate**. It now calls the shared function. Effect: on fraud + `account_history`, that pill reads Moderate.
2. **The disputes-list fallback now applies the credit-already-issued floor.** `app/api/disputes/route.ts` was the fourth ❌ in the §1 table and stayed broken after the first fix, because the text-level parity guard only enumerated three files. It now projects `pack_json->credit_already_issued` alongside the sections and passes it. Effect: a list row for an already-credited dispute stops disagreeing with the pack that was filed.

### Verification performed

- `npx tsc --noEmit` clean; `--listFiles` confirms the invariant file is compiled.
- `npm test` — 329 files / 3716 tests pass, **no assertion values changed**.
- `npm run build` clean. `npx eslint app lib tests` — 0 errors (54 pre-existing warnings, unrelated files). The import ban was verified by probe: a `lib/` file importing `NO_GATES` errors.
- **Parity, real data:** 66 prod packs sampled (read-only, `npm run db:query:prod`, guard confirmed ref `aokhply…`), scored through both the pre-refactor engine (a `git worktree` at HEAD) and the new one, deep-compared on the **entire** `CaseStrengthResult` → **identical on all 66**. Neither behaviour change above appeared in the sample: prod has no covered pack and no fraud + `account_history` contribution row in the sampled set.
- **Sampling shortfalls, stated not hidden:** prod holds 209 packs total — 1 with a fatal-loss verdict, 1 with a credit-already-issued block, 0 covered by Shopify Protect, 0 with two triggered gates. All of them were sampled; the strata are exhausted, not under-sampled (the harness now prints the population next to the sample so the two cannot be confused). Those paths are covered synthetically by the 16 gate tests instead.
