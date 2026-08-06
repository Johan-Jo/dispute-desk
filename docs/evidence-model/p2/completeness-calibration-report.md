# Slice 2 / PR 2.0 — completeness calibration report

**Status:** read-only calibration. Nothing here is deployed.
**Queried:** 2026-08-06T21:01:04Z against **prod** (`aokhplydttxtebvbeuzc`, via `.env.production.local`).
**Harness:** `scripts/evidence-model/completenessThreshold.analysis.ts`
**Contract:** `scripts/evidence-model/calibration/completenessCalibration.ts`
**Raw rows:** `docs/evidence-model/p2/calibration-data.json`
**Reproduce:** `npm run analysis:evidence -- scripts/evidence-model/completenessThreshold.analysis.ts`

**The recommendation in §7 is advisory. P-7 remains deferred and unapproved,
and PR 2.1 (deployment) is not authorized.**

---

## 1. Headline

| | |
|---|---|
| Population | **115 packs on open disputes** (`disputes.final_outcome IS NULL`), 2 shops |
| Packs that can actually reach the completeness gate | **19** (blume-box 9, surasvenne 10) |
| Gate-outcome changes among eligible packs, at today's thresholds | **2** (both surasvenne) |
| Transitions classified | **115 / 115 — none unclassified** |
| `unresolved_blocker` | **10** |

**PR 2.0 delivers the harness, the tests and this report. It does not deliver a
usable P-7 decision, because 10 transitions could not be attributed.** The
largest blocker is not a completeness question at all — it is a collector
contract defect that makes one evidence field grade `invalid` on every pack in
the fleet (§5.1). Until it is resolved, "does the candidate score correctly
drop this pack below its threshold?" has no honest answer for the packs it
touches.

---

## 2. Two methodological corrections made during the run

Both were found by measuring, not by reading, and both would have inverted the
report's conclusion. They are recorded here because the numbers below are only
meaningful with them applied.

### 2.1 The population was selected by the very gate being calibrated

The previous harness read `evidence_packs` with `status = 'ready'`. A pack that
**passes** the auto-save gate is immediately moved to `saved_to_shopify`
(`lib/automation/pipeline.ts:813-821`). So `status = 'ready'` is precisely the
complement of "packs that cleared the gate."

Run against that population, the harness reported **zero eligible packs on both
shops** and concluded the threshold decides nothing. The threshold had already
decided; the winners had left the set. Widening to every pack on an open
dispute moved the population from 73 to 115 and the eligible set from 0 to 19.

### 2.2 `proceed` is three different justifications, not one

`evaluateAutoSubmitGuards` returns `proceed` for Strong, for a fully-covering
prior credit, **and** for a pack whose `pack_json.case_strength` is absent
entirely. Counted together, surasvenne looked like a shop with 10 Strong packs.
It has none:

| shop | eligible | via Strong | via credit | via *no recorded strength* |
|---|---|---|---|---|
| blume-box | 9 | 8 | 1 | 0 |
| surasvenne | 10 | 0 | 0 | **10** |

Surasvenne's entire eligible population predates the `case_strength` field.
That is a materially weaker basis for a threshold decision than blume-box's,
and §7 treats the two shops differently because of it.

---

## 3. The candidate completeness contract, as implemented

Four named, independently ablatable rules. The ablation is the attribution
mechanism: when a pack's gate outcome changes, the harness flips exactly one
rule at a time and reports which one moved it.

| Rule | Candidate | Today | Meaning |
|---|---|---|---|
| `excludeUnavailableFromDenominator` | `true` | `true` | A row this **order** cannot produce leaves the denominator entirely — neither satisfied nor a gap. An unfulfilled order is not penalised for having no delivery proof. |
| `waivedCountsSatisfied` | `true` | `true` | A waived row counts as **satisfied** and is never reported as **available**. Waiving removes a blocker; it does not conjure evidence. |
| `requireUsableEvidence` | **`true`** | **`false`** | A row is satisfied by ≥1 record with `validity.state === "valid"`. Today any *collected* field satisfies its row, so an AVS payload of `N`/`N` counts exactly like a matching one. |
| `excludeNotApplicable` | **`true`** | **`false`** | P-1 (Slice 1, #515): a `not_applicable` record enters neither numerator nor denominator. Today `reconcileChecklistWithCollectedFields` appends such fields at `optional`. |

Only the bottom two differ, so those two are the entire delta. The top two are
carried as flags so the report can **measure** that they are inert on this
fleet rather than assert it (§6.4).

### 3.1 Completeness is independent of strength

The projection reads exactly six things per field — `relevance`,
`status.applicable`, `status.available`, `status.waived`, `status.blocking`,
`records.length` — and never `summary.quality`, a record's `quality`, or
`calculateCaseStrength`.

The one place the concepts touch is `status.available`, which is a **validity**
judgement, not a strength one. The canonical vocabulary separates them
deliberately: an AVS payload with no matching codes is `invalid` (sound, proves
nothing), while a `contextual` record is perfectly valid and merely weak.
`tests/unit/completenessCalibration.test.ts` proves the independence over the
full valid-quality cross-product, with a control asserting the same fixtures do
move the strength scorer.

### 3.2 What the candidate is *not*

`definitionFor(field).relevance(reason)` is derived **from**
`REASON_TEMPLATES_V2` (`lib/evidence/model/definitions.ts:128`). "Absent from
the template" and `not_applicable` are therefore the same set, so the candidate
row set is **not wider** than today's — under P-1 it is narrower. Any account
of this slice that describes it as widening the denominator with new required
evidence is wrong.

---

## 4. Per-shop results

### 4.1 Score distributions

| shop | engine | 0s | 20s | 30s | 40s | 50s | 60s | 70s | 80s | 90s | mean |
|---|---|---|---|---|---|---|---|---|---|---|---|
| blume-box (86) | current | | | | | 1 | 4 | 7 | 8 | 66 | 91.6 |
| blume-box (86) | candidate | | | | 3 | 3 | 7 | 67 | 5 | 1 | 72.1 |
| surasvenne (29) | current | 2 | 1 | | 2 | 3 | 3 | 7 | 6 | 5 | 66.9 |
| surasvenne (29) | candidate | 2 | 2 | 1 | 3 | 5 | 12 | 4 | | | 53.4 |

Mean shift: blume-box **−19.5**, surasvenne **−13.5**. The candidate scores
lower everywhere, as expected — it stops counting collected-but-unusable
evidence and stops counting appended not-applicable rows.

### 4.2 Gate outcomes at each shop's own `auto_save_min_score`

Thresholds are read per shop from `shop_settings` and never defaulted; a shop
whose row could not be read produces a `missing_shop_settings` blocker rather
than a house number. Both shops had a readable row.

| shop | thr | scope | old auto | old block | new auto | new block | **crossings** |
|---|---|---|---|---|---|---|---|
| blume-box | 60 | all 86 | 85 | 1 | 80 | 6 | 5 |
| blume-box | 60 | **eligible 9** | 9 | 0 | 9 | 0 | **0** |
| surasvenne | 50 | all 29 | 24 | 5 | 21 | 8 | 3 |
| surasvenne | 50 | **eligible 10** | 7 | 3 | 5 | 5 | **2** |

The `all` rows are context. Only the `eligible` rows are operationally real: a
pack that parks for review, is covered, is fatally lost, or is Moderate never
reaches `evaluateAutoSaveGate` at all, so its "crossing" changes nothing.

**blume-box: zero eligible crossings at its current threshold.**
**surasvenne: two eligible packs move `auto_save → block`** — and both are
`unresolved_blocker`, not findings (§5.1).

---

## 5. Transition classification — all 115, none unclassified

| class | blume-box | surasvenne | total |
|---|---|---|---|
| `current_correct_preserved` | 81 | 23 | **104** |
| `current_wrong_corrected` | 0 | 0 | **0** |
| `intended_policy_change_requires_approval` | 1 | 0 | **1** |
| `unresolved_blocker` | 4 | 6 | **10** |

Classification is total over its input and proved by enumeration in CI over the
full cross-product of outcomes, missing-input sets, single-flag attributions and
the contamination flag. `unresolved_blocker` is the honest bucket, never a
fallthrough.

### 5.1 BLOCKER — `suspected_collector_contract_defect` (7 packs)

`lib/packs/sources/orderSource.ts:109-114` encodes "the billing address
matches" by **pushing `billing_address_match` into `fieldsProvided`** only when
it does. The flag lives in the field's *presence*. But
`categorizeEvidenceField` asks a different question —
`canonicalEvidence.ts:502-504`: `p.match === true` — and no collector writes a
`match` key into the section payload.

Fleet census, this run:

| field | collected | graded `valid` | |
|---|---|---|---|
| `order_confirmation` | 112 | 112 | |
| `activity_log` | 111 | 111 | |
| `avs_cvv_match` | 108 | 105 | |
| **`billing_address_match`** | **95** | **0** | ← structural defect |
| `fraud_risk_screening` | 85 | 7 | payload-dependent, not a defect |
| `delivery_proof` | 62 | 62 | |

95 collected, 0 valid. This is not a fleet whose billing addresses fail to
match — it is a broken contract between two files, and it is **pre-existing**:
`calculateCaseStrength` reads the same payload through the same categorizer, so
production already scores this field `invalid` everywhere.

**Why this is a blocker and not a finding.** `requireUsableEvidence` drops the
field on all 7 packs, and on all 7 that drop is what moves the pack below its
threshold. Classified as `current_wrong_corrected`, the report would tell a
maintainer that the usable-evidence rule caught 7 packs auto-filing on bad
evidence — when in fact it caught a collector bug. The obvious response to such
a finding is to lower the shop's threshold to compensate, which would bake the
bug into a setting.

Affected (all `auto_save → block`, cause `requireUsableEvidence`):

| shop | order | reason | current | candidate | thr | eligible |
|---|---|---|---|---|---|---|
| blume-box | #346588 | FRAUDULENT | 77 | 55 | 60 | no |
| blume-box | #352772 | FRAUDULENT | 77 | 55 | 60 | no |
| blume-box | #352773 | FRAUDULENT | 77 | 55 | 60 | no |
| blume-box | #352796 | FRAUDULENT | 74 | 47 | 60 | no |
| surasvenne | 81e9b356 | FRAUDULENT | 77 | 42 | 50 | no |
| surasvenne | 065bf902 | FRAUDULENT | 77 | 42 | 50 | **yes** |
| surasvenne | 535efddc | FRAUDULENT | 77 | 42 | 50 | **yes** |

Two are eligible, and they are **exactly** surasvenne's two eligible crossings
in §4.2. So surasvenne's entire measured operational impact rests on this
defect.

**Resolution required before P-7 can be decided.** Someone must decide which
side of the contract is right — either the collector writes `match: true` into
the payload, or the categorizer reads presence. That is a product/ownership
decision about an evidence definition, not a completeness threshold, and this
report does not make it. Once resolved, re-run the harness; these 7 packs will
reclassify with no change to the harness.

### 5.2 BLOCKER — missing or unreadable pack inputs (3 packs, surasvenne)

| order | blocker | eligible | outcome |
|---|---|---|---|
| #1061 | `unparseable_checklist` | yes | block → block |
| #1080 | `unparseable_checklist` | no | block → block |
| #1077 | `missing_pack_sections` | yes | block → block |

`checklist_v2` is null/non-array, or `pack_json.sections` is empty. The harness
reconstructs order applicability from the persisted checklist, so with no
checklist every conditional field reads "this order cannot produce it" — a
fabricated input. The outcomes happen to agree on all three, but agreement
produced by fabricated inputs is not evidence that nothing changes, so they are
reported as blockers rather than as preserved.

This is the same class as the null-checklist blank-page fix in PR #506, which
made the *read path* defensive. These rows show packs still persisted in that
state on prod.

### 5.3 REQUIRES APPROVAL — P-1 row-set change (1 pack)

**blume-box #352501, DUPLICATE, current 67 → candidate 48, threshold 60,
`auto_save → block`, cause `excludeNotApplicable`, ineligible.**

The `DUPLICATE` template has three rows (`order_confirmation`,
`duplicate_explanation`, `supporting_documents`). This order collected twelve
further canonical fields — `billing_address_match`, `activity_log`,
`avs_cvv_match`, `shipping_tracking`, `delivery_proof`, four policies,
`customer_communication`, `customer_account_info`, `ip_location_check`,
`no_return_initiated`. Today `reconcileChecklistWithCollectedFields` appends
each at `optional` and counts it satisfied, lifting the score. Under P-1 they
are `not_applicable` and enter neither side of the ratio.

Ablating the flag alone reproduces today's outcome (`requireUsableEvidence`
alone → 64, still above 60; `excludeNotApplicable` alone → 48). So P-1 is the
sole cause.

P-1 is approved as **semantics**; its effect on a **disposition** is what P-7
was deferred to decide. This pack is currently ineligible (Moderate), so the
change is not operationally live — but it is the one demonstrated case of the
approved row-set rule moving a gate outcome, and it needs sign-off before
deployment.

---

## 6. Supporting findings

### 6.1 Persisted scores are already stale on 67 of 115 packs

`evaluateAutoSaveGate` reads `pack.completeness_score` — the value persisted at
build. The current engine, re-run now, disagrees with it on **67 of 115** packs,
in both directions (`#1076` persisted 100 / runtime 70; `#1061` persisted 33 /
runtime 45; `#1077` persisted `null` / runtime 0).

This is **independent of Slice 2** and live today: a template change silently
re-decides nothing until a rebuild, so the fleet is gated on a mixture of engine
vintages. It is not in this PR's scope, and it is why this report compares the
candidate against the engine **re-run now** rather than against the persisted
column — comparing to persisted would measure template drift and attribute it
to Slice 2.

### 6.2 Rule mode is observable, and two packs are review-mode

`pickAutomationAction` is pure, so the harness reads `rules` and evaluates rule
mode without side effects (it does **not** call `evaluateRules`, which writes an
audit event). Two surasvenne packs resolve to `review` and are correctly
excluded from the eligible population.

### 6.3 Ineligibility breakdown

| shop | moderate | weak | fatal_loss | review mode |
|---|---|---|---|---|
| blume-box | 58 | 18 | 1 | 0 |
| surasvenne | 16 | 1 | 0 | 2 |

Moderate strength is the dominant reason a pack never reaches the completeness
gate — 74 of the 96 ineligible packs. Completeness thresholds are a much smaller
lever on this fleet than the strength band is.

### 6.4 The two inert rules, measured

- Rows satisfied by waiver: **2 packs**. The waiver path is live but rare.
- Packs with ≥1 unavailable exclusion: **107 of 115**. The
  applicability-exclusion rule is doing heavy work on almost every pack — which
  is why the model derivation must be given order context, and why omitting it
  reads ~30 points low.

Neither rule changed a single gate outcome, because both already hold in
production. That is now measured, not assumed.

---

## 7. P-7 recommendation (advisory)

### blume-box — **keep `auto_save_min_score` at 60. No change.**

| threshold | newly auto-files | newly blocks | preserved |
|---|---|---|---|
| **60 (current)** | **0** | **0** | **9** |
| 67 | 0 | 0 | 9 |
| 70 | 0 | 1 | 8 |
| 77 | 0 | 3 | 6 |
| 84 | 0 | 8 | 1 |

Every eligible pack keeps its disposition at 60. The highest
disposition-preserving value is 67, so 60 sits comfortably inside the safe band
with headroom — no reason to move it, and moving it upward would start blocking
at 70. Confidence is reasonable: 8 of the 9 eligible packs are genuinely Strong,
one is the credited branch.

Note the four blume-box packs in §5.1 are all **ineligible**, so resolving that
defect cannot change this recommendation for blume-box — it can only change the
classification of those four rows.

### surasvenne — **no recommendation. Blocked.**

| threshold | newly auto-files | newly blocks | preserved |
|---|---|---|---|
| 0 | 3 | 0 | 7 |
| 23 | 2 | 0 | 8 |
| 24 | 1 | 0 | 9 |
| **42** | **0** | **0** | **10** |
| **50 (current)** | **0** | **2** | **8** |
| 55 | 0 | 2 | 8 |
| 62 | 0 | 4 | 6 |
| 64 | 0 | 6 | 4 |

42 is the arithmetically disposition-preserving threshold. **Do not adopt it.**
The only two packs it rescues are `065bf902` and `535efddc` — the two whose
candidate score of 42 is produced by the `billing_address_match` defect (§5.1).
Lowering the shop's threshold by 8 points to re-admit them would be tuning a
setting to compensate for a collector bug, permanently and invisibly.

Keeping 50 is also not recommendable yet, because the 2 packs it would newly
block are blocked for a reason the report cannot stand behind.

Both options are unsound for the same reason, which is the definition of a
blocker. Additionally, all 10 of surasvenne's eligible packs reach the gate via
`legacy_no_strength` (§2.2), so even a clean re-run would rest on packs no
strength engine ever judged.

**Prerequisites for a surasvenne recommendation:**
1. Resolve the `billing_address_match` contract (§5.1).
2. Resolve or exclude the 3 packs with missing inputs (§5.2).
3. Re-run the harness — no harness change needed.

### Shop category

Neither shop needs a threshold change to absorb the candidate semantics. The
`−19.5` / `−13.5` mean shift is large, but it lands almost entirely on packs
that never reach the gate. **The working hypothesis for a fleet-wide default is
"thresholds do not move"** — but it is drawn from 19 eligible packs on 2 shops
and should not be generalized further without more shops.

---

## 8. Explicitly out of scope for this PR

Not touched, per the PR 2.0 boundary: production completeness behaviour, any
threshold or shop setting, PR 2.1, reader/writer migration, auto-save,
save-to-Shopify, deadline, UI, PDF, automation and package behaviour, schema
migrations, backfills, jobs and feature flags.

Deferred, with an owner needed:

1. **`billing_address_match` contract defect** (§5.1) — blocks P-7.
2. **3 packs with unreadable inputs** (§5.2) — blocks P-7 for surasvenne.
3. **67 stale persisted completeness scores** (§6.1) — pre-existing, live, and
   independent of this slice.
4. **`fraud_risk_screening` at 7/85 valid** (§5.1 census) — payload-dependent
   and therefore not flagged as a defect, but a 8% validity rate on a field the
   FRAUDULENT template lists is worth its own look.
