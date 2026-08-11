# §9.3 pre-activation rebuild — PROD 5-case pilot

> **Result: the rebuild is PREMATURE on prod. Stop until CP-A/B/C is promoted to `master`.**
> **Nothing filed.** No `save_to_shopify` job, no `saved_to_shopify_at` change, population 73 → 73.
> **Target:** prod `aokhplydttxtebvbeuzc` (guard confirmed before every command) · **Run:** 2026-08-10
> **Approved by the maintainer** as "migration + 5-case pilot first".

---

## 1. What was done

| Step | Result |
|---|---|
| Migration `20260810120000` applied to prod | ✅ all 7 columns present |
| Both migration ledgers reconciled | ✅ `_migrations` + `supabase_migrations.schema_migrations` |
| 5 blume-box cases enqueued (`build_pack`, priority 500) | ✅ 5 succeeded, 0 failed |
| Chained `build_defence_package` | 4 succeeded, 1 queued |

The migration went through `scripts/run-migration.mjs` rather than `db:migrate:prod`: the latter
requires an interactive TTY and a typed confirmation phrase, which an agent session cannot provide.
CLAUDE.md names this fallback for exactly that case. **Argument order matters** — `run-migration.mjs`
reads its filename filter from `process.argv[2]`, so `--target=prod` must come *after* the version
or the filter matches nothing and the script reports success having applied nothing.

## 2. The finding

**Prod runs `master`, and `master` does not contain CP-A's writer.**

```
origin/master  b353ad1b   grep buildCaseAssessmentSnapshot lib/packs/buildPack.ts  → 0
origin/develop 30f24cba   grep buildCaseAssessmentSnapshot lib/packs/buildPack.ts  → 2
develop is 37 commits ahead of master
```

So the rebuild executed the **pre-CP-A builder**. It re-derived each pack, rewrote it, and produced
**zero** canonical output:

| Measure | After the pilot |
|---|---|
| Open packs with `case_assessment` | **0 / 104** |
| Population with `case_assessment` | **0 / 73** |
| Open packages with `plan_json` / `plan_input_hash` | **0 / 244** |
| P-7 resolving CANONICAL (blume-box, ACTIVATED @ 60) | **0** |

The identity columns now exist on prod and nothing writes them, which is the correct expand-phase
state — but it also means the rebuild has nothing to fill them with until the code ships.

## 3. What the rebuild DID change

All five packs moved, because the current `master` builder legitimately re-collects evidence:

| Case | `completeness_score` | `credit_already_issued` |
|---|---|---|
| `1cc88617` | 99 → **92** | `null` → populated |
| `11e7ac7e` | 99 → **92** | `null` → populated |
| `0dd0b178` | 99 → **92** | `null` → populated |
| `0bd2d2e6` | 99 → **92** | `null` → populated |
| `13e5165c` | 81 → **82** | `null` → populated |

`credit_already_issued` going from `null` to a populated object on every one of the five says these
packs were stale against **`master`'s own** builder, not just against CP-A — the field predates this
work and had never been written for them.

**Legacy dispositions: 0 changes.** Every case stayed above blume-box's threshold of 60, so nothing
crossed the gate and nothing filed. The merchant-visible completeness number dropped 7 points on
four live cases; that is the current builder's honest answer on fresher evidence, and the eventual
real rebuild will overwrite it.

## 4. Why the pilot was the right size

`buildPackJob.ts:225` runs `evaluateAndMaybeAutoSave` after every rebuild, and both prod shops have
`auto_save_enabled = true`. A pack that now clears the gate is stamped `saved_to_shopify` and
enqueued for a save that calls `disputeEvidenceUpdate` with `submitEvidence: true` — evidence filed
to the card network, irreversibly.

At 5 cases the exposure was measurable and the answer was clean (nothing filed). At 73 the same
discovery — that the deployed code cannot write canonical fields — would have cost 73 rebuilt packs
and an unknown number of filings for no canonical benefit whatsoever.

**What should have been checked first:** whether the deployed `master` contains the writer. The
pilot found it, but a one-line `git show origin/master:lib/packs/buildPack.ts | grep` would have
found it before touching prod at all.

## 5. Required order

1. Promote CP-A/CP-B/CP-C to `master` (**a production deploy — needs per-change approval**).
2. Confirm the prod deployment is serving that code.
3. *Then* run §9.3 — the remaining 68 cases, in batches, verifying filings each time.

Running the rebuild before step 1 re-churns live packs through the legacy builder and moves
merchant-visible numbers for nothing.

## 6. State left behind

- Migration `20260810120000` applied to prod. Additive, 7 nullable columns, no defaults, no
  backfill, **no reader on `master`** — safe to sit indefinitely.
- 5 blume-box packs rebuilt by the legacy builder (§3). 1 `build_defence_package` job still queued.
- `tmp/cp-rebuild-before-prod.json` — the BEFORE snapshot for all 104 open packs, still the baseline
  for the eventual full run.
- Supabase CLI re-linked to **dev** (`vrpkgudqmpyunekrkpnc`) so the global pointer is not left on prod.
- Nothing filed to any card network.
