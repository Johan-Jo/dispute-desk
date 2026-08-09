# EPIC CP-A — Canonical assessment, completeness, and UI

> **Status:** Kickoff-ready
> **Track:** Canonical Pipeline · **Owner:** Agent A
> **Depends on:** CP-0 contract commit
> **Decision input:** **P-7, already decided** — [CP-0 §1](EPIC-CP-0-gates-and-contracts.md). No gate, no waiting
> **Delivers:** **PR 1 — implemented *and* activated**
> **Parallel with:** CP-B, CP-C (simultaneous development from the shared contract commit)
> **Plan of record:** [`docs/plans/canonical-pipeline-lite.plan.md`](../plans/canonical-pipeline-lite.plan.md) §6

## Goal

`CaseAssessment` becomes the single owner of strength and completeness, and the three
merchant tabs render server projections of it. The definition of done is **the old call site
is deleted**, proven by a CI invariant — not "the derivation exists".

This epic ships as PR 1 and **activates on production** for the shop set P-7's rule produces.
PR 2's replay then runs against the post-PR-1 state, not the kickoff baseline.

## Why the definition of done is written that way

The previous effort built the derivations and never flipped the callers: scoring was proven
zero-change on all 76 live packs and the caller was still never switched
(`status-and-way-forward-2026-08-04.md` §7.5). Today `calculateCaseStrength` has **4 call
sites passing 4 different gate sets**, and the client re-computes strength in
`useDisputeWorkspace`.

## Scope

1. **Day 0 — re-run the read-only completeness calibration** on the post-C-14 baseline and
   **apply P-7's decided rule** (below). The report states the resulting shop set; it does not
   ask for a threshold approval.
2. **Reconcile against the reproducible anchors** (below): candidate thresholds, transition
   counts, shop/case impact, concrete regressions.
3. Implement completeness **independently of strength** inside `CaseAssessment`.
4. Persist/read a versioned assessment snapshot through authorised write paths only.
5. Switch Overview, Evidence and Review & Forward to server projections.
6. Delete browser-side scoring/readiness reconstruction, duplicate label/category
   registries, stale v1 completeness readers on those surfaces.
7. Stale or absent assessment renders as `needs_recalculation` — never a stale number shown
   as current.
8. Ship the `deadline_only` merchant copy (below) in ×6 locales.

## Reconcile against these anchors — and only these

The submitted plan asked Agent A to explain any difference from *"96 `coveragePercent`
changes"*. [`docs/technical.md`](../technical.md) marks that figure **"pre-implementation run
only"** — it cannot be reproduced on post-C-14 code, so requiring it mandates an
unexplainable difference. `coveragePercent` may be reported as *"not reproducible
post-implementation, by design"*.

| Anchor | Value |
|---|---|
| Affected packs | **131** = 97 persisted `available`/critical + 19 appended `optional`/`available` at read time + 15 persisted `missing`/critical |
| Effectively available pre-C-14 (what completeness scored) | **116** |
| Completeness delta | **90 packs −1…−7 · 15 packs +2…+17 · 26 unchanged** |
| Submission readiness | **13 packs `ready_with_warnings` → `ready`**, none the other way |
| Case-strength changes | **0** (moderate→moderate 98, weak→weak 27, strong→strong 6) |
| Citation / LLM-value delta | **0** — the field was never bank-eligible |

## P-7 — the decided rule Agent A applies

> **blume-box activates at threshold 60. surasvenne is excluded unless the new calibration
> produces a disposition-preserving result** — if it does, activate surasvenne at that value
> under this same decision; if it does not, surasvenne stays on the current path and is out of
> scope for this delivery.

No further approval is sought either way. Context for why the rule is shaped like that: the
last report recommended for blume-box only; C-14 clears one of surasvenne's three
prerequisites but not the 3 packs with unreadable inputs, nor the fact that **all 10** of its
eligible packs reach the gate via `legacy_no_strength`. Decisively, under the live baseline
the candidate semantics **reorder rather than rescale** — weakest auto-filing pack 23, a
blocked pack 24 — so no disposition-preserving threshold existed at any value, and C-14 does
not fix reordering. The re-run either produces one or it does not.

## `deadline_only` merchant copy (owned here)

`deadline_only` silently converts *"we would file this now"* into *"we will file this at the
deadline"* — the same shape as the hold semantics that already needed a merchant-copy
reframe. Ship in the same PR as the state:

- surface and exact copy for *"waiting for the deadline because N item(s) need your
  confirmation"*, naming the lever the merchant actually has;
- the distinction, in copy, between `deadline_only` (will file) and
  `withheld_no_safe_argument` (will not file);
- ×6 locale keys (`en`, `de`, `es`, `fr`, `pt`, `sv`). No English in `lib/`, no English in
  `pack_json`; library code emits `I18nToken`s.

## Must not change without coordinator handoff

Argument/package derivation; automation executors. Call sites in the CP-0 ownership map
belong to Agent C — ship pure functions for C to call.

## Acceptance

- [ ] Calibration re-run delivered against the anchors above, P-7's rule applied, and the
      resulting shop set stated in the PR body.
- [ ] Strength and completeness remain separate concepts.
- [ ] The same case yields the same assessment on every server and UI surface.
- [ ] No UI consumer reclassifies a fact or reconstructs readiness.
- [ ] Any result-bearing assessment input change changes the input hash.
- [ ] Approved scoring behaviour unchanged except for the approved completeness contract.
- [ ] **CI invariant:** zero client-side strength/readiness recomputation; zero direct
      `calculateCaseStrength` call sites outside the assessment derivation; zero v1
      completeness readers on the three tabs. Falsification-guarded, in the style of
      `tests/unit/evidenceDivergenceManifest.test.ts`.
- [ ] `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run release:verify` green.

## References

- Calibration report: [`docs/evidence-model/p2/completeness-calibration-report.md`](../evidence-model/p2/completeness-calibration-report.md)
- C-14 measurements: [`docs/technical.md`](../technical.md) § PR-C4
- Post-mortem §7.2 / §7.5 / §9: [`status-and-way-forward-2026-08-04.md`](../evidence-model/status-and-way-forward-2026-08-04.md)
