# Whole-pipeline replay — post-PR-1 production state

> **Status:** MEASURED. Nothing activated, nothing rebuilt, nothing written.
> **Baseline:** `develop@72b81561` (PR #524 merged), production `aokhplydttxtebvbeuzc`, read-only
> **Run:** 2026-08-10 · **Harness:** [`scripts/evidence-model/wholePipelineReplay.analysis.ts`](../../../scripts/evidence-model/wholePipelineReplay.analysis.ts)
> **Plan:** §9.2 (re-run against the post-PR-1 state, not the kickoff baseline), §9.4 (methodology)

---

## 1. What was compared

Two arms over the same live rows:

| Arm | What it is |
|---|---|
| **LEGACY** | What production decides *today*, switch off — `resolveEffectiveCompleteness` → `evaluateAutoSubmitGuards` + `evaluateAutoSaveGate`, exactly as `pipeline.legacy.ts` reads them. The three faithful coercions preserved: `?? 0` on the score, `?? undefined` on readiness (R1, which drops the gate onto the legacy blocker-count arm), `?? []` on blockers |
| **CANONICAL** | What PR 3 would decide — `decideForPack` handed the same effective completeness pair, then `selectFileablePackage` on both triggers |

**Held constant.** `automationMode` is pinned to `"auto"` in both arms. It is a shared input, not a
divergence — a case whose rules resolve to `review` parks identically either way — and pinning it
runs the gate on every case, which is the strictly larger population. `evidenceDueAt` is the real
`disputes.due_at` and is not pinned; it is an input to the canonical decision.

**Population.** `disputes.final_outcome IS NULL` — **110 open disputes, 104 carrying a pack**. Never
`evidence_packs.status`, per §9.4: a pack that clears the gate is immediately moved to
`saved_to_shopify`, so `status='ready'` is the *complement* of "packs that cleared the gate", and
running the harness that way once reported zero eligible packs on both shops.

---

## 2. Transition matrix

| Legacy → Canonical | Count |
|---|---|
| `park_for_review` → `hold_for_deadline` | 71 |
| `block` → `hold_for_deadline` | 18 |
| `auto_file` → `auto_file` *(unchanged)* | 13 |
| `block` → `block` *(unchanged)* | 1 |
| `block` → `park_for_review` | 1 |

Per shop:

| Shop | Legacy | Canonical |
|---|---|---|
| blume-box | `auto_file` 3 · `block` 19 · `park_for_review` 55 | `auto_file` 3 · `block` 1 · `hold_for_deadline` 73 |
| surasvenne | `auto_file` 10 · `block` 1 · `park_for_review` 16 | `auto_file` 10 · `park_for_review` 1 · `hold_for_deadline` 16 |

**Nothing that files today stops filing.** All 13 `auto_file` cases keep filing, and no case moves
from a filing disposition to a non-filing one. Every movement is in the other direction: a case the
legacy path refuses outright becomes a case the deadline path will file.

---

## 3. Drift classification

§9.4's rule: a transition inside a declared category is classified; anything outside all of them
blocks until explained.

| Category | Count |
|---|---|
| `revision_2_strength_never_hard_blocks_rung6` | 18 |
| `revision_2_moderate_holds_rung9` | 71 |
| `persisted_score_not_reproducible_by_current_engine` | 0 |
| `persisted_strength_stale_vs_recompute` | 0 |
| `legacy_no_strength` | 1 |
| `hash_churn_r4` | 0 |
| **UNEXPLAINED** | **0** |

Two categories were added to §9.4's four, **declared before the run**, because §9.4's set was
written for the P-slice comparisons where both arms shared the guard ladder. This replay compares
the ladder to the decision, and contract revision 2 deliberately changed one disposition. They are
counted separately, by rung, so each can be checked against the source:

- **rung 6** — `deriveCaseAutomationDecision.ts:262`. Weak/insufficient strength no longer
  hard-blocks; it holds for the clock. 18 cases, all `legacy=guard:weak`.
- **rung 9** — `deriveCaseAutomationDecision.ts:289`, "MODERATE HOLDS". 71 cases, all
  `legacy=guard:moderate_strength`, canonical `[eligible]`.

`legacy_no_strength` is one surasvenne case (`69849240`, score 33 against threshold 50) that the
legacy gate **blocks** and the decision **parks**. Neither files; the difference is which surface
the merchant sees.

### 3a. Two corrections made to the harness during the run

Both are recorded because each one silently produced a *better-looking* answer than the truth.

1. **The classifier's fall-through was `persisted_strength_stale_vs_recompute`.** It drove
   UNEXPLAINED to zero by relabelling 72 cases nobody had looked at. The fall-through is now
   `UNEXPLAINED`, and the 72 were then explained properly — rung 9.
2. **`park` and `block` were collapsed** into one legacy disposition on the grounds that neither
   files. It manufactured one spurious transition: a fatal-loss case the legacy guards *block* and
   the decision also *blocks*, reported as `park_for_review → block` because only the label had
   moved. The two verdicts are now kept apart.

---

## 4. Selector arm

84 open cases carry a defence package (239 candidate versions). Both triggers, every case:

| Trigger | Outcome | Count |
|---|---|---|
| `normal` | `none: stale / snapshot_absent` | 84 |
| `deadline` | `none: stale / snapshot_absent` | 84 |

**This is §1A's predicted answer, and it is the most important line in the replay.** Production
carries no canonical identity columns — `20260810120000_defence_package_canonical_identity.sql` is
applied to **dev only**, PR 2 being dark — so `plan_json`, `plan_input_hash`, `policy_version` and
`artifact_id` do not exist on prod. Every live package is therefore the post-R4 legacy shape, and
the selector refuses all of them.

That is the state on the day the switch flips *and before the rebuild runs*: **the canonical route,
activated without the §9.3 rebuild, would file nothing at all.** The rebuild is not an optimisation;
it is a precondition for PR 3 to file anything.

---

## 5. §9.3's precondition

> The rebuild must not change what the still-live legacy path reads or files.

Checked directly: the legacy arm was computed twice per case, once over `pack_json` as stored and
once with `case_assessment` and `case_assessment_gates` **stripped**. A case whose disposition
differs between the two is a case the rebuild would move.

**0 of 104.** The rebuild writes only fields the legacy path does not read.

The expected non-empty answer was the P-7 activated set — but P-7's canonical branch is not reached
anywhere in prod today, for the reason in §6, so the check comes back empty for a second reason as
well. It will need re-running after the rebuild, when blume-box packs do carry a usable snapshot.
**Recorded as a limitation of this run, not as a clean result.**

---

## 6. P-7 is activated and currently inert

**0 of 104 packs carry `case_assessment`** (0 usable). The CP-A writer shipped in PR 1 but only runs
inside `buildPack`, and no pack has been rebuilt since the merge. So
`resolveEffectiveCompleteness` returns `source: "legacy"` for every case in production, including
every blume-box case.

The activation is correct and inert. It becomes load-bearing at the §9.3 rebuild, and the replay
should be re-run at that point — the canonical scale moved 90 packs by −1…−7 and 15 by +2…+17
against the persisted column at calibration, and none of that movement is visible in the table above.

Incidental confirmation from the run: blume-box's own `auto_save_min_score` is **60**, the same
number as the calibrated canonical threshold. The two are unrelated and their coincidence makes the
legacy/canonical distinction invisible in the threshold column — which is precisely why
`resolveEffectiveCompleteness` carries `source` alongside the numbers.

---

## 7. C-11 census — §7.2's invariant

> 212 of 280 package versions blocked, across 91 disputes. A different count on the same population
> is wrong until explained.

Re-run through the real `assessPackageCandidateSafety`
([`scripts/evidence-model/c11PackageSafetyCensus.analysis.ts`](../../../scripts/evidence-model/c11PackageSafetyCensus.analysis.ts)):

**212 blocked, across 91 disputes.** Denominator 280 → **286**: six package versions have been
created since the census. Blocked count and dispute count are **unchanged**, which is the invariant.

Reasons: `retired_delivery_fact` 162 · `affirmative_address_delivery_claim` 157 ·
`ambiguous_address_delivery_claim` 134 · `unreadable_facts_json` 39 · `unreadable_narrative_json` 39.

Measured directly rather than through the selector: with no canonical identity on prod, staleness
short-circuits before the content verdict is ever consulted (§4), so the selector arm cannot
reproduce this number and would have reported it as zero.

---

## 8. Verdict

- Every transition is classified. **UNEXPLAINED = 0.**
- No case moves from filing to not-filing. 13 auto-filing cases are untouched.
- 89 cases move from "refused outright" to "held for the deadline" — contract revision 2's two
  rungs, exactly as designed, and the reason the revision exists.
- The §9.3 rebuild does not disturb the legacy path (0 of 104), **subject to §5's limitation**.
- Activating without the rebuild would file **nothing** (84 of 84 stale).
- C-11's blocked population is preserved exactly.

**Nothing here is a go/no-go for PR 3 on its own** — the rebuild has to run first, and the replay
has to be re-run after it, because P-7's canonical branch and the selector's content verdict are
both unreachable until packs carry a usable snapshot.
