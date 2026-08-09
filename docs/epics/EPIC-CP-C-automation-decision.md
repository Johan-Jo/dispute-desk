# EPIC CP-C — Canonical automation decision

> **Status:** Kickoff-ready
> **Track:** Canonical Pipeline · **Owner:** Agent C
> **Depends on:** CP-0 contract commit + shared fixtures
> **Decision input:** **P-6, already decided** — [CP-0 §1](EPIC-CP-0-gates-and-contracts.md). No gate, no waiting
> **Delivers into:** PR 2, dark · **Parallel with:** CP-A, CP-B
> **Plan of record:** [`docs/plans/canonical-pipeline-lite.plan.md`](../plans/canonical-pipeline-lite.plan.md) §8

## Goal

One `CaseAutomationDecision` that every entry point reads, replacing the independent gate
ladders that today disagree with each other. Package choice stays out of it; executors
receive a `FileableSelection` only at execution time.

## Why this is the largest behaviour change in the track

Recorded in [`p4/legacy-removal-inventory.md`](../evidence-model/p4/legacy-removal-inventory.md):

- `buildDefencePackageJob.ts:611-683` runs its **own** `evaluateRules` + guard call; park and
  block both land as `draft`, distinguishable only by `verdict_reason`.
- `reconcileParkedAutoDisputes.ts` uses its own pre-filter chain.
- **R3 — the `defence-package-deadline-submit` cron, the actual submitter, consults NO
  strength, NO completeness, NO coverage, NO guards.** It files every non-conceded case with a
  valid PDF in the due window.
- **R1 — `autoSaveGate` has a legacy fallback on `undefined` readiness**, which silently drops
  the gate onto the legacy blocker-count path.

Making the cron consult a decision object *is* P-6, and P-6 is decided:

> **`deadline_only` execution is allowed only with a current canonical decision AND a current
> validated safe package, with no hard block, no staleness, no ambiguity, and no unsupported
> argument.**

Five conditions, conjunctive. The deadline adapter implements exactly that and nothing looser;
a deadline relaxes none of them.

## Scope

1. A **time-invariant** `CaseAutomationDecision` derived only from the current
   `CaseAssessment`, rules/settings, automation mode, and the dispute's **absolute** evidence
   due date.
2. Persist its input hash, automation-policy version, reason codes and computation time
   through authorised writers.
3. Switch pipeline, defence-build decision, reconcile, held state, alert/email and save gates
   to the same decision object.
4. Remove each switched consumer's independent gate/scoring/readiness ladder and legacy
   fallback — **including R1**.
5. Package choice stays out of the persisted decision.
6. Prepare `normal` and `deadline` adapters against the selector contract; CP-D connects them
   to CP-B's implementation. The deadline adapter implements P-6's five conjunctive
   conditions.
7. Automation may not import argument-plan or review internals.

## Time-invariance, stated so it isn't self-contradictory

The due date is both a declared input and the thing executors recompute. The invariant:

> The decision may carry the **absolute** evidence due date. It may never carry, or be derived
> from, a **relative** time state — time remaining, window open/closed, days to deadline.
> Executors compute window state from the absolute due date at execution.

**Required test:** evaluate identical inputs at two different clock times and assert an
identical input hash **and** identical reason codes. A due-date change is an input change and
must change the hash.

## Files this epic owns (from the CP-0 ownership map)

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

CP-A and CP-B ship pure functions; CP-C makes the edits. Every new/edited cron route must
call `cronEnvGate(req)` first — a vitest case enumerates cron routes and fails the build on
any offender.

## Must not change without coordinator handoff

Argument contents; package derivation; UI classification.

## Acceptance

- [ ] All entry points return identical action and reason codes for the same inputs.
- [ ] Hard blocks, coverage/concession, stale assessment and missing decision always prevent
      filing.
- [ ] Passage of time alone does not stale the stored decision (two-clock test above).
- [ ] No executor can obtain a package through a direct fileable-row query after cutover.
- [ ] Deadline execution satisfies **all five P-6 conditions** or files nothing — it never
      overrides a hard block, staleness, ambiguity, invalidity, or
      `withheld_no_safe_argument`.
- [ ] **CI invariant:** the enumerated legacy gate ladders have zero readers; no
      `undefined`-readiness fallback remains (R1); no cron route bypasses `cronEnvGate`.
- [ ] Coverage Gate and Fatal-loss Gate behaviour unchanged — coverage still beats fatal-loss,
      `COVERED_STATUSES` still exactly `{PROTECTED, ACTIVE}`, and no bank-facing text ever
      cites a fatal-loss reason.
- [ ] `npm test`, `npx tsc --noEmit`, `npm run release:verify` green.

## References

- Legacy inventory + R1/R3/R4: [`docs/evidence-model/p4/legacy-removal-inventory.md`](../evidence-model/p4/legacy-removal-inventory.md)
- Internal decision audit: [`docs/evidence-model/p4/internal-decision-audit.md`](../evidence-model/p4/internal-decision-audit.md)
- Gates reference: [`docs/technical.md`](../technical.md) § *Coverage Gate*, § *Fatal-loss Gate*, § *Environment Identity & Cron Gate*
