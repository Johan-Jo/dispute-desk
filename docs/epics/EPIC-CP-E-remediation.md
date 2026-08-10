# EPIC CP-E — Historical remediation (deferred)

> **Status:** Deferred — owned and named, not scheduled
> **Track:** Canonical Pipeline · **Owner:** TBD
> **Scope corrected 2026-08-09:** the rebuild that **wave-two activation requires** is *not*
> here — it is [CP-D §9.3](EPIC-CP-D-integration-and-cutover.md), executed **before**
> activation. CP-E is historical and already-sent cases only.
> **Plan of record:** [`docs/plans/canonical-pipeline-lite.plan.md`](../plans/canonical-pipeline-lite.plan.md) §10

## The split

| Population | Where it belongs | When |
|---|---|---|
| **Current open, unsubmitted cases** — packages wave two needs in order to be fileable at all | **CP-D §9.3**, authorised writer, between PR 2 and PR 3 | **Before** activation. Decided at kickoff; not deferred |
| **Legacy packages on those cases** | Nowhere — **not grandfathered**. They go stale and become non-fileable, which is correct | n/a |
| **Historical / already-sent cases** — closed, submitted, or otherwise not required for activation | **CP-E** | Deferred; own decision, own PR |

The first pass of this plan deferred all three together, which would have shipped an
activation whose packages could not be filed. The correction is the ordering, not the
constraint.

## Why the historical half stays deferred

The standing constraint on the containment series:

> **No remediation of the 91 affected disputes by any item in this series** — no regeneration,
> no backfill, no `pack_json` rewrite, no submission-state change. Remediation is its own
> decision and its own PR.
> — [`docs/evidence-model/p0/containment-proposals.md`](../evidence-model/p0/containment-proposals.md), constraint 4

C-11 shipped its blocking gate to production on 2026-08-08 and deliberately left **212 package
versions across 91 disputes** blocked and un-regenerated. That population is untouched by this
delivery, and rewriting it is irreversible work that a PR revert does not undo.

## Known populations (measured; re-measure before proposing)

| Population | Last measured | Note |
|---|---|---|
| Package versions blocked by `packageSafety` | **212 of 280**, across 91 disputes | Matches the pre-release census exactly |
| Persisted `completeness_score` the current engine cannot reproduce | **67 of 115** | Pre-existing template drift |
| Persisted strength stale vs recompute | **15 of 76** | Pre-existing |
| Packs reaching the gate via `legacy_no_strength` | **all 10** surasvenne eligible packs | No strength engine ever judged them |
| Legacy packages left stale by the hash rotation | to be measured after CP-D §9.3 | Expected outcome, not a defect |

## What this epic needs before it starts

1. A maintainer decision that historical remediation happens at all, and on which populations.
2. A re-measured population (read-only).
3. An explicit authorised writer — never a GET/read path.
4. A **forward-fix note** in place of a rollback plan; the work is irreversible.
5. Enqueue idempotency accounted for, per R4's *"deliberate fleet-wide package version bump"*.

## Non-goals

Nothing here alters what has already been filed with Shopify. Anything already submitted is
out of scope and needs its own decision.

## References

- Containment constraints and C-11 reconciliation: [`docs/evidence-model/p0/containment-proposals.md`](../evidence-model/p0/containment-proposals.md)
- R4: [`docs/evidence-model/p4/legacy-removal-inventory.md`](../evidence-model/p4/legacy-removal-inventory.md)
