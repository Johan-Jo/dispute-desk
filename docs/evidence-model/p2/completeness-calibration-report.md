# Completeness calibration — P-7, and how it was decided

## Status: ACTIVATED

**Blume Box runs on canonical completeness at threshold 60. SuraSvenne is
excluded, because no disposition-preserving threshold exists for it at any
value.**

That is the whole result. It is live in code — `lib/evidence/model/
completenessActivation.ts` holds the shop set and the threshold, the auto-save
gate reads them, and `tests/unit/p7CompletenessActivation.test.ts` proves the
same pack gets two different dispositions on the two shops through the real
gate path. A threshold that exists only in this file changes nothing, which is
what the previous version of this report described for four months while
calling it a recommendation.

**This document previously said "P-7 remains deferred and unapproved."** That
had been untrue since 2026-08-09, when P-7 was taken as a kickoff constant
(plan §1A). The claim is removed rather than annotated: a report that states
its own conclusion twice, in two directions, is read by whoever opens it first.

| | |
|---|---|
| Decision | plan `docs/plans/canonical-pipeline-lite.plan.md` §1A, maintainer, 2026-08-09 |
| Activated | `blume-box.myshopify.com` — canonical completeness, threshold **60** |
| Excluded | `surasvenne.myshopify.com` — no disposition-preserving threshold exists |
| Owner in code | `lib/evidence/model/completenessActivation.ts` |
| Applied at | the auto-save gate in `lib/automation/pipeline.ts` |
| Proven by | `tests/unit/p7CompletenessActivation.test.ts` (through `evaluateAndMaybeAutoSave`) |

### Why SuraSvenne is excluded, and not "pending"

Under the live baseline the candidate semantics **reorder rather than
rescale**: the weakest auto-filing pack sits at 23 and a blocked pack at 24, so
there is no threshold value that leaves all ten eligible packs on their current
disposition. C-14 cleared one of its three prerequisites and does not fix
reordering; 2 of its 10 eligible packs remain unreadable. Under P-7's own rule
that resolves to *excluded*, and the CP-0 census found SuraSvenne has **zero**
open unsubmitted cases — it is absent from the rebuild population entirely.

"Deferred" implies a pending decision. There is none.

---

## Provenance

**Queried:** 2026-08-09T15:45:32Z (CP-A re-run) against **prod**
(`aokhplydttxtebvbeuzc`), read-only over PostgREST GETs with credentials from an
explicit `ANALYSIS_ENV_FILE`. The Supabase CLI link was never touched.
An earlier run (2026-08-06T21:36:32Z) is reported in §§1–9 below; where the two
differ, **the 2026-08-09 numbers are current**.
**Harness:** `scripts/evidence-model/completenessThreshold.analysis.ts`
**Contract:** `scripts/evidence-model/calibration/completenessCalibration.ts`
**Raw rows:** `docs/evidence-model/p2/calibration-data.json` (2026-08-09 run)
**Reproduce:** `npm run analysis:evidence -- scripts/evidence-model/completenessThreshold.analysis.ts`

---

## 1. Headline

| | |
|---|---|
| Population | **115 packs on open disputes** (`disputes.final_outcome IS NULL`), 2 shops |
| Packs that can reach the completeness gate | **19** (blume-box 9, surasvenne 10) |
| **Operational** crossings among eligible packs (persisted-live → candidate) | **3** — all surasvenne |
| **Semantic** crossings among eligible packs (recalculated → candidate) | **2** — all surasvenne |
| Transitions classified | **115 / 115 — none unclassified** |
| `unresolved_blocker` | **10** |

**blume-box: recommendation retained (keep 60), and now supported by the live
baseline — 9 of 9 eligible packs auto-file today and still auto-file under the
candidate, 0 crossings, no eligible pack is a blocker.**

**surasvenne: blocked**, now for two independent reasons — 4 of its 10 eligible
packs are `unresolved_blocker`, and under the live baseline **no
disposition-preserving threshold exists at all** (one did under the
recalculated baseline; it was an artifact of that baseline).

---

## 2. Three methodological corrections

All three were found by measuring. Each would have changed the report's answer.

### 2.1 The population was selected by the very gate being calibrated

The original harness read `evidence_packs` with `status = 'ready'`. A pack that
**passes** the gate is immediately moved to `saved_to_shopify`
(`pipeline.ts:813-821`), so `'ready'` is precisely the complement of "packs
that cleared the gate."

Run that way it reported **zero eligible packs on both shops** and concluded the
threshold decides nothing. It had already decided; the winners had left the set.
73 → 115 packs, eligible 0 → 19.

### 2.2 `proceed` is three justifications, not one

`evaluateAutoSubmitGuards` returns `proceed` for Strong, for a fully-covering
prior credit, **and** for a pack whose `pack_json.case_strength` is absent.

| shop | eligible | via Strong | via credit | via *no recorded strength* |
|---|---|---|---|---|
| blume-box | 9 | 8 | 1 | 0 |
| surasvenne | 10 | 0 | 0 | **10** |

### 2.3 The gate reads persisted columns, not a recalculated score

`evaluateAndMaybeAutoSave` does not recompute completeness. It reads the row
(`pipeline.ts:804-811`):

```
completenessScore:    pack.completeness_score   ?? 0
blockers:             pack.blockers             ?? []
submissionReadiness:  pack.submission_readiness ?? undefined
```

67 of 115 packs carry a `completeness_score` the current engine no longer
reproduces (§7.1). A calibration that answers "what does the gate do today" by
re-running the engine silently substitutes a score production has never seen for
the one production reads.

The harness now carries **two baselines**, and they answer different questions:

| baseline | definition | used for |
|---|---|---|
| **operational** — persisted-live | `evaluateAutoSaveGate` over `completeness_score`, `submission_readiness`, `blockers`, exactly as `pipeline.ts` calls it | crossing counts, threshold trade-offs, recommendations |
| **semantic** — recalculated-current | `evaluateAutoSaveGate` over the current engine re-run now | attribution (§6) only |

Attribution stays on the semantic baseline deliberately: the harness must be
able to reproduce a baseline from the model before it may attribute a change
away from it, and a persisted snapshot written by an older engine is
unreproducible by construction. Classifying against it would mark most of the
fleet `harness_cannot_reproduce_current_engine` and attribute nothing.

Three faithful details a re-implementation would get wrong, each of which
changes an answer: `?? 0` (a NULL score is 0, not "skip"), `?? undefined` for
readiness (which drops the gate onto the **legacy blocker-count** path rather
than the readiness path), `?? []` for blockers. All three are pinned by test.

---

## 3. The candidate completeness contract, as implemented

Four named, independently ablatable rules. The ablation is the attribution
mechanism: when a pack's outcome changes, the harness flips exactly one rule at
a time and reports which one moved it.

| Rule | Candidate | Today | Meaning |
|---|---|---|---|
| `excludeUnavailableFromDenominator` | `true` | `true` | A row this **order** cannot produce leaves the denominator entirely. |
| `waivedCountsSatisfied` | `true` | `true` | A waived row counts as **satisfied** and is never reported as **available**. |
| `requireUsableEvidence` | **`true`** | **`false`** | A row is satisfied by ≥1 record with `validity.state === "valid"`. Today any *collected* field satisfies its row. |
| `excludeNotApplicable` | **`true`** | **`false`** | P-1 (Slice 1, #515): a `not_applicable` record enters neither numerator nor denominator. |

Only the bottom two differ. The top two are carried as flags so the report can
**measure** that they are inert rather than assert it (§7.3).

### 3.1 Completeness is independent of strength

The projection reads exactly six things per field — `relevance`,
`status.applicable`, `status.available`, `status.waived`, `status.blocking`,
`records.length` — and never `summary.quality`, a record's `quality`, or
`calculateCaseStrength`. The one place the concepts touch is `status.available`,
a **validity** judgement: an AVS payload with no matching codes is `invalid`
(sound, proves nothing), while a `contextual` record is valid and merely weak.
Proved over the full valid-quality cross-product, with a control asserting the
same fixtures do move the strength scorer.

### 3.2 What the candidate is *not*

`definitionFor(field).relevance(reason)` is derived **from**
`REASON_TEMPLATES_V2` (`lib/evidence/model/definitions.ts:128`). "Absent from
the template" and `not_applicable` are the same set, so the candidate row set is
**not wider** than today's — under P-1 it is narrower.

---

## 4. Score distributions

| shop | engine | 0s | 20s | 30s | 40s | 50s | 60s | 70s | 80s | 90s | mean |
|---|---|---|---|---|---|---|---|---|---|---|---|
| blume-box (86) | current | | | | | 1 | 4 | 7 | 8 | 66 | 91.6 |
| blume-box (86) | candidate | | | | 3 | 3 | 7 | 67 | 5 | 1 | 72.1 |
| surasvenne (29) | current | 2 | 1 | | 2 | 3 | 3 | 7 | 6 | 5 | 66.9 |
| surasvenne (29) | candidate | 2 | 2 | 1 | 3 | 5 | 12 | 4 | | | 53.4 |

Mean shift: blume-box **−19.5**, surasvenne **−13.5**.

---

## 5. Gate outcomes — both baselines, reported separately

Thresholds are read per shop from `shop_settings` and never defaulted. Both
shops had a readable row.

| shop | thr | baseline | scope | old auto | old block | new auto | new block | **crossings** |
|---|---|---|---|---|---|---|---|---|
| blume-box | 60 | operational | all 86 | 84 | 2 | 80 | 6 | 4 |
| blume-box | 60 | operational | **eligible 9** | 9 | 0 | 9 | 0 | **0** |
| blume-box | 60 | semantic | all 86 | 85 | 1 | 80 | 6 | 5 |
| blume-box | 60 | semantic | **eligible 9** | 9 | 0 | 9 | 0 | **0** |
| surasvenne | 50 | operational | all 29 | 26 | 3 | 21 | 8 | 5 |
| surasvenne | 50 | operational | **eligible 10** | 8 | 2 | 5 | 5 | **3** |
| surasvenne | 50 | semantic | all 29 | 24 | 5 | 21 | 8 | 3 |
| surasvenne | 50 | semantic | **eligible 10** | 7 | 3 | 5 | 5 | **2** |

Fleet-wide operational transitions: `auto_save→auto_save` 101,
`auto_save→block` 9, `block→block` 5. No pack moves `block→auto_save`.

### 5.1 Every live-vs-recalculated disagreement (3 of 115)

| shop | order | persisted | readiness | blockers | recalculated | live → / semantic → | eligible |
|---|---|---|---|---|---|---|---|
| surasvenne | #1068 | 71 | `ready` | 1 | 23 | **auto_save** / block | **yes** |
| surasvenne | 6fb2851a | 90 | `submitted` | 0 | 41 | **auto_save** / block | no |
| blume-box | #352501 | 58 | `ready_with_warnings` | 1 | 67 | **block** / auto_save | no |

Two of these change what the report says:

**surasvenne #1068 is an operational crossing the semantic baseline misses
entirely.** Its persisted score is 71 and it auto-files today; recalculated it
is 23. The semantic baseline sees `block → block` and classifies it
`current_correct_preserved` — no change. The live baseline sees
`auto_save → block`: a pack that files today would stop. This is exactly the
gap the second baseline exists to close, and it is why surasvenne's eligible
crossing count is 3 operationally and 2 semantically.

**blume-box #352501 does not move operationally at all.** It is the one
`intended_policy_change_requires_approval` pack (§6.3). Semantically it is
`auto_save → block`; operationally it is `block → block`, because its persisted
score of 58 is already under the shop's threshold of 60. So the P-1 row-set
change has **zero measured operational effect** on this fleet — it still needs
approval as a semantics matter, but it is not changing a live disposition.

---

## 6. Transition classification — all 115, none unclassified

Classified against the **semantic** baseline, for the reason in §2.3.

| class | blume-box | surasvenne | total |
|---|---|---|---|
| `current_correct_preserved` | 81 | 23 | **104** |
| `current_wrong_corrected` | 0 | 0 | **0** |
| `intended_policy_change_requires_approval` | 1 | 0 | **1** |
| `unresolved_blocker` | 4 | 6 | **10** |

Classification is total over its input and proved by enumeration in CI over the
full cross-product of outcomes, missing-input sets, single-flag attributions and
the contamination flag.

### 6.1 BLOCKER — `evidence_semantics_mismatch`, `billing_address_match` (7 packs)

**This is not a plumbing bug, and neither obvious mechanical fix is justified.**

`canonicalEvidence.ts:153-160` defines the signal:

> `billing_address_match` — category `strong`. *"Strong when AVS-confirmed
> billing matches the cardholder. Invalid otherwise."*

`orderSource.ts:109-113` emits it on a different fact entirely:

```ts
const match =
  billingRedacted.city === shippingRedacted.city &&
  billingRedacted.countryCode === shippingRedacted.countryCode;
if (match) fieldsProvided.push("billing_address_match");
```

That compares Shopify's **billing address to its shipping address** — two
merchant-held addresses — on city and country. There is no AVS anywhere in it,
and no cardholder anywhere in it. The grader asks `p.match === true`
(`canonicalEvidence.ts:502-504`), a key the section payload does not contain, so
the field grades `invalid` on every pack that has it.

Fleet census, this run:

| field | collected | graded `valid` | |
|---|---|---|---|
| `order_confirmation` | 112 | 112 | |
| `activity_log` | 111 | 111 | |
| `avs_cvv_match` | 108 | 105 | |
| **`billing_address_match`** | **95** | **0** | ← semantics mismatch |
| `fraud_risk_screening` | 85 | 7 | payload-dependent, not a mismatch |
| `delivery_proof` | 62 | 62 | |

**Neither mechanical fix is acceptable.** Writing `match: true` into the payload,
or teaching the grader to read the field's presence, would both promote
**billing/shipping geographic similarity into strong AVS-confirmed cardholder
evidence** — a materially stronger claim than the data supports, on a signal
whose canonical category is `strong`, and one that reaches an issuer. An earlier
draft of this report framed the choice as "pick a side." That framing was wrong
and is retracted.

**The grader's `invalid` is the safe answer.** Current runtime behaviour is not
the defect; it is the thing preventing the overclaim. What is unresolved is
that two files own the meaning of one field name and name different facts with
it.

> **Explicit statement for the record: the current collector output must NOT be
> treated as strong `billing_address_match` evidence.** Billing/shipping city
> and country agreement is not an AVS confirmation and is not a cardholder
> match. Any future change here must decide what fact the field names and what
> the collector is actually able to substantiate — a separate evidence-semantics
> and ownership decision, out of scope for PR 2.0 and not made here.

**Runtime code is untouched by this PR.**

Affected packs (all `auto_save → block` on both baselines, cause
`requireUsableEvidence`):

| shop | order | reason | recalc | candidate | thr | eligible |
|---|---|---|---|---|---|---|
| blume-box | #346588 | FRAUDULENT | 77 | 55 | 60 | no |
| blume-box | #352772 | FRAUDULENT | 77 | 55 | 60 | no |
| blume-box | #352773 | FRAUDULENT | 77 | 55 | 60 | no |
| blume-box | #352796 | FRAUDULENT | 74 | 47 | 60 | no |
| surasvenne | 81e9b356 | FRAUDULENT | 77 | 42 | 50 | no |
| surasvenne | 065bf902 | FRAUDULENT | 77 | 42 | 50 | **yes** |
| surasvenne | 535efddc | FRAUDULENT | 77 | 42 | 50 | **yes** |

Why this is a blocker for *calibration*: if the `invalid` grade were counted as
"collected but not usable", the report would show the usable-evidence rule
stripping real evidence off every fraud pack, and the natural response — lower
the shop threshold to compensate — would bake an unsettled evidence question
into a setting. The harness detects the class generically (a field collected ≥3
times and never valid), not by special-casing this field.

### 6.2 BLOCKER — missing or unreadable pack inputs (3 packs, surasvenne)

| order | blocker | eligible | operational |
|---|---|---|---|
| #1061 | `unparseable_checklist` | **yes** | block → block |
| #1080 | `unparseable_checklist` | no | block → block |
| #1077 | `missing_pack_sections` | **yes** | block → block |

`checklist_v2` is null/non-array, or `pack_json.sections` is empty. The harness
reconstructs order applicability from the persisted checklist, so with no
checklist every conditional field reads "this order cannot produce it" — a
fabricated input. The outcomes agree on all three, but agreement produced from
fabricated inputs is not evidence that nothing changes.

Same class as the null-checklist fix in PR #506, which made the *read path*
defensive. These rows show packs still persisted in that state on prod.

### 6.3 REQUIRES APPROVAL — P-1 row-set change (1 pack)

**blume-box #352501, DUPLICATE, recalculated 67 → candidate 48, threshold 60,
cause `excludeNotApplicable`, ineligible.**

The `DUPLICATE` template has three rows. This order collected twelve further
canonical fields, which `reconcileChecklistWithCollectedFields` appends at
`optional` and counts satisfied. Under P-1 they are `not_applicable` and enter
neither side of the ratio. Ablation confirms P-1 is the sole cause
(`requireUsableEvidence` alone → 64, still above 60; `excludeNotApplicable`
alone → 48).

**Operationally it does not move** (§5.1): its persisted score is 58, already
below 60, so it is `block → block` today and under the candidate. P-1 is
approved as *semantics*; its effect on a *disposition* is what P-7 was deferred
to decide, and this remains the one demonstrated case of the rule moving a
semantic outcome. It needs sign-off before deployment, but nothing on this fleet
changes because of it.

---

## 7. Supporting findings

### 7.1 Persisted scores are stale on 67 of 115 packs

The gate reads `pack.completeness_score`, written at build. The current engine
disagrees with it on **67 of 115** packs, in both directions (`#1076` persisted
100 / recalculated 70; `#1061` persisted 33 / recalculated 45; `#1077` persisted
`null` / recalculated 0). Only 3 of those 67 change the **disposition** (§5.1) —
most differences are within the slack between the score and the threshold.

This is **independent of Slice 2** and live today: the fleet is gated on a
mixture of engine vintages. Out of scope here, and the reason this report
carries two baselines rather than one.

### 7.2 Ineligibility breakdown

| shop | moderate | weak | fatal_loss | review mode |
|---|---|---|---|---|
| blume-box | 58 | 18 | 1 | 0 |
| surasvenne | 16 | 1 | 0 | 2 |

Moderate strength is the dominant reason a pack never reaches the completeness
gate — 74 of the 96 ineligible packs. Completeness thresholds are a much smaller
lever on this fleet than the strength band is.

`pickAutomationAction` is pure, so rule mode is read without side effects (the
harness does **not** call `evaluateRules`, which writes an audit event).

### 7.3 The two inert rules, measured

- Rows satisfied by waiver: **2 packs** — live but rare.
- Packs with ≥1 unavailable exclusion: **107 of 115** — the
  applicability-exclusion rule does heavy work on nearly every pack, which is
  why the model derivation must be given order context.

Neither changed a gate outcome, because both already hold in production. Now
measured, not assumed.

---

## 8. The threshold measurement (2026-08-06 baseline)

> **Superseded in part.** The activation is stated at the top of this file and
> re-measured in the addendum; this section is the earlier baseline and is kept
> for the threshold BANDS, which are what a future shop set would be chosen
> from. Where the two runs disagree, the addendum is current.

### blume-box — **60, and it sits inside the disposition-preserving band.**

Basis is the **live** baseline: all 9 eligible packs auto-file today
(persisted-live) and all 9 still auto-file under the candidate.

| threshold | newly auto-files | newly blocks | preserved |
|---|---|---|---|
| **60 (current)** | **0** | **0** | **9** |
| 67 | 0 | 0 | 9 |
| 70 | 0 | 1 | 8 |
| 77 | 0 | 3 | 6 |
| 84 | 0 | 8 | 1 |

**Recommendation basis: SOUND — no eligible blume-box pack is an
`unresolved_blocker`.** The four blume-box packs in §6.1 are all *ineligible*,
so resolving that question cannot change this recommendation; it can only
reclassify those four rows. 8 of the 9 eligible packs are genuinely Strong, one
is the credited branch. The disposition-preserving band extends to 67, so 60
sits inside it with headroom.

### surasvenne — **excluded, on two independent grounds.**

Today (persisted-live): 8 of 10 eligible packs auto-file, 2 are blocked.

| threshold | newly auto-files | newly blocks | preserved |
|---|---|---|---|
| 0 | 2 | 0 | 8 |
| 23 | 1 | 0 | 9 |
| 24 | 1 | 1 | 8 |
| 42 | 0 | 1 | 9 |
| **50 (current)** | **0** | **3** | **7** |
| 55 | 0 | 3 | 7 |
| 62 | 0 | 5 | 5 |
| 64 | 0 | 7 | 3 |

**1. No disposition-preserving threshold exists.** Under the live baseline the
weakest pack that auto-files today scores 23 under the candidate, while a pack
blocked today scores 24 — the semantics **reorder** rather than rescale, so some
disposition must change at every threshold. (The recalculated baseline reported
a preserving value of 42; that was an artifact of scoring "today" with numbers
production does not hold, and it does not survive the live baseline.)

**2. Four of the ten eligible packs are `unresolved_blocker`** — `#1061`,
`#1077`, `065bf902`, `535efddc`. Every row of the trade-off table above is
priced partly with numbers this report cannot stand behind.

Compounding both: all 10 of surasvenne's eligible packs reach the gate via
`legacy_no_strength` (§2.2), so even a clean re-run would rest on packs no
strength engine ever judged.

**Prerequisites for a surasvenne recommendation:**
1. Resolve the `billing_address_match` evidence-semantics question (§6.1) —
   a decision about what the field means, not a code fix.
2. Resolve or exclude the 3 packs with missing inputs (§6.2).
3. Re-run the harness. No harness change is needed.

### Shop category

blume-box needs no threshold change to absorb the candidate semantics. The
`−19.5` / `−13.5` mean shift is large but lands almost entirely on packs that
never reach the gate. **The working hypothesis for a fleet-wide default is
"thresholds do not move"** — drawn from 19 eligible packs on 2 shops, one of
which is blocked, so it should not be generalized further without more shops.

---

## 9. Scope, as it stands now

**Changed by the activation:** the auto-save gate reads canonical completeness
at 60 for Blume Box. Nothing else — no other shop, no other gate, no UI, no
schema, no backfill, no job.

Still open, with an owner needed:

1. **`billing_address_match` evidence-semantics / ownership mismatch** (§6.1).
   Retired from the checklist by PR-C4 (C-14), so it no longer blocks the
   threshold; the question of what fact the field NAMES is still unanswered and
   both obvious answers overclaim.
2. **2 SuraSvenne packs with unreadable inputs** (§6.2) — one of the two
   independent grounds for its exclusion.
3. **94 of 106 stale persisted completeness scores** (see the addendum) —
   pre-existing, live, and CP-D's rebuild population, not CP-A's to fix.
4. **`fraud_risk_screening` at 7/85 valid** (§6.1 census) — payload-dependent so
   correctly not flagged, but an 8% validity rate on a FRAUDULENT template field
   is worth its own look.

---

## Addendum — CP-A re-run on the post-C-14 baseline (2026-08-09)

**Queried:** 2026-08-09T15:45:32Z against **prod** (`aokhplydttxtebvbeuzc`), read-only, same
harness and same contract. `docs/evidence-model/p2/calibration-data.json` regenerated from this
run. The CLI link was never touched; the harness reads over PostgREST GETs and takes its
credentials from an explicit `ANALYSIS_ENV_FILE`.

**P-7 was already decided** at kickoff; this re-run applied its rule and produced the shop
set now live in `lib/evidence/model/completenessActivation.ts`. It sought no approval and
granted none.

> blume-box activates at threshold **60**. surasvenne is excluded unless the new calibration
> produces a disposition-preserving result.

**Result: the shop set is blume-box alone, at 60. That set is now the one in code.**

| | blume-box | surasvenne |
|---|---|---|
| Packs on open disputes | 77 | 29 |
| Eligible (can reach the gate) | 3 | 10 |
| Current `auto_save_min_score` | 60 | 50 |
| Disposition-preserving threshold | **77** (60 is inside it: 0 eligible packs change) | **none exists** |
| Recommendation basis | **SOUND** | **BLOCKED** — 2 eligible packs are `unresolved_blocker` (#1061, #1077) |
| Transition classification | 75 preserved · 1 corrected · 1 policy-change · 0 blockers | 26 preserved · 3 `unresolved_blocker` |

C-14 cleared one of surasvenne's three prerequisites and neither of the others. The candidate
semantics still **reorder rather than rescale** there — no threshold value leaves all ten
eligible packs on their current disposition — and 2 of its 10 eligible packs remain unreadable
(`unparseable_checklist` on #1061, `missing_pack_sections` on #1077). Under P-7's own rule
surasvenne therefore stays on the current path and is out of scope for this delivery. That is
consistent with the CP-0 census, which found surasvenne has **zero** open unsubmitted cases and
is absent from the rebuild population entirely.

### Reconciliation against the C-14 anchors

| Anchor (epic brief) | Reproduced? |
|---|---|
| Case-strength changes **0** | ✅ — 0 band changes on the eligible population in both baselines |
| Submission readiness moves in one direction only | ✅ — no eligible pack moves `ready → ready_with_warnings` |
| Citation / LLM-value delta **0** | ✅ — the field was never bank-eligible; nothing to cite |
| `coveragePercent` **96** | **Not reproducible, by design.** `docs/technical.md` marks it *"pre-implementation run only"*: it was measured against a checklist that still carried `billing_address_match`, and PR-C4 retired the row. Post-C-14 code cannot produce it, and requiring it would mandate an unexplainable difference. |
| Affected packs **131** / effectively available **116** | Not re-measurable here — those are `billing_address_match` populations counted by the retirement harness (`billingAddressMatchRetirement.analysis.ts`) against pre-C-14 code, not quantities this harness computes. |

### What the re-run says that is new

**Persisted-vs-runtime drift widened: 94 of 106 packs** (was 67 of 115) carry a
`completeness_score` the current engine no longer reproduces. The gate reads the **persisted**
column, so this is live and independent of any threshold decision — and it is precisely the
condition `SnapshotFreshness.inputHash` exists to make visible instead of silent. It is CP-D's
rebuild population, not CP-A's to fix.

**3 of 106 packs disagree about today**: the persisted snapshot and a fresh recalculation give
different dispositions (surasvenne #1068 and 6fb2851a, blume-box #352501). On those the semantic
baseline is not what production does, which is why §3 reports the two baselines separately and
prices the trade-off from the persisted one.
