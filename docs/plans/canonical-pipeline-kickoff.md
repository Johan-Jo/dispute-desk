# Canonical pipeline — kickoff note (CP-0)

**Issued:** 2026-08-09 · **Coordinator:** this session
**Plan of record:** [`canonical-pipeline-lite.plan.md`](canonical-pipeline-lite.plan.md)
**Epics:** [`CP-0`](../epics/EPIC-CP-0-gates-and-contracts.md) · [`CP-A`](../epics/EPIC-CP-A-assessment-and-ui.md) · [`CP-B`](../epics/EPIC-CP-B-argument-and-package.md) · [`CP-C`](../epics/EPIC-CP-C-automation-decision.md) · [`CP-D`](../epics/EPIC-CP-D-integration-and-cutover.md) · [`CP-E`](../epics/EPIC-CP-E-remediation.md)

This is the single document an agent reads before starting. Everything in it is
settled; none of it is an open question.

---

## 1. Baseline and branch

| | |
|---|---|
| Kickoff baseline | `develop` @ **`58e15806e002a0473edd2d2a069073ad88b25018`** — PR-C4 / C-14 (#523), not in production |
| Epic branch | `epic/canonical-pipeline-lite`, cut from that baseline |
| Contract commit | **`16e0e1f4539a8641227914fa920f6a482d8e7f49`** — `feat(pipeline): CP-0 contract commit` |
| Supabase link at kickoff | dev `vrpkgudqmpyunekrkpnc` (DisputeDesk-Dev), verified |

### Agent branches and worktrees

All three cut from the contract commit `16e0e1f4` — not from the baseline, not
from one another. `node_modules` is a junction to the main checkout, so
`npx vitest` and `npx tsc` work in each worktree without a separate install.

| Agent | Branch | Worktree |
|---|---|---|
| A — Assessment & UI | `epic/cp-a-assessment` | `C:\Users\johan\Cursor Portfolio\DisputeDesk-cp-a` |
| B — Argument & Package | `epic/cp-b-argument` | `C:\Users\johan\Cursor Portfolio\DisputeDesk-cp-b` |
| C — Automation | `epic/cp-c-automation` | `C:\Users\johan\Cursor Portfolio\DisputeDesk-cp-c` |

---

## 2. Decisions — constants, not gates

Taken by the maintainer 2026-08-09. No epic re-opens one. None is an occasion
for review.

| # | **Decision** | Consumed by |
|---|---|---|
| **P-4** | **Retire the dormant CE 3.0 bank-package route. Retain CE 3.0 qualification as merchant insight.** | CP-B |
| **P-6** | **`deadline_only` execution only with a current canonical decision AND a current validated safe package, with no hard block, no staleness, no ambiguity, and no unsupported argument.** Five conditions, conjunctive. A deadline relaxes none of them | CP-C, PR 3 |
| **P-7** | **blume-box activates at threshold 60. surasvenne is excluded unless the new calibration produces a disposition-preserving result** — if it does, activate surasvenne at that value under this same decision | CP-A, PR 1 |
| **Hash migration (R4)** | **Rebuild only current open, unsubmitted cases through an authorised writer, before wave two. Do not grandfather legacy packages.** Historical / already-sent remediation stays in CP-E | CP-D, CP-E |

P-6 is encoded in code, not prose: `mayExecuteAtDeadline()` in
`lib/pipeline/contracts/automationDecision.ts`, conjunctive by construction and
pinned by a test that flips each condition independently.

### The one open item

**D-1** — `visa_10_4_fraud.criticalCategories` still names `billing_match`, a
category with **0 members**. Remove the entry, or keep it? Agent B delivers the
measured before/after replay enumerating every narrow → full transition; the
**maintainer answers inside PR 2's single review**. Not a separate cycle, not a
separate PR. Agent B measures; Agent B does not conclude.

---

## 3. Delivery order

```
CP-0 (this note)
  └─ CP-A ∥ CP-B ∥ CP-C          simultaneous development from the contract commit
        ├─ PR 1  CP-A implemented AND activated
        ├─ PR 2  CP-B + CP-C integrated, dark · whole-pipeline replay · D-1 answered
        ├─ ops   authorised rebuild of open, unsubmitted cases + verification
        └─ PR 3  activation and legacy cutover (small by construction)
```

Three reviewed PRs. The rebuild is an operational step between PR 2 and PR 3, so
neither reviewed PR mixes a reversible change with an irreversible one. Column
drops and historical remediation are outside this delivery.

PR 2's replay runs against the **post-PR-1 production state**, not this baseline
— PR 1 has already moved completeness semantics for the P-7 shop set by then.

---

## 4. Shared contracts

`lib/pipeline/contracts/` — the only shapes an epic may depend on across a
boundary. Private helpers inside an epic are free; a competing version of
anything exported here is not.

| File | Owns |
|---|---|
| `freshness.ts` | `SnapshotFreshness`, `evaluateFreshness()` — the single staleness predicate. `computedAt` is audit-only and never an input |
| `assessment.ts` | `CaseAssessmentSnapshot`, `CompletenessSnapshot`, `MerchantAssessmentProjection`, `MerchantReviewItem` |
| `argumentPlan.ts` | `CaseArgumentPlanSnapshot`, `IncludedFact`, `ExcludedFact`, `NoSafeArgumentReason`, `DocumentValidationResult` |
| `automationDecision.ts` | `CaseAutomationDecisionSnapshot`, `DeadlineExecutionConditions`, `mayExecuteAtDeadline()` |
| `fileableSelection.ts` | `FileableSelection` (`selected` \| typed `none` \| `ambiguous`), `NotFileableReason`, `isFileable()` |
| `index.ts` | the public surface. Import from here |

**Contract revision protocol.** Budget for two. The coordinator amends the
contract on `epic/canonical-pipeline-lite`, sends one paragraph to all three
agents, and each agent rebases before continuing. No agent adopts a shape change
before that decision exists. **A contract revision is not a review event.**

---

## 5. Shared fixtures

`lib/pipeline/contracts/__fixtures__/cases.ts` — nine cases, coordinator-owned,
available on day one so B and C are not blocked on A.

`strong` · `weak` · `complete` · `incomplete` · `hard_blocked` ·
`covered_conceded` · `stale` · `review_required_safe_argument` ·
`review_required_no_safe_argument`

Each carries the assessment, plan and decision snapshots plus **the selection
each trigger must produce** — that expectation is the acceptance contract, and
`lib/pipeline/contracts/__tests__/contracts.test.ts` already asserts the safety
property across the whole set: the deadline trigger may differ from normal
**only** on `deadline_only_not_yet_due`, never on a hard block, coverage,
staleness or a missing safe argument.

Fixtures use fixed instants (`FIXTURE_COMPUTED_AT`, `FIXTURE_DUE_AT`), never a
clock — a fixture that depends on when the suite runs cannot pin the
time-invariance test.

Agents may extend privately. The shared set moves only by contract revision.

---

## 6. Per-file ownership

These ten files sit simultaneously in all three agents' scope. **Agent C owns
every call site.** A and B ship pure, separately tested functions that C calls.
Silence on any other file defaults to C.

```
lib/automation/pipeline.ts
lib/automation/autoSaveGate.ts
lib/automation/finalizeAndEnqueueSave.ts
lib/jobs/handlers/saveToShopifyJob.ts
app/api/disputes/[id]/workspace/route.ts
app/api/cron/defence-package-deadline-submit/route.ts
app/api/defence-packages/[id]/finalize/route.ts
app/api/defence-packages/[id]/submit/route.ts
app/api/packs/[packId]/approve/route.ts
app/api/packs/[packId]/save-to-shopify/route.ts
```

Epic-owned libraries, for reference: A → `lib/evidence/model/assessment.ts`,
`lib/automation/completeness.ts`, the three tabs. B → `lib/argument/**`,
`lib/defence/**`. C → `lib/automation/**` decision logic and the executors above.

---

## 7. Rebuild population — measured, so CP-D does not re-derive it

Read-only census against **prod** (`aokhplydttxtebvbeuzc`), 2026-08-09, via
`npm run db:query:prod -- --file scripts/sql/cp0-rebuild-population-census.sql`.
The CLI link was returned to dev immediately afterwards and verified.

**Predicate** — conjunctive on purpose, because `submission_state`, the saved-at
timestamp and `submitted_at` are three independent writers and a case is only
safe to rebuild when none has fired:

```sql
final_outcome is null
and coalesce(submission_state, 'not_saved') = 'not_saved'
and evidence_saved_to_shopify_at is null
and submitted_at is null
```

| Shop | Open unsubmitted | With evidence pack | With defence package | With neither |
|---|---|---|---|---|
| blume-box | **61** | 61 | 61 | 0 |
| cay-collective | **3** | 0 | 0 | 3 |
| **Total** | **64** | 61 | 61 | 3 |

Two things worth carrying forward:

- **surasvenne has zero open unsubmitted cases.** It is absent from the rebuild
  population entirely, which is independent of — and consistent with — P-7
  excluding it unless the calibration says otherwise.
- **3 cay-collective cases have neither pack nor package.** They are in the
  population by predicate but have nothing to rebuild; CP-D reconciles 64 as the
  denominator and 61 as the rebuildable set, and says so rather than quietly
  reporting 61.

Re-run the census immediately before CP-D §9.3 executes and reconcile against
these numbers. A drift is information, not a blocker — but it must be stated.

---

## 7b. D-1 population context (coordinator, 2026-08-09)

Agent B's replay enumerates *which* cells removing the orphaned `billing_match`
entry would move narrow → full, but its worktree had no Supabase link, so it
could not say *how many* packages sit in them. Answered here, read-only:
`scripts/sql/d1-visa-10-4-transition-population.sql`.

| Shop | Open unsubmitted | Visa 10.4 | In a transitioning cell |
|---|---|---|---|
| blume-box | 61 | **0** | **0** |
| cay-collective | 3 | **0** | **0** |
| **Total** | **64** | **0** | **0** |

**Checked for a false zero, because this project has had one.** The
`network_reason_code` column is populated, not empty: of the 64 open unsubmitted
cases, **57 are Mastercard `4837`**, 2 are `4853`, 1 is `4834`, and 4 are NULL.
There is no Visa reason code anywhere in the population. The zero is real.

**What that means for D-1:** removing the entry would flip **no currently open,
unsubmitted case**. The bank-visible risk is entirely prospective — it lands on
future Visa 10.4 disputes, not on anything in flight. That is context for the
decision at PR 2's review; it is not the decision, and it does not make the
change riskless.

---

## 8. Standing rules that apply to every agent

- **DB target is confirmed per command, not per session.** `npm run db:query:dev`
  / `:prod` and `npm run db:migrate:dev` / `:prod` run the guard first. Never
  pipe results through `tail`.
- **Migrations are applied in the same session they are written**, with an
  explicit target. Never hand a migration back.
- **No English in `lib/`, no English in `pack_json`.** Library code emits
  `I18nToken`s; new keys are translated across all six locales the same session.
- **Every cron route calls `cronEnvGate(req)` first.**
- **`develop` ships freely; `master` needs per-change in-chat approval.** No
  auto-merge on a `master` PR, no `--admin` past a red check.
- **Before "done":** `npm test`, `npx tsc --noEmit`, and `npm run build` for
  UI/route/schema changes; `npm run release:verify` before handoff.
- **Docs in the same commit as the change** — `docs/technical.md`, plus the
  embedded help article when merchant-visible behaviour moves.
