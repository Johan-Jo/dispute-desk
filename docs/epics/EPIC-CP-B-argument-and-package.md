# EPIC CP-B — Canonical argument and issuer-safe package

> **Status:** Kickoff-ready
> **Track:** Canonical Pipeline · **Owner:** Agent B
> **Depends on:** CP-0 contract commit + shared fixtures
> **Decision inputs:** **P-4 and P-6, already decided** — [CP-0 §1](EPIC-CP-0-gates-and-contracts.md)
> **Open item:** **D-1** (`criticalCategories`), answered by the maintainer **inside PR 2's single review** on this epic's replay output
> **Delivers into:** PR 2, dark · **Parallel with:** CP-A, CP-C
> **Plan of record:** [`docs/plans/canonical-pipeline-lite.plan.md`](../plans/canonical-pipeline-lite.plan.md) §7

## Goal

`CaseArgumentPlan` becomes the **only** owner of argument disposition, inclusion, disclosure
and issuer-facing claim authority. The package stops being a place where evidence is
classified and becomes a projection of the plan. One selector decides what is fileable, and
it never picks silently between candidates.

## Scope

1. `CaseArgumentPlan` owns disposition, inclusion, disclosure, claim authority.
2. Package fact selection, thesis construction, Evidence Basis, Case Details, chronology and
   section composition become **projections** of the plan.
3. `review_required`, unverified, adverse and merchant-only facts are excluded **before**
   generation — the language model never receives them as issuer-facing support.
4. The package is rebuilt from the remaining approved facts, so **no sentence survives after
   its support is removed**.
5. Deterministic claim/document validation runs after composition; failure ⇒ non-fileable.
6. Persist package evidence usage, plan input hash, policy version, validation result and
   generated artifact identity.
7. One package-owned selector:

   ```ts
   selectFileablePackage(caseId, trigger: "normal" | "deadline"): FileableSelection
   ```

   Returns one current validated package, a typed non-fileable reason, or a **blocking
   ambiguity error**. Never an arbitrary pick.
8. `withheld_no_safe_argument` when no approved primary or rebuttal argument remains.
9. `deadline_only` whenever the plan still contains an excluded `review_required` item; a
   plan with none may produce normal eligibility. Execution is subject to **P-6's five
   conjunctive conditions** — current canonical decision, current validated safe package, no
   hard block, no staleness, no ambiguity, no unsupported argument.
10. **Retire the dormant CE 3.0 bank-package route** per P-4; retain CE 3.0 qualification as
    merchant insight.

## The existing production gate is an input, not a competitor

`packageSafety` (C-11, PR #517 → prod #519, 2026-08-08) is **already live** and consulted at
the save job, the manual save route
([`app/api/defence-packages/[id]/submit/route.ts`](../../app/api/defence-packages/[id]/submit/route.ts)),
the deadline cron's candidate selection, and the workspace readiness projection.
`selectFileablePackage` **subsumes** it — it does not sit beside it.

Prod-measured behaviour that must be preserved: **212 of 280 package versions blocked,
exactly matching the pre-release census** (212 versions across 91 disputes). A selector that
blocks a different count on the same population is wrong until explained.

## D-1 · `visa_10_4_fraud.criticalCategories` — measure here, decided in PR 2's review

The orphaned `billing_match` entry names a category with **0 members**, so every Visa 10.4
package is already `narrow`. Removing the entry flips real packages **narrow → full**, which
is bank-visible; C-14 records that it *"needs its own approval"* and PR-C4 deliberately
scheduled no work on it.

- **Agent B's deliverable:** a before/after replay across every affected package, enumerating
  each narrow → full mode transition.
- **Not Agent B's decision:** whether the entry is removed. The maintainer answers **D-1** on
  that replay output, during PR 2's single review. If the answer is *keep*, the entry stays and
  the test pinning it stays. This is not a separate approval cycle and not a separate PR.

## CE 3.0 retirement — P-4, already decided

> **Retire the dormant CE 3.0 bank-package route. Retain CE 3.0 qualification as merchant
> insight.**

Confirm in the PR that this does **not** reopen the 2026-08-04 decision that
`reasonCodeModule.allowedFactCategories` stays — that decision is why P4-as-specced was
stopped (0 of 76 packs identical), and it is unchanged.

## R4 hash churn — measure, don't design

CP-B introduces the plan input hash. `EvidenceFact.id` is positional and `computeEvidenceHash`
sorts on it, so a record-id migration *"changes every hash once"* (R4).

**Measure and report** the churn size against the current open, unsubmitted population that
CP-0 recorded. The remedy is already decided at kickoff — *rebuild current open, unsubmitted
cases through an authorised writer before wave two; do not grandfather legacy packages* — and
is executed by the coordinator between PR 2 and PR 3 ([CP-D](EPIC-CP-D-integration-and-cutover.md)).

## Must not change without coordinator handoff

Completeness thresholds; automation decision logic. Call sites in the CP-0 ownership map
belong to Agent C.

## Explicitly absent from this epic

No resolution table, append-only history, expected-head concurrency, merchant override API,
two-hash overlay, full/draft promotion system, separate safe/full package lifecycle. All of
Phase 4R is deferred.

## Acceptance

- [ ] One bank-inclusion predicate governs all issuer-facing surfaces.
- [ ] A fixture with approved + `review_required` facts produces a package with only approved
      support and **no orphaned claim**.
- [ ] A package with no safe argument is never generated as fileable.
- [ ] Stale, invalid, missing-artifact, superseded and ambiguous states cannot be selected.
- [ ] `normal` and `deadline` triggers obey P-6's five conditions without weakening any hard
      block.
- [ ] Package generation contains no independent evidence classification outside
      `CaseArgumentPlan`.
- [ ] The C-11 block count (212/280) is reproduced on the same population.
- [ ] Visa 10.4 replay delivered with every mode transition enumerated; D-1 answered in review.
- [ ] **CI invariant:** exactly one bank-inclusion predicate; exactly one AVS/CVV match-code
      set. (There were **four** match-code sets kept "in lockstep by comment" before C-12/C-13
      — `lib/argument/canonicalEvidence.ts`, `lib/argument/evidenceLineItem.ts`,
      `lib/argument/internalSignals.ts`, `useEvidenceSections.ts`.)
- [ ] `npm test`, `npx tsc --noEmit`, `npm run release:verify` green.

## References

- Containment series C-11 – C-14: [`docs/evidence-model/p0/containment-proposals.md`](../evidence-model/p0/containment-proposals.md)
- Policy matrix: [`docs/evidence-model/p0/policy-matrix-v0.3.md`](../evidence-model/p0/policy-matrix-v0.3.md)
- P4 stop finding: [`status-and-way-forward-2026-08-04.md`](../evidence-model/status-and-way-forward-2026-08-04.md) §7.1
- Legacy inventory / R4: [`docs/evidence-model/p4/legacy-removal-inventory.md`](../evidence-model/p4/legacy-removal-inventory.md)
