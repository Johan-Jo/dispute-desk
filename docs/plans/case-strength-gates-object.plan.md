# `calculateCaseStrength` — collapse the trailing optional gates

**Status:** PLAN ONLY — nothing implemented.
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

Ship `NO_GATES` for tests and for genuinely gate-free scoring:

```ts
export const NO_GATES: CaseStrengthGates = {
  coverage: null, fatalLoss: null, riskWeakness: null,
  nameMismatch: null, creditAlreadyIssued: null,
};
```

`NO_GATES` must be `const` and deep-frozen in dev, since a shared mutable default is its own footgun.

**In-repo precedent:** `evaluateAutoSubmitGuards(input: AutoSubmitGuardInput)` already takes a single object. This aligns the two.

---

## 3. Migration — measured, not estimated

I previously guessed "~40 call sites of mechanical churn, several delicate". The actual counts:

| Shape | Count | Work |
|---|---|---|
| Production call sites | **4** | replace positional gates with the object |
| Test calls, 3 positional args only | **37** | append `, NO_GATES` — mechanical, scriptable |
| Test calls passing gates positionally | **4** | restructure by hand |
| Definition + doc references | 3 | — |

So the delicate work is **4 test calls**, not "several dozen". Those live in `lib/argument/__tests__/nameMismatch.test.ts` and read:

```ts
calculateCaseStrength(checklist(), "FRAUDULENT", payloadSource,
  undefined, undefined, undefined, { triggered: true, … })
```

Three `undefined` placeholders to reach the fourth gate — the smell in its purest form, and the clearest argument for the change.

### Order of work

1. Add `CaseStrengthGates` + `NO_GATES`; change the signature. Everything breaks — that is the point.
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

---

## 5. Risks

- **Large mechanical diff.** Mitigated by doing production call sites by hand and scripting only the uniform 3-arg test appends.
- **A wrong `null` where real data existed.** The refactor makes omission explicit but cannot tell you a gate *should* have been populated. Mitigation: for each of the 4 production sites, diff the resulting `case_strength.overall` on a sample of real packs before and after — same input, same output.
- **Doing it carelessly.** This is a fragility fix; introducing a bug while making the code safer would be worse than the status quo. It wants a session where it is the only change in flight.

---

## 6. Verification

- `npx tsc --noEmit` — the real proof. Nothing compiles until every site is converted.
- `npm test` green, with **no assertion values changed**. If a test's expected strength changes, the refactor altered behaviour and something is wrong.
- Prod parity check before merge: recompute `case_strength.overall` for a sample of recent packs on both branches and assert identical results. This is a pure refactor; any difference is a defect.
- Add one test that a gates object with a missing key fails to type-check (`@ts-expect-error`), pinning the invariant this whole plan exists to create.

---

## 7. Out of scope

- Changing any gate's behaviour or precedence. Pure signature change.
- The other four defect instances from 2026-08-01 — already fixed individually.
- `decideFileAttachments`, which only reads `calculateCaseStrength().overall` and is unaffected.
