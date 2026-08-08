# Canonical evidence model — project status and way forward

**Date:** 2026-08-04 · **Author:** the agent that did the work
**Audience:** the maintainer, and a second agent asked to review this account.
Every substantive claim carries a pointer (file, PR, test, or analysis script)
so it can be verified against the repo and against prod rather than taken on
trust. Two claims made earlier in the project were wrong and are corrected in
§5 — a reviewer will find them in the PR bodies, so they are flagged here
first.

---

## 1. Summary

A merchant's dispute (#352552) carried decisive 3-D Secure evidence that was
cited to the issuing bank while being invisible on the merchant's own screen
and excluded from scoring. Investigation showed this was the third incident of
one structural class, caused by evidence having no single owner: an audit
found **310 independent definition sites** for the properties of an evidence
item. A plan to introduce one canonical evidence model was approved after two
rounds of maintainer correction.

What shipped to production: a **one-function fix** that closes the
visibility class entirely (divergence manifest 76 → 0), two adjacent bug
fixes, a 2,402-line deletion of a dead feature, and the model itself as
**inert infrastructure** — built, tested, measured against prod, and consumed
by nothing for any decision.

The honest gap: the plan conflated *"a model exists and is proven
equivalent"* with *"the model is in charge."* Its own completion metric (the
manifest reaching zero) was satisfied by the small fix, without the
migration. §7 is the post-mortem; §10 is the way forward.

---

## 2. The incident and root cause

blume-box **#352552** (`PRODUCT_UNACCEPTABLE`, Mastercard): the order has a
genuine 3-D Secure liability shift — ECI 02, DS transaction `b3b905f0-…`,
frictionless, 3DS 2.2.0, read from the Shopify Payments receipt. The bank
letter cited it (`defence_packages` v5). The merchant UI showed no 3DS row
anywhere, and case strength ignored it, so auto-pilot parked the case.

Prior incidents of the same class: `refund_record` on CREDIT_NOT_PROCESSED
(2026-07-07) and on FRAUDULENT (2026-08-01, blume-box 162042cd) — both
documented in `lib/automation/completeness.ts` near the FRAUDULENT template.

**Mechanism.** Citation and visibility read different sources:

- `lib/defence/factClassifier.ts` iterates `pack_json.sections[*].fieldsProvided`
  directly → anything collected is citable.
- The merchant tabs and `calculateCaseStrength` read `checklist_v2`, built
  from `REASON_TEMPLATES_V2[reason]` — and
  `reconcileChecklistWithCollectedFields` could only **flip** an existing row
  (`missing → available`), never append one.

So a collected field with no template row was citable, invisible, and
unscored. `CANONICAL_EVIDENCE` had 20 keys; the template union had 18;
`tds_authentication` was in no template at all.

**Audit** (three parallel repo surveys, results summarized in
`docs/technical.md` § *Canonical evidence model*): 310 independent definition
sites across 8 properties — 36 identity, 32 classification, 45 label, 40
availability, 45 strength, 50 citation-eligibility, 25 deduplication, 37
document/link. Notable: `calculateCaseStrength` had 4 call sites passing 4
different gate sets; `EvidenceFact.value.fieldKey` was the only join between
the fact layer and the line-item layer, and manual-upload facts lacked it, so
merchant file uploads were invisible to every line-item surface.

---

## 3. What shipped

All merged to `develop` first; prod promotion via PR **#510** (merged
2026-08-04 23:28 UTC, explicit maintainer approval).

| PR | Content | Behaviour change |
|---|---|---|
| #505 | Additive reconcile (**manifest 76 → 0**) + model P1–P3 as shadow infrastructure + i18n keys ×6 locales | Yes — visibility |
| #506 | Null-checklist blank-page fix (found by the maintainer on dev, #SEED-1001) + `creditAlreadyIssued` made a required guard input | Yes — renders; audit-reason consistency |
| #507 | P4 equivalence gate (result: **stop**) + removal of `ALWAYS_INCLUDE_IF_COLLECTED` | No |
| #508 | Deletion of the unwired Shopify file-slot layer, **−2,402 lines**, verified inert against repo + prod data first | No |
| #509 | Label-fallback fixes (`??` does not catch `""`; template literal interpolates `""`) | Latent-bug fix |

**The core fix** (`lib/packs/checklistReconcile.ts`): reconcile now appends an
`available`, `optional`-priority row for any collected canonical field the
reason template omitted. It is the one function both pipelines' inputs pass
through — at build (`buildPack.ts`) and on every read
(`app/api/disputes/[id]/workspace/route.ts`) — so every existing open pack
corrected itself on the next page load. No rebuild, no backfill.

**Prod data changes (not code):** `shop_settings.auto_save_min_score` lowered
with explicit approval — blume-box 80 → 60, surasvenne 65 → 50. See §5 for
why this is currently mis-paired with the running semantics.

**Measured effects of the reconcile** (read-only, two independent methods that
agreed — `scripts/evidence-model/reconcileImpact.analysis.ts` and the P2b
transition matrix):

| Shop | Packs | Completeness Δ | Strength flips |
|---|---|---|---|
| surasvenne | 6 | 0.0 | 0 |
| blume-box | 70 | +0.8 avg (0–12) | 2 |

- `#352501` — 58 → 70 completeness; weak → moderate
- `#352767` — weak → moderate
- `#346588` — persisted strength stale vs recompute (pre-existing finding)

Weak means *blocked*; moderate means *parked, then filed by the deadline
cron*. Both flips were listed in the prod PR before approval.

---

## 4. What was built but does NOT decide anything

`lib/evidence/model/` — vocabulary, domain boundary, definitions registry,
typed payloads, record derivation, assessment adapter, projections. ~40 unit
tests, characterization fixtures copied verbatim from prod. `buildPack`
persists `pack_json.evidence_model` on every build.

**Zero consumers read it for a decision.** The six intended consumers —
Overview tab, Evidence tab, Review & Forward tab, the PDF, scoring,
completeness — all still read their pre-existing sources (`checklist_v2` /
`facts_json`). If `lib/evidence/model/` were deleted tomorrow, production
behaviour would be identical.

What the work nevertheless paid for, fairly accounted:

- The audit that found the 310 sites and generated the divergence manifest
  (the fix's scope was measured, not guessed).
- Three measurement harnesses (`scripts/evidence-model/*.analysis.ts`,
  read-only against prod, outside CI by construction) that caught three of my
  own errors before they shipped: a false 56-of-76 "staleness" alarm produced
  by my comparison tool, a ~19-point completeness semantic difference, and a
  one-directional crossing count that reported a reassuring 0 on a change
  that flips 64 packs.
- The falsification-guarded regression test
  (`tests/unit/evidenceDivergenceManifest.test.ts`): fails if any collected
  field becomes invisible on any reason, AND re-runs detection against the
  pre-fix rule to prove the detector itself still works.

---

## 5. Current production state, including two corrections

**Correction 1 — PR #510's body claims the merge "closes an open exposure"
(thresholds lowered ahead of the code). That claim was wrong.** What #510
shipped is the additive reconcile, which slightly *raises* scores computed by
the **old** completeness engine. The "usable evidence" semantics the
thresholds were calibrated for (completeness counts only fields with a
*valid* record, ~19 points lower) live in
`lib/evidence/model/assessment.ts` and are consumed by nothing. So prod today
runs **old, higher completeness scores against thresholds calibrated for the
new, lower ones** — the completeness gate is more permissive than either
intended end state.

**Correction 2 — I earlier said four packs (73–77 completeness) "will
auto-file on their next pipeline evaluation" because they now clear 60. That
overstated it.** The pipeline evaluates strength guards *before* the
completeness gate (`lib/automation/pipeline.ts`): moderate parks and weak
blocks regardless of completeness, and the completeness gate is only reached
by Strong (or fully-credited) cases. None of the 76 open packs is currently
Strong, so the lowered thresholds affect **no open pack today**. The real
exposure: any *future* Strong pack scoring 60–79 under old semantics now
auto-saves immediately where it previously waited. Bounded, but real until
the semantics ship.

Also live and worth knowing:

- 15 of 76 open packs have a stale persisted `completeness_score` vs what the
  current code computes (template drift; packs never rebuilt). Pre-existing.
- `buildPack` writes `pack_json.evidence_model` (a few KB/pack) that nothing
  reads.
- The three newly-visible-field disputes behave as measured; post-deploy
  check is #352552's 3DS row on Overview/Evidence.

---

## 6. Plan-vs-delivered matrix

Plan of record: `~/.claude/plans/crystalline-sleeping-lerdorf.md` (approved
2026-08-04 after two correction rounds). Full item list, honestly marked:

### §3 Schema
- [x] 3.0 Domain boundary — 5 typed domains, compile-error on unregistered keys, no discard path
- [x] 3.1 Six vocabularies, one per concept; `invalid` moved off the strength axis
- [x] 3.2 `EvidenceDefinition` (cardinality, signalId, factCategory, labelToken, merchantSuppliable, citationPolicy, aggregation, relevance)
- [x] 3.3 `CaseEvidenceRecord` with source-derived stable ids
- [ ] 3.3 `provenance.supersedes` — declared, never populated
- [x] 3.4 Typed field-discriminated payloads + legacy-shape normalizers (every legacy arm justified by a prod count)
- [x] 3.5 `FieldEvidenceSummary` keeps `records[]` intact; five status concepts separate; `available` ≠ `waived`
- [x] 3.5+ `applicable` added as a sixth status concept (found via prod measurement)
- [x] 3.6 Layer 1 `CaseEvidenceModel`
- [x] 3.6 Layer 2 `CaseAssessment` (own policy version)
- [ ] 3.6 Layer 3 `CaseAutomationDecision` — not built
- [ ] 3.6 `PackageEvidenceUsage` — not built
- [~] 3.6 Single required `CaseGateAssessment` object — partial: `creditAlreadyIssued` made required on the existing input; the unified object was not introduced

### §4 Worked examples
- [x] 4.1 Two parcels → two records keyed on fulfillment GIDs; collapse declared once (`collapsesWith`)
- [ ] 4.1 Superseded carrier-vs-Shopify record retained — not implemented
- [ ] 4.1 Both parcels reach the bank via `PackageEvidenceUsage` — not implemented
- [x] 4.2 Gorgias thread → one record per conversation; uploads become records
- [ ] 4.2 **Per-message citation** — not implemented; records from one section share the section's citation state

### §5 Phases
- [x] P1 shadow derivation + manifest + characterization (CI green throughout)
- [x] P2a definitions, records, typed payloads, model persisted
- [~] P2b scoring — adapter + transition matrix built and clean (0 changes, strict policy); **scoring was never switched onto it**
- [~] P2c completeness — projection + threshold analysis built; semantics decided ("usable evidence") and thresholds set; **completeness was never switched** (§5 exposure)
- [~] P3 UI — projections built + contract-tested; **the three tabs do not read them**; 3DS visibility shipped via the reconcile instead
- [ ] P4 defence package — stopped by its own gate: 0 of 76 packs identical (`scripts/evidence-model/factEquivalence.analysis.ts`); see §7.1
- [~] P5 automation — required gate landed; `CaseGateAssessment` / `CaseAutomationDecision` not built
- [x] P6 deletion — after verified disuse (repo grep + prod row counts); −2,402 lines
- [ ] Re-derivation-on-read semantics — nothing derives on read, so the rule has nothing to govern yet

### §6 Manifest, authority, tests
- [x] 6a Divergence manifest, generated + checked in, 76 → 0, detector falsification guard
- [x] 6b Five authority rules encoded in the definitions registry
- [x] 6c Deletion required proven disuse
- [ ] 6d Six-consumer contract matrix — blocked: 0 of 6 consumers read the model
- [ ] 6d Seven E2E fixtures across the six consumers — not built (three exist as projection-level tests)
- [x] 6d Invariant-vs-intentional section in `docs/technical.md` — committed alongside this document

**Count: 20 done, 13 not done, 5 partial.**

---

## 7. Post-mortem: why the plan could not be fulfilled as written

Four planning failures and one execution failure. These are distinct.

**7.1 A schema gap only P4's gate exposed.** The model carries *merchant-side*
relevance (reason template → checklist). The bank path has a second, different
relevance: `reasonCodeModule.allowedFactCategories` — which facts belong in
*this argument*. The plan's own §1 data-flow map listed it; §3's schema never
carried it. So the model can say a record is true, valid and safe to cite, but
not whether it belongs in the letter. P4's equivalence gate therefore returned
0 of 76 identical — systematically, not as noise. The maintainer decided
(2026-08-04) the allow-list stays: rhetorical focus in a representment letter
is real, and the model has no notion of argument-relevance to replace it with.
**P4 as written is unfulfillable without a schema extension.**

**7.2 Sequencing by layer, not by consumer.** Phases ran
definitions → scoring → completeness → UI → PDF → automation. Each phase's
wording ("`CaseAssessment.strength` from records") reads equally as *build the
derivation* and *make the consumer use it*. I built derivations. No phase
said "delete the old call site," which is the only unambiguous definition of
done for a migration.

**7.3 The completion metric didn't require the migration.** The plan's
definition of done was the divergence manifest reaching zero. It did — via a
one-function fix that never touches the model. The manifest measures
*visibility*; the model exists for *single ownership*. The plan treated those
as the same goal. This is the deepest flaw: the project can truthfully report
"success metric achieved" and "the model decides nothing" simultaneously.

**7.4 Phases scheduled on undecided questions.** P4 depended on the
allow-list decision; P6 on the file-evidence-feature decision. Both were known
open questions, listed in the plan, and scheduled anyway.

**7.5 Execution failure (mine, distinct from the plan's).** At P2b and P2c I
treated *measured safe* as *phase complete* and moved on. The measurement is
the permission slip; the switch is the work. Scoring was proven zero-change on
all 76 live packs and I still never flipped the caller.

---

## 8. Decisions on record (maintainer, 2026-08-04)

1. **The reason-module allow-list stays.** P4 does not proceed as specced.
2. **Completeness measures usable evidence** (≥1 valid record), not mere
   collection. Thresholds lowered accordingly (60 / 50) — semantics not yet
   shipped (§5).
3. **The unwired file-slot feature is deleted**, not wired (PR #508).
4. Prod promotions are per-change; develop is free to ship.

---

## 9. Way forward — two honest options

### Option A — continue the migration, consumer by consumer (recommended)

Each step's definition of done is **the old call site is deleted**, with its
own before/after measurement. Order chosen by risk and by what is already
live:

1. **Completeness semantics** — switch the persisted `completeness_score` to
   the valid-record definition (`completenessChecklistFromModel` +
   `deriveCompletenessMetrics`). Closes the §5 exposure; the thresholds are
   already calibrated for it; threshold-crossing analysis exists and can be
   re-run the day it ships.
2. **Scoring** — switch `buildPack`/workspace scoring to
   `deriveCaseAssessment`; delete the direct `calculateCaseStrength` calls one
   by one (4 call sites, 4 gate sets today). Already proven zero-change under
   the default policy on all 76 open packs.
3. **The three tabs** — render from `selectForOverview` / `selectForEvidence`;
   display-only; projections are contract-tested. Delete the client-side
   re-computations (`useDisputeWorkspace`'s `calculateCaseStrength`, the
   client internal-signals copy).
4. **P4 redesign decision** — extend `EvidenceDefinition` with bank-side
   argument relevance (seeded from `allowedFactCategories`, keeping the
   allow-list per decision #1), then revisit `PackageEvidenceUsage` and
   per-message citation. This is design work needing its own approval, not a
   port.

After 1–3, the six-consumer contract matrix becomes buildable for real, and
the model owns three of six decisions instead of zero.

### Option B — freeze the model as an audit harness

Also defensible: the merchant-facing defect class is closed, the manifest
guard prevents regression, and the analysis harness keeps its value for
measuring future changes. If chosen: stop persisting `pack_json.evidence_model`
(write volume for a value nothing reads), mark `lib/evidence/model/` as
measurement-only in its header, and close the plan explicitly rather than
letting it trail.

**Recommendation: A**, for two reasons. First, step 1 is not optional
housekeeping — the thresholds already live on prod assume it. Second, the
310-site fragmentation that motivated the project is still fully in place;
the visibility fix removed the *worst symptom*, not the cause, and the next
incident of a different property (a label, a citation flag, a dedup rule
disagreeing between surfaces) has the same 310 doors to walk through.

If A is chosen, step 1 alone should ship first and be observed on prod before
step 2 begins.

---

## 10. Verification guide for the reviewing agent

- **The fix:** `lib/packs/checklistReconcile.ts` (append rule + null-checklist
  handling); regression tests in `lib/packs/__tests__/checklistReconcile.test.ts`.
- **The guard:** `npx vitest run tests/unit/evidenceDivergenceManifest.test.ts`
  — regenerate with `UPDATE_EVIDENCE_MANIFEST=1`; manifest at
  `docs/evidence-model/divergence-manifest.json` (openCount 0).
- **The model:** `lib/evidence/model/` — `domains`, `vocabulary`,
  `definitions`, `payloads`, `derive`, `assessment`, `projections`, ~40 tests
  under `__tests__/`.
- **Prod measurements** (read-only; need `.env.production.local`):
  `npm run analysis:evidence -- scripts/evidence-model/<name>.analysis.ts`
  for `strengthTransition`, `completenessThreshold`, `reconcileImpact`,
  `factEquivalence` (the P4 stop, with the finding recorded in-file).
- **Consumer status:** grep `deriveCaseAssessment|selectForOverview|selectForEvidence|selectForBank`
  outside `lib/evidence/model` — the only hit is `buildPack`'s persistence
  write, confirming zero decision consumers.
- **PR trail:** #505–#510; prod merge #510 (2026-08-04). The two corrected
  claims (§5) appear in the #510 body and in session commentary.
