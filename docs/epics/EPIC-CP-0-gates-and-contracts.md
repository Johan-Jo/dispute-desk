# EPIC CP-0 — Kickoff decisions, contracts, fixtures, ownership

> **Status:** Kickoff-ready — decisions taken 2026-08-09
> **Track:** Canonical Pipeline (CP-0 … CP-E)
> **Owner:** Coordinator
> **Depends on:** `develop` @ `58e15806` (PR-C4 / C-14 merged, not in production)
> **Blocks:** CP-A, CP-B, CP-C — all three branch from this epic's contract commit
> **Plan of record:** [`docs/plans/canonical-pipeline-lite.plan.md`](../plans/canonical-pipeline-lite.plan.md) §1, §1A, §5

## Goal

Make the three implementation epics genuinely parallelisable, and hand them their decisions as
**constants** rather than as approval gates. Everything here is Day 0 work; nothing changes
production behaviour.

## 1. Kickoff decisions — already made, not gates

Copy this table verbatim into the contract commit. No epic re-opens one; none is an occasion
for review.

| # | Question | **Decision** | Consumed by |
|---|---|---|---|
| **P-4** | The dormant CE 3.0 bank-package route | **Retire it. Retain CE 3.0 qualification as merchant insight.** | CP-B |
| **P-6** | May the deadline path file? | **`deadline_only` execution only with a current canonical decision AND a current validated safe package, and no hard block, no staleness, no ambiguity, no unsupported argument.** Five conditions, conjunctive. A deadline relaxes none of them | CP-C, PR 3 |
| **P-7** | Completeness thresholds | **blume-box at 60. surasvenne excluded unless the new calibration produces a disposition-preserving result** — if it does, activate at that value under this decision; if not, surasvenne stays on the current path | CP-A, PR 1 |
| **Hash migration (R4)** | Grandfather or rebuild? | **Rebuild only current open, unsubmitted cases through an authorised writer, before wave two. Do not grandfather legacy packages.** Historical / already-sent remediation stays in CP-E | CP-D, CP-E |

### The one item still open

| # | Question | Answered by | When |
|---|---|---|---|
| **D-1** | `visa_10_4_fraud.criticalCategories` still names `billing_match`, a category with **0 members**. Remove the entry or keep it? | The maintainer, on CP-B's measured before/after replay enumerating every narrow → full transition | **Inside PR 2's single review** — not a separate cycle, not a separate PR |

It stays open because the change is bank-visible: every Visa 10.4 package is already `narrow`,
and removing the entry flips real packages **narrow → full**. C-14 records that it *"needs its
own approval"* and PR-C4 deliberately scheduled no work on it. CP-B measures; CP-B does not
conclude.

## 2. Environment and baseline

- Pull `develop`, record the exact SHA as the kickoff baseline.
- Confirm the Supabase CLI target is dev `vrpkgudqmpyunekrkpnc` and that
  [`scripts/guard-db-target.mjs`](../../scripts/guard-db-target.mjs) hard-refuses prod —
  **per command, not per session**.
- Create `epic/canonical-pipeline-lite` from the baseline.

## 3. Measure the rebuild population before anyone needs it

The hash decision names a population; CP-0 pins it so CP-D can execute without re-deriving it.

- Start from `disputes.final_outcome IS NULL` **and** no successful submission recorded.
- Record the exact predicate and the count, read-only, against prod via the explicit read-only
  route.
- This is the population CP-D §9.3 rebuilds and reconciles against, before and after.

## 4. The contract commit

One coordinator-owned commit, complete before any agent branches.

**Public shapes**

- `CaseAssessmentSnapshot`
- `CaseArgumentPlanSnapshot`
- `CaseAutomationDecisionSnapshot`
- merchant-facing assessment and review-item projections
- `FileableSelection` — `selected` | typed `none` reason | blocking ambiguity error
- snapshot freshness metadata: input hash, policy version, computation time

**Shared fixtures** (CP-0 owns these, not CP-A): strong · weak · complete · incomplete ·
hard-blocked · covered/conceded · stale · `review_required` with a safe argument remaining ·
`review_required` with none.

**Per-file ownership map.** These files sit simultaneously in all three agents' scope:

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

**Resolution: Agent C owns every call site above.** CP-A and CP-B ship pure, separately tested
functions that CP-C calls. Any other split is named per file; silence defaults to C.

**§1A verbatim**, as the agents' constants.

## 5. Worktrees and kickoff note

Create A/B/C branches and worktrees **from the contract commit**. One kickoff note carrying:
baseline SHA, contract SHA, branch names, worktree paths, ownership map, the decisions table,
and the rebuild population count.

## 6. Contract revision protocol

Budget for two public-shape revisions. Coordinator amends on the epic branch → one-paragraph
decision to all three agents → each rebases before continuing. **A contract revision is not a
review event.**

## Acceptance

- [ ] Kickoff baseline SHA recorded; dev target verified per command.
- [ ] Rebuild population predicate and count recorded (read-only).
- [ ] Contract commit contains all six public shapes, all nine fixtures, the file-level
      ownership map, and §1A verbatim.
- [ ] Three worktrees created from that commit; kickoff note sent.
- [ ] `npx tsc --noEmit` green on the contract commit.

## References

- Plan: [`docs/plans/canonical-pipeline-lite.plan.md`](../plans/canonical-pipeline-lite.plan.md)
- Open risks R1–R4: [`docs/evidence-model/p4/legacy-removal-inventory.md`](../evidence-model/p4/legacy-removal-inventory.md)
- Containment series: [`docs/evidence-model/p0/containment-proposals.md`](../evidence-model/p0/containment-proposals.md)
- Post-mortem: [`docs/evidence-model/status-and-way-forward-2026-08-04.md`](../evidence-model/status-and-way-forward-2026-08-04.md)
