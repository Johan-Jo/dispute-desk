# Canonical pipeline — activation plan (legacy cutover)

**Status:** draft, 2026-08-14. Written from production measurements taken the same day.
**Prerequisite reading:** `docs/plans/canonical-pipeline-lite.plan.md` §9.3, `lib/pipeline/activation.ts`.

This plan covers only the last mile: what stands between the canonical pipeline as it exists
today (built, tested, dark) and `CANONICAL_PIPELINE=on` with the legacy modules deleted.

---

## 0. Measured starting state (2026-08-14, production)

Everything below is a query result, not a recollection. Re-run before acting — the point of
recording the numbers is that they date.

| fact | value |
|---|---|
| `CANONICAL_PIPELINE` | unset in all environments → dark |
| `defence_packages` total | 398 |
| …carrying `plan_input_hash` | **0** |
| …built in the last 24h | 3, of which **0** carry a hash |
| open unsubmitted cases | 58 |
| …latest package `draft` | 49 |
| …latest package `failed` | 9 |
| …latest package `final` | **0** |
| persisted case assessment / decision tables | **none exist** |

The only canonical storage in production is seven columns on `defence_packages`:
`plan_json`, `plan_input_hash`, `plan_policy_version`, `plan_deadline_only`,
`plan_no_safe_argument`, `document_validation_passed`, `document_failure_codes`.

> A prior status report claimed "59 of 74 open cases now carry canonical assessments". No
> storage exists that could hold that, and the columns that do exist are empty. Whatever it
> counted, it was not canonical identity. Do not plan against that number.

---

## 1. The two blockers

Both were verified by reading the shipped code against the measured data. Either one alone
makes activation a no-op-to-outage; together they mean **the deadline cron would file 0 of 58
open cases on the first tick**.

### 1.1 The identity deadlock

`buildDefencePackageJob.ts:1060` writes the identity columns only under
`canonical && planned`. So:

- switch **off** → identity is never written, for anyone, ever;
- switch **on** → all 398 existing packages have `plan_input_hash = null`, which
  `evaluateFreshness` resolves to `snapshot_absent` — non-fileable, and explicitly *not*
  grandfathered (kickoff hash decision, §1A).

You cannot pre-populate identity before flipping, because writing it requires the flip. This
is the sequencing question raised during the original epic and never answered.

### 1.2 Nothing is `final`

`selectFileablePackage` rung 10 refuses any candidate whose status is not `final`
(`not_final`). Across the 58 open cases, **zero** are final — 49 drafts and 9 failed builds.

The canonical deadline route *appears* to handle this: it has a `draft`/`stale` auto-finalize
branch. It is unreachable. The branch sits after

```ts
if (outcome.selection.outcome !== "selected") { …email; continue }
```

and a selection can only be `selected` if the candidate is already `final`. So the branch that
would promote a validated draft can never run, and `selectForDeadline` relaxes exactly one rung
(`deadline_only_not_yet_due`), not this one.

**This is the larger blocker.** A hash backfill fixes 1.1 and changes nothing here: every case
still refuses, one rung later.

---

## 2. Step 0 — the decision that gates everything

Three ways out of the deadlock. They are not equivalent.

| option | consequence |
|---|---|
| **A. Decouple identity writing from the flag** — derive and persist identity while dark; activation becomes a read of data that is already there | one rebuild; no blackout; recommended |
| B. Flip first, then rebuild everything | every open case non-fileable until its rebuild lands — a blackout measured in days, across a deadline window |
| C. Grandfather null hashes at activation | guts the freshness contract on day one; the identity becomes decorative, which is what rung 7b exists to prevent |

**Recommendation: A.** It is the only option that does not either rebuild every case twice or
spend the contract it is trying to establish.

---

## 3. Step 1 — persist identity while dark — **DONE (2026-08-14)**

The obvious move — change `canonical && planned` to `planned` at line 1060 — did not work, and
the reason is the whole of this step.

`planned` was itself computed only under the flag, and it does not only feed the identity
columns. It also drove the skip decision, **which facts reach the narrative generator**, the
projection, the document validation, and `reviewRequiredCount` — the last of which was already
read UNGATED, so deriving the plan always would have changed a live input to `decideForPack`.

Shipped as a split, not a flag move:

- `derivePlanForCase` runs on every build. It is pure — evidence model, candidates, hash, no IO
  and no model call — so deriving it while dark costs nothing.
- **`activePlan = canonical ? planned : null`** is the plan *as an input to behaviour*. Every
  consumer reads it, so fact selection, the skip decision, the projection, document validation
  and `reviewRequiredCount` keep the legacy path byte for byte.
- `planned` is the plan *as identity* and feeds nothing but the columns.
- A dark derivation that throws is swallowed with a warning; the same failure under the switch
  rethrows, because then the plan IS the build.
- **The document verdict is not part of the identity.** `plan_*` describe what the package was
  built from and are true either way; `document_validation_passed` is a verdict and
  `validatePackageDocument` does not run while dark, so it stays null rather than claiming a
  check that never happened — it is the column rung 9 refuses on.

`tests/unit/darkIdentityDerivation.test.ts` pins the invariant structurally: `planned` may be
read in exactly two places. A behavioural test cannot catch a consumer reading the wrong
variable, because with the flag off the two agree on every case where the plan authorises
everything — the defect only shows on cases where the plan EXCLUDES something, which is the
population a fixture is least likely to contain.

**Effect:** every build from now on stamps its own identity. The backfill population shrinks
from here (§4.1).

## 4. Backfill discipline — the backfill is the LAST step

**Maintainer instruction, 2026-08-14: all logic and programming is finished, tested and
deployed dark BEFORE any bulk backfill runs.** Too many backfills on this project have been
started mid-change, hit a wall, and been abandoned half-applied.

This is not only scheduling. A backfill run while `derivePlanForCase` can still change
**invalidates itself**, and fails worse than not running:

| state | how `evaluateFreshness` reads it | what the merchant surface says |
|---|---|---|
| never stamped | `snapshot_absent` | non-fileable — correct, and obviously unstamped |
| stamped, then the bridge changed | `input_hash_mismatch` | "the case moved, rebuild it" — **false**, and indistinguishable from a real change |

A half-finished backfill is therefore not a partial win. It converts an honest "not done yet"
into a misleading "this case changed", across however many rows it reached before stopping.

### 4.1 The backfill shrinks if you wait

Once step 1 lands, **every rebuild stamps identity by itself**. The pre-deadline rebuild cron
touches every due-today case, so open cases acquire identity naturally as their deadlines come
round. The bulk backfill is therefore a sweep for stragglers, not a migration of all 398 — and
the longer the code takes to freeze, the smaller it gets. Re-measure the remaining population
immediately before running it; do not size it from this document.

### 4.2 Canary first — 2 to 3 cases

Before any bulk run, stamp two or three cases and prove:

1. the hash the backfill writes is **byte-identical** to the hash a real rebuild writes for the
   same case (run one of each and compare — this is the whole risk of the backfill);
2. the stamped case reads `fresh` through `evaluateFreshness` against live inputs;
3. nothing else about the case changed — same status, same PDF, same narrative.

If (1) fails, the backfill is using a second bridge and must not proceed. That is the exact
defect `loadFileableSelection`'s header warns about, and it is silent.

### 4.3 The full run

Requirements, all of them:

- **Chunked and resumable.** A ledger of which case ids are done, so an interrupted run
  continues rather than restarts, and so "it never finished" is visible rather than assumed.
- **Idempotent.** Re-stamping an already-current case is a no-op.
- **Bounded.** Stops on the first hash mismatch rather than continuing past it.
- **Reports what it skipped.** A case it could not stamp is named, not silently left.
- Same `derivePlanForCase` the build job uses. No second derivation, ever.

It runs **after** every code step below, and **immediately before** the flip.

## 5. Step 3 — resolve the `final` gap — **DONE (2026-08-14, option a)**

Decision: **(a)** — a `requiresFinalize: boolean` on the existing `selected` member.
Rejected: a fourth union member (every consumer and `isFileable` change) and finalizing before
selecting (promotes a package the gate may then refuse, leaving a `final` row that should not
exist — in the status the save worker files on).

Shipped:

- `SelectedPackage.requiresFinalize` on the contract.
- Rung 10 accepts `draft` and `stale` on the **deadline** trigger only, and sets the flag.
  `PROMOTABLE_AT_DEADLINE` mirrors the RPC's `p_allowed_statuses` validation — the two must
  agree, or the selector authorises a promotion the transaction refuses.
- The deadline route branches on the flag instead of re-deriving from `status`.
- `saveToShopifyJob` refuses a `requiresFinalize` selection outright: it files, it does not
  promote. Without that it would have hit the raw `status !== "final"` check three steps later
  and reported "not final, finalize the draft" for a package the selector had just authorised.

Pinned: draft/stale selected-with-flag at the deadline; the same rows refused `not_final` on the
normal trigger; `final` selects with the flag false; and `submitted`/`superseded`/`skipped`/
`failed` never select, so promotion cannot widen past what the RPC accepts.

## 6. Step 4 — activation-OFF parity — **DONE (2026-08-14), documented not gated**

`decideForPack` at `buildDefencePackageJob.ts:976` runs whenever `resolvedMode === "auto"` with
no canonical guard, and its verdict demotes the mode. The canonical decision ladder therefore
already shapes live behaviour with the switch off.

Gating it was the wrong fix: the call *demotes* to review, so removing it would let **more**
packages auto-finalize than today — a live behaviour change, in the riskier direction, to
restore a parity claim on a path PR 3 deletes.

Recorded as a deliberate exemption in `activation.ts`, alongside the step-1 derivation, and the
file's "byte-for-byte" claim now names both rather than overstating. An undocumented exemption
is indistinguishable from a bug.

## 7. Step 5 — re-measure threshold 60

A prior report states threshold 60 blocks 19 of 73 cases and flips 17. **Unverified, and the
population it was measured on has since changed.** Re-measure before deciding; do not carry the
number forward.

---

## 8. Step 6 — flip, then delete

`CANONICAL_PIPELINE=on`, then PR 3 removes the false branch at all nine gated call sites and
deletes:

- `lib/automation/pipeline.legacy.ts`
- `lib/automation/reconcileParkedAutoDisputes.legacy.ts`
- `lib/disputes/heldState.legacy.ts`
- `app/api/cron/defence-package-deadline-submit/legacyRoute.ts`

Gated call sites (verify this list is still nine at cutover):
`pipeline.ts:469, 1050, 1125` · `reconcileParkedAutoDisputes.ts:64` · `heldState.ts:272` ·
`buildDefencePackageJob.ts:375` · `saveToShopifyJob.ts:200` ·
`defence-package-deadline-submit/route.ts:92` · `workspace/route.ts:825`

---

## 9. Sequencing and reversibility

Code first, frozen, deployed dark. Data last.

```
0  decide (option A)
   ↓
1  persist identity while dark        ┐
3  resolve the `final` gap            ├─ ALL CODE. Shipped, tested, deployed dark.
4  close activation-OFF parity        ┘  Nothing below starts until these are done.
   ↓
   ── logic freeze on derivePlanForCase ──
   ↓
4.2 canary backfill (2–3 cases) — prove the hash matches a real rebuild
   ↓
5  re-measure threshold 60 on the current population
   ↓
4.3 FULL BACKFILL — chunked, resumable, last data step
   ↓
6  flip + delete
```

Steps 1, 3 and 4 are independent of each other and can run in parallel. Nothing after the
freeze line may change `derivePlanForCase`; if it has to, the backfill restarts from empty.

**Why the flip is after the backfill and not before.** A case with no identity is non-fileable
at activation. Flipping first means a blackout across every unstamped case, through whatever
deadlines fall in that window. The backfill is the last data step; the flip is the last step.

**Reversibility.** Steps 1 and 3–4 revert by turning the flag off (steps 1's columns are unread
while dark, so there is nothing to undo). The backfill is **not** revertible in a useful sense —
its rows are additive, but un-stamping them would return cases to `snapshot_absent`, so a
mistake is corrected by re-running with the fixed bridge, not by rollback. That is precisely
why it goes last, after the bridge can no longer move.

**Do not flip before step 3 lands.** With identity backfilled but the `final` gap open,
activation still files nothing — and it would look like the backfill failed.

## 10. Open questions for the maintainer

1. Step 0: confirm option A.
2. Step 3: selector-side or route-side.
3. Step 4: gate `decideForPack`, or document the exemption.
4. Is a same-day rollback window required at flip, or is forward-fix acceptable given the
   legacy modules survive until PR 3?
