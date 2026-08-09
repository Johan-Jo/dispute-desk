# EPIC CP-D — Integration, pre-activation rebuild, cutover

> **Status:** Kickoff-ready
> **Track:** Canonical Pipeline · **Owner:** Coordinator, with targeted fixes by A–C
> **Depends on:** CP-A (PR 1 live), CP-B and CP-C complete
> **Decision inputs:** P-6 and the hash migration decision — [CP-0 §1](EPIC-CP-0-gates-and-contracts.md)
> **Open item:** D-1, answered inside PR 2's review
> **Plan of record:** [`docs/plans/canonical-pipeline-lite.plan.md`](../plans/canonical-pipeline-lite.plan.md) §9, §12

## Goal

Turn CP-B and CP-C into live behaviour in two reviewed PRs and one operational step, with the
packages wave two needs rebuilt **before** the switch is flipped.

## Delivery shape

```
PR 1 (CP-A)  →  PR 2 (CP-B + CP-C, dark)  →  [pre-activation rebuild]  →  PR 3 (flip + cutover)
     activated                 reviewed                 ops step                small by design
```

Three reviewed PRs total, including CP-A's. The rebuild sits between PR 2 and PR 3 precisely so
that neither reviewed PR mixes a reversible change with an irreversible one, and so the rebuild
can be verified before anything is switched.

## PR 2 — argument, package, automation, dark

1. Merge **B → C** into `epic/canonical-pipeline-lite`. Resolve only real contract conflicts;
   do not redesign a completed epic during integration.
2. Connect the `normal` and `deadline` executors to the real selector, switched off.
3. Full production-shaped pipeline tests: evidence model → assessment → argument → package →
   selection → automation.
4. Run the whole-pipeline replay — **against the post-PR-1 production state**, not the kickoff
   baseline, since PR 1 has already changed completeness semantics for the P-7 shop set.
5. Carry CP-B's Visa 10.4 replay so **D-1** is answered in this review.
6. Verify six locales, tenant isolation, migration parity, typecheck, unit/integration, build,
   required CI checks.

Reversible class only.

## Pre-activation rebuild (operational step, not a PR)

Per the kickoff hash decision: **rebuild current open, unsubmitted cases through an explicit
authorised writer — never from a GET/read path — so they carry current hashes before anything
can be marked stale. Legacy packages are not grandfathered** and are expected to go stale and
non-fileable, which is correct: they are historical or already filed.

**Required property, verified by PR 2's replay before the rebuild runs:** the rebuild must not
change what the still-live legacy path reads or files. It writes the canonical fields; the
legacy-read fields are unchanged. If the replay cannot demonstrate that, the rebuild waits and
the sequence is re-planned — it does not proceed on assumption.

Execution: dev first, then prod; guard per command; count reconciled against CP-0's recorded
population before and after.

## Replay methodology — pinned

**Population.** `disputes.final_outcome IS NULL`. **Never** `evidence_packs.status`: a pack
that passes the gate is immediately moved to `saved_to_shopify` (`pipeline.ts:813-821`), so
`status='ready'` is precisely the *complement* of "packs that cleared the gate" — run that way
the harness reported **zero eligible packs on both shops** and concluded the threshold decides
nothing. 73 → 115 packs, eligible 0 → 19.

**Two baselines, different questions.**

| Baseline | Definition | Used for |
|---|---|---|
| **Operational** (persisted-live) | the gate over `completeness_score`, `submission_readiness`, `blockers` exactly as `pipeline.ts` reads them | crossing counts, trade-offs, go/no-go |
| **Semantic** (recalculated-current) | the current engine re-run now | attribution only |

Three faithful details, each of which changes an answer: `?? 0` (a NULL score is 0, not
"skip"), `?? undefined` for readiness (drops the gate onto the legacy blocker-count path),
`?? []` for blockers.

**Pre-declared drift categories**, counted before the replay runs:

1. `persisted_score_not_reproducible_by_current_engine` — was **67 of 115**
2. `persisted_strength_stale_vs_recompute` — was **15 of 76**
3. `legacy_no_strength` — was **all 10** of surasvenne's eligible packs
4. `hash_churn_r4` — anything whose only change is the one-time rotation

A transition inside a declared category is *classified*. Anything outside all four blocks until
explained.

## PR 3 — activation and legacy cutover

Small by construction: flip the canonical argument/package/automation switches and delete the
corresponding legacy paths in the same PR. Nothing else.

**Not in PR 3:** column drops or any other destructive schema change. Those run afterwards as
mechanical migrations gated on zero-reader proof, with their own rollback note. They are
cleanup, not delivery, and carry no review cycle.

## Production release gate

Each PR promotes `develop → master` with **in-chat approval for that specific change** — one
prior yes is never standing permission. No auto-merge on a `master` PR; no `--admin` past a red
check. Attached to each promotion: the replay classification table, the rollback SHA and change
class, the named post-deploy checks and who watches them.

Migrations are applied in-session with an explicit target (`npm run db:migrate:dev` / `:prod`).

## End-to-end acceptance matrix

| Case | Required outcome |
|---|---|
| Approved facts, safe argument, current valid package, automation allowed | Selected and filed through the canonical executor path |
| Approved + `review_required`, safe argument remains | Review item visible with reason; excluded fact absent; normal trigger files nothing; deadline trigger may select the `deadline_only` package **only with all five P-6 conditions met**; merchant told which state applies |
| `review_required`, no safe argument remains | `withheld_no_safe_argument`; nothing filed; merchant notified |
| Hard loss, risk block, covered/conceded | Nothing filed under either trigger |
| Stale assessment, decision, plan or package | Nothing filed; recalculation/rebuild required |
| Deterministic validation failure | Nothing filed; blocking reason recorded |
| Ambiguous package selection | Nothing filed; error and alert, never an arbitrary pick |
| Normal trigger on `deadline_only` eligibility | Nothing filed |
| Deadline trigger, P-6 satisfied, current valid package | Selected package filed; omissions/override reason audited |
| Legacy (not rebuilt) package on an open case | Stale ⇒ non-fileable. Expected, per the kickoff decision |
| Unsafe verified-address delivery claim (C-11 population) | Blocked at every save/forward/auto-file/deadline boundary, reproducing 212 of 280 |

## Acceptance

- [ ] Every active consumer uses the canonical layer assigned to it.
- [ ] No active legacy fallback can alter strength, completeness, argument inclusion, package
      selection or automation action — **proven by the CI invariants in CP-A/B/C**, not asserted.
- [ ] The matrix above is green.
- [ ] Replay has zero transitions outside the four declared categories.
- [ ] Rebuild before/after counts reconcile against CP-0's recorded population.
- [ ] Post-deploy checks show no stale, ambiguous or invalid package was filed.

## References

- Plan §9 / §12: [`docs/plans/canonical-pipeline-lite.plan.md`](../plans/canonical-pipeline-lite.plan.md)
- Calibration methodology: [`docs/evidence-model/p2/completeness-calibration-report.md`](../evidence-model/p2/completeness-calibration-report.md) §2
- Branching/deploy rules: [`docs/branching-and-deploys.md`](../branching-and-deploys.md)
