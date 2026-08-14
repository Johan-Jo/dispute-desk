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

## 3. Step 1 — persist identity while dark (NOT a one-line un-gate)

The obvious move — change `canonical && planned` to `planned` at line 1060 — does not work,
and the reason matters.

`planned` is itself computed only under the flag (`:379`), and it does **not** only feed the
identity columns. It also drives:

| line | what it decides |
|---|---|
| `:424` | `planHasSafeArgument` → skip the build entirely (`no_bank_eligible_facts`) |
| `:446` | `selectPlanFacts(...)` → **which facts reach the narrative generator** |
| `:715` | the package projection |
| `:748` | composed-document validation |
| `:1004` | `reviewRequiredCount` (already reads `planned?.plan ?? null`, ungated) |

Un-gating `planned` wholesale therefore changes what the model is argued from. That is a
behaviour change, not a dark one, and it breaks `activation.ts`'s central promise that OFF is
byte-for-byte the kickoff ladders.

**So step 1 is a split, not a flag move:** derive the plan unconditionally *for identity*, and
keep every consumer gated. Concretely — compute `planned`, write the seven columns from it, and
leave `:424`, `:446`, `:715` and `:748` reading the legacy path until activation.

Acceptance: new builds carry a `plan_input_hash` with the switch off, and a diff of generated
narratives before/after shows no change in fact selection.

---

## 4. Step 2 — backfill identity for the open cases

49 open drafts need a hash without being rebuilt (a rebuild costs an LLM call and risks a new
failure — see the 2026-08-14 incident).

The backfill **must** go through the same `derivePlanForCase` the build job uses. Two bridges
produce two hashes, and every package would then read stale against itself — the failure mode
`loadFileableSelection`'s header already warns about.

Script, not a migration: it needs the pack, its sections, evidence items, coverage and reason
code, which is application logic.

---

## 5. Step 3 — resolve the `final` gap

A design decision, not a mechanical fix. Two shapes:

1. **Selector-side:** the deadline trigger treats a validated draft as *fileable after
   finalize*, so the route's existing promotion branch becomes reachable. Keeps promotion in
   one place; widens a selector rung that was deliberately narrow.
2. **Route-side:** finalize before selecting. Keeps the selector's contract intact; puts a
   promotion decision upstream of the gate that authorises it, which is the inversion
   `finalizeAndEnqueueSave` exists to prevent.

Option 1 is more consistent with "one selector decides"; option 2 is a smaller diff. Whichever
is chosen, it needs a test proving a validated draft at its deadline reaches Shopify — the
scenario that is currently 49 cases wide.

---

## 6. Step 4 — close activation-OFF parity

`decideForPack` at `buildDefencePackageJob.ts:976` runs whenever `resolvedMode === "auto"`,
with **no** canonical guard, and drives the draft-vs-finalize demotion. The canonical decision
ladder is therefore already shaping production behaviour with the switch off.

This is a live parity break, not a future risk: it means "OFF is the same code" is currently
false in the build job. Either gate it, or record deliberately that this rung is exempt and
why.

---

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

```
0 (decide) → 1 (persist identity, dark) → 2 (backfill)
                                   ↘ 3 (final gap)  ┐
                                   ↘ 4 (parity)     ├→ 5 (re-measure) → 6 (flip + delete)
```

Steps 3 and 4 are independent of 1–2 and can run in parallel.

**Reversibility.** Steps 1 and 2 are additive: the columns are unread while the switch is off,
so there is nothing to roll back. Steps 3, 4 and 6 revert by turning the flag off — until PR 3
deletes the legacy modules, at which point the flag stops being a revert and the only way back
is forward.

**Do not flip before step 3 lands.** With identity backfilled but the `final` gap open,
activation still files nothing — and it would look like the backfill failed.

---

## 10. Open questions for the maintainer

1. Step 0: confirm option A.
2. Step 3: selector-side or route-side.
3. Step 4: gate `decideForPack`, or document the exemption.
4. Is a same-day rollback window required at flip, or is forward-fix acceptable given the
   legacy modules survive until PR 3?
