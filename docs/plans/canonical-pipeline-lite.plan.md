# Canonical pipeline — parallel epic plan (amended, kickoff-ready)

**Status:** Kickoff-ready. Decisions taken 2026-08-09; agents may start.
**Created:** 2026-08-09 · **Amended:** 2026-08-09 (second pass — decisions folded in)
**Baseline:** `develop` @ `58e15806` (PR-C4 / C-14 merged; not in production)
**Owner:** coordinator (TBD)

---

## 0. Amendment history

**First pass** folded fifteen corrections into the submitted plan, each traceable to
something already on record in this repository. The five that changed its shape: decision
gates added; production remediation removed from the cutover; the single cutover split;
replay methodology pinned; R4 hash churn planned.

**Second pass (this one)** is the maintainer's narrow correction of that work. The technical
corrections stood; the delivery model did not. Five approval gates would have recreated the
one-defect / one-PR / re-review loop this plan exists to end. So:

| Change | Effect |
|---|---|
| **P-4, P-6, P-7 and the hash migration are decided here, in §1A, as kickoff inputs** | Four gates become four constants. No agent waits on an approval cycle for any of them |
| **One decision stays open: the `billing_match` package-mode question** | Answered on Epic B's replay output, inside PR 2's single review. Not a separate cycle |
| **CP-E sequencing corrected** | Packages required for wave-two activation are rebuilt **before** activation. Only historical / already-sent remediation stays deferred |
| **Delivery is three reviewed PRs** | Assessment/UI activation · argument+package+automation dark · small activation and legacy cutover |
| **CP-A, CP-B, CP-C still develop simultaneously** from the shared contract commit | Unchanged from the first pass |

---

## 1. Starting gate

The C-14 gate is satisfied and §1A is answered. Before implementation begins the coordinator
must:

1. fetch and pull the latest `develop` containing `58e15806`;
2. record that exact SHA as the kickoff baseline;
3. confirm the Supabase CLI target is dev (`vrpkgudqmpyunekrkpnc`) and that
   `scripts/guard-db-target.mjs` hard-refuses prod — **per command, not per session**;
4. create `epic/canonical-pipeline-lite` from the kickoff baseline;
5. commit the **contract commit**, containing the shared public shapes (§5), the shared
   fixture set (§5.1), the per-file ownership map (§5.2), and §1A copied in verbatim as the
   agents' constants;
6. create Agent A, B and C branches/worktrees from that same contract commit — not from the
   baseline and not from one another;
7. record baseline SHA, contract-commit SHA, branch names, worktree paths and the ownership
   map in the kickoff note.

P-7 calibration starts Day 0 from the recorded baseline, in parallel. It is read-only
analysis; it **applies** the §1A rule rather than seeking a new decision. Production
measurement uses an explicit read-only route; the normal CLI link never moves off dev.

---

## 1A. Kickoff decisions (maintainer, 2026-08-09)

These are constants. No epic re-opens one, and none of them is an occasion for review.

| # | Question | **Decision** | Consumed by |
|---|---|---|---|
| **P-4** | The dormant CE 3.0 bank-package route | **Retire the dormant CE 3.0 bank-package route. Retain CE 3.0 qualification as merchant insight.** | CP-B |
| **P-6** | May the deadline path file? | **`deadline_only` execution is allowed only with a current canonical decision AND a current validated safe package, with no hard block, no staleness, no ambiguity, and no unsupported argument.** All five conditions, conjunctively. A deadline never relaxes any of them | CP-C, PR 3 |
| **P-7** | Completeness thresholds | **Activate blume-box at threshold 60. Exclude surasvenne unless the new calibration produces a disposition-preserving result** — if it does, activate surasvenne at that value under this decision; if it does not, surasvenne stays on the current path and is out of scope for this delivery | CP-A, PR 1 |
| **Hash migration (R4)** | Grandfather or rebuild? | **Rebuild only current open, unsubmitted cases through an authorised writer, before wave two. Do not grandfather legacy packages.** Historical / already-sent remediation stays in CP-E | CP-D, CP-E |

### The one decision still open

| # | Question | Answered by | Answered when |
|---|---|---|---|
| **D-1** | `visa_10_4_fraud.criticalCategories` still names `billing_match`, a category with **0 members**. Remove the entry, or keep it? | The maintainer, on **Epic B's measured before/after replay** enumerating every narrow → full transition | **Inside PR 2's single review.** Not a separate cycle, not a separate PR |

It stays open because the change is bank-visible: every Visa 10.4 package is already `narrow`
because the category has no members, and removing the entry flips real packages **narrow →
full**. C-14 records that this *"needs its own approval"*, and PR-C4 deliberately scheduled no
work on it. Agent B produces the measurement; Agent B does not conclude. If the answer is
*keep*, the entry stays and the test pinning it stays.

### What P-7's decision rule means operationally

The last calibration recommended for blume-box only. C-14 clears one of surasvenne's three
prerequisites; it does not clear the 3 packs with unreadable inputs, nor the fact that **all
10** surasvenne eligible packs reach the gate via `legacy_no_strength`. Decisively, under the
live baseline the candidate semantics **reorder rather than rescale** — weakest auto-filing
pack 23, a blocked pack 24 — so no disposition-preserving threshold existed at any value, and
C-14 does not fix reordering. The re-run either produces one or it does not; either way the
answer is already authorised and CP-A does not stop to ask.

### What the hash decision means operationally

`EvidenceFact.id` is positional and `computeEvidenceHash` sorts on it, so a record-id
migration changes every hash once (R4). Combined with §3's rule that a hash mismatch is
non-fileable, that would mark the whole fleet stale at one instant.

The decision resolves it by scope: **current open, unsubmitted cases are rebuilt before wave
two, and nothing else is grandfathered.** Legacy packages simply go stale and become
non-fileable — which is correct, because they are historical or already filed and there is
nothing left to file. CP-0 measures and records the exact population predicate (start from
`disputes.final_outcome IS NULL` **and** no successful submission recorded) and its count
before CP-D executes it.

---

## 2. Product outcome

One canonical case pipeline:

```
CaseEvidenceModel → CaseAssessment → CaseArgumentPlan → DefencePackage
```

with a separate automation branch:

```
CaseEvidenceModel → CaseAssessment → CaseAutomationDecision
```

The package selector joins the branches only at execution time. Automation may consume the
selected package's operational identity; it may not consume argument content or review state.

---

## 3. Non-negotiable safety outcomes

The only architectural rules that may block an epic.

1. Unverified or `review_required` material never becomes an issuer-facing assertion.
2. A current package is fileable only when it has a safe argument, passes deterministic
   validation, and matches the current input hash and policy version.
3. A hard block, coverage/concession, staleness, validation failure, or absence of a safe
   argument always prevents filing. A deadline cannot override any of them (this is P-6,
   restated).
4. Read paths never persist, regenerate, enqueue, or alter submission state.
5. `CaseAutomationDecision` is independent of `CaseArgumentPlan`; package selection happens
   separately at execution time.
6. Every migrated consumer loses its old runtime fallback in the same PR that switches it.

### 3.1 Reversible vs irreversible

Each PR declares which class its changes are in, and the two irreversible operations in this
delivery are named up front rather than discovered:

| Class | Contents | Rollback |
|---|---|---|
| **Reversible** | consumer switch, legacy call-site deletion, projection reads, gate wiring | revert to the recorded SHA |
| **Irreversible** | the pre-activation rebuild (§9.3); any column drop | not covered by a revert — forward fix only |

The pre-activation rebuild is deliberately executed as an **operational step between PR 2 and
PR 3**, not inside either, so that neither reviewed PR mixes classes and the rebuild can be
verified before the switch is flipped. Column drops are excluded from the three delivery PRs
entirely (§9.5).

---

## 4. Simplified `review_required` policy

Phase 4R is not built. For this delivery:

- a `review_required` fact is visible to the merchant with its reason;
- it is excluded before issuer-facing generation begins;
- the argument and document are regenerated from the remaining approved facts;
- if the remaining facts support a safe rebuttal, the current validated package is
  `deadline_only` while any `review_required` item remains, and may be selected only by the
  deadline trigger **under P-6's five conjunctive conditions**;
- if no safe rebuttal remains, the result is `withheld_no_safe_argument`, nothing is filed,
  and the merchant is notified.

No merchant classification override, resolution overlay, full-package promotion, or separate
reviewed draft. A later correction to the evidence creates a new current plan/package through
the ordinary rebuild path. One plan hash is sufficient; the two-hash overlay is deferred with
the rest of Phase 4R.

### 4.1 What the merchant is told about `deadline_only`

`deadline_only` silently converts *"we would file this now"* into *"we will file this at the
deadline"* — the same shape as the hold semantics that already needed a merchant-copy
reframe. Agent A owns, and ships in the same PR as the state:

- the surface and exact copy for *"waiting for the deadline because N item(s) need your
  confirmation"*, naming the lever the merchant actually has;
- the distinction, in copy, between `deadline_only` (will file) and
  `withheld_no_safe_argument` (will not file);
- ×6 locale keys (`en`, `de`, `es`, `fr`, `pt`, `sv`). No English in `lib/`, no English in
  `pack_json`.

---

## 5. Parallel execution model

One coordinator, three implementation agents, each in an isolated worktree and branch, all
branched from the contract commit. **A, B and C develop simultaneously** — the PR sequence in
§12 is a delivery order, not a development order.

| Role | Owns | Must not change without coordinator handoff |
|---|---|---|
| Coordinator | shared contracts, shared fixtures, schema/migrations, policy-version constants, integration branch, the pre-activation rebuild, release verification, rollout and rollback | epic-owned implementation internals |
| **Agent A — Assessment & UI** | `CaseAssessment`, completeness/readiness, server projections, Overview/Evidence/Review & Forward consumers, stale-state presentation, §4.1 copy | argument/package derivation; automation executors |
| **Agent B — Argument & Package** | `CaseArgumentPlan`, inclusion/disclosure, issuer claim guards, package generation, deterministic validation, evidence usage, fileable-package selector | completeness thresholds; automation decision logic |
| **Agent C — Automation** | `CaseAutomationDecision`, replay fixtures, pipeline/reconcile/held-state/email/save-gate consumers, executor adapters | argument contents, package derivation, UI classification |

### 5.1 Fixtures belong to the contract commit

The coordinator authors and commits, Day 0, fixtures covering: strong · weak · complete ·
incomplete · hard-blocked · covered/conceded · stale · `review_required` with a safe argument
remaining · `review_required` with none. Agents extend privately; the shared set does not move
without a coordinator decision.

### 5.2 Per-file ownership

These files sit simultaneously in all three agents' scope:

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

**Agent C owns every call site above.** A and B ship pure, separately tested functions that C
calls. Any other split is named per file in the contract commit; silence defaults to C.

### 5.3 Contract revision protocol

Budget for two public-shape revisions. Coordinator amends the contract on the epic branch →
one-paragraph decision to all three agents → each rebases before continuing. No agent adopts a
shape change before that decision exists; no agent creates a competing version of a shared
type. **A contract revision is not a review event.**

### 5.4 Integration discipline

- Before any database command, re-run the environment guard and record the matched ref.
- Cross-epic tests use the shared fixtures, never another agent's unfinished internals.
- Each agent runs targeted tests continuously and `npm run release:verify` before handoff.
- The coordinator merges B → C into the epic branch for PR 2. Conflicts are resolved by the
  coordinator with the affected agent.

---

## 6. Epic A — Canonical assessment, completeness, and UI

**Owner:** Agent A · **Delivers:** PR 1 · **Decision inputs:** P-7 (§1A) · **No open gate.**

### 6.1 Scope

1. Day 0 — re-run the read-only completeness calibration on the post-C-14 baseline and
   **apply P-7's rule**: blume-box at 60; surasvenne included only if a disposition-preserving
   threshold exists, otherwise excluded.
2. Reconcile against the reproducible anchors (§6.2).
3. Implement completeness independently of strength inside `CaseAssessment`.
4. Persist/read a versioned assessment snapshot through authorised write paths only.
5. Switch Overview, Evidence and Review & Forward to server projections.
6. Delete browser-side scoring/readiness reconstruction, duplicate label/category registries,
   stale v1 completeness readers on those surfaces.
7. Stale or absent assessment renders as `needs_recalculation` — never a stale number shown as
   current.
8. Ship §4.1's `deadline_only` copy in ×6 locales.

### 6.2 Reconcile against these anchors, and only these

`coveragePercent` = 96 is marked in `docs/technical.md` as **"pre-implementation run only"** —
not reproducible on post-C-14 code. Report it as *"not reproducible post-implementation, by
design"*. That is the correct answer, not a gap.

| Anchor | Value |
|---|---|
| Affected packs | **131** = 97 persisted `available`/critical + 19 appended `optional`/`available` at read time + 15 persisted `missing`/critical |
| Effectively available pre-C-14 | **116** |
| Completeness delta | **90 packs −1…−7 · 15 packs +2…+17 · 26 unchanged** |
| Submission readiness | **13 packs `ready_with_warnings` → `ready`**, none the other way |
| Case-strength changes | **0** (moderate→moderate 98, weak→weak 27, strong→strong 6) |
| Citation / LLM-value delta | **0** — the field was never bank-eligible |

### 6.3 Acceptance

- Calibration re-run delivered, P-7's rule applied and the resulting shop set stated.
- Strength and completeness remain separate concepts.
- The same case produces the same assessment on every server and UI surface.
- No UI consumer reclassifies a fact or reconstructs readiness.
- Any result-bearing assessment input change changes the input hash.
- Approved scoring behaviour unchanged except for the approved completeness contract.
- **CI invariant:** zero client-side strength/readiness recomputation; zero direct
  `calculateCaseStrength` call sites outside the assessment derivation; zero v1 completeness
  readers on the three tabs — falsification-guarded, in the style of
  `tests/unit/evidenceDivergenceManifest.test.ts`.
- `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run release:verify` green.

---

## 7. Epic B — Canonical argument and issuer-safe package

**Owner:** Agent B · **Delivers into:** PR 2 (dark) · **Decision inputs:** P-4, P-6 (§1A) ·
**Open item:** D-1, answered inside PR 2's review.

### 7.1 Scope

1. `CaseArgumentPlan` owns argument disposition, inclusion, disclosure and issuer-facing claim
   authority — alone.
2. Package fact selection, thesis construction, Evidence Basis, Case Details, chronology and
   section composition become projections of the plan.
3. `review_required`, unverified, adverse and merchant-only facts are excluded before
   generation; the language model never receives them as issuer-facing support.
4. The package is rebuilt from the remaining approved facts, so no sentence survives after its
   support is removed.
5. Deterministic claim/document validation after composition; failure ⇒ non-fileable.
6. Persist package evidence usage, plan input hash, policy version, validation result and
   generated artifact identity.
7. One selector: `selectFileablePackage(caseId, trigger: "normal" | "deadline") →
   FileableSelection` — one current validated package, a typed non-fileable reason, or a
   blocking ambiguity error. Never an arbitrary pick.
8. `withheld_no_safe_argument` when no approved primary or rebuttal argument remains.
9. `deadline_only` whenever the plan still contains an excluded `review_required` item, subject
   to P-6's five conditions at execution.
10. **Retire the dormant CE 3.0 bank-package route** per P-4; retain CE 3.0 qualification as
    merchant insight. Confirm in the PR that this does not reopen the 2026-08-04 decision that
    `reasonCodeModule.allowedFactCategories` stays.

### 7.2 The existing production gate is an input, not a competitor

`packageSafety` (C-11, PR #517 → prod #519) is already consulted at the save job, the manual
save route, the deadline cron's candidate selection, and the workspace readiness projection.
`selectFileablePackage` **subsumes** it. Prod-measured behaviour to preserve: **212 of 280
package versions blocked, exactly matching the pre-release census** (212 versions across 91
disputes). A different count on the same population is wrong until explained.

### 7.3 D-1 — measure here, decided in PR 2's review

Agent B's deliverable is a before/after replay across every affected package, enumerating each
narrow → full mode transition. The removal decision is the maintainer's, taken on that output
during PR 2's single review.

### 7.4 Hash churn — measure, don't design

CP-B introduces the plan input hash and must report the churn size against the current open,
unsubmitted population. The remedy is already decided (§1A) and executed by the coordinator
between PR 2 and PR 3.

### 7.5 Acceptance

- One bank-inclusion predicate governs all issuer-facing surfaces.
- A fixture with approved + `review_required` facts produces a package with only approved
  support and no orphaned claim.
- A package with no safe argument is never generated as fileable.
- Stale, invalid, missing-artifact, superseded and ambiguous states cannot be selected.
- `normal` and `deadline` triggers obey P-6 without weakening any hard block.
- No independent evidence classification outside `CaseArgumentPlan`.
- The C-11 block count (212/280) is reproduced on the same population.
- Visa 10.4 replay delivered with every mode transition enumerated.
- **CI invariant:** exactly one bank-inclusion predicate; exactly one AVS/CVV match-code set
  (there were four, kept "in lockstep by comment" before C-12/C-13).

### 7.6 Explicitly absent

No resolution table, append-only history, expected-head concurrency, merchant override API,
two-hash overlay, full/draft promotion system, separate safe/full package lifecycle.

---

## 8. Epic C — Canonical automation decision

**Owner:** Agent C · **Delivers into:** PR 2 (dark) · **Decision inputs:** P-6 (§1A) ·
**No open gate.**

### 8.1 Scope

1. A time-invariant `CaseAutomationDecision` derived only from the current `CaseAssessment`,
   rules/settings, automation mode and the dispute's **absolute** evidence due date.
2. Persist its input hash, automation-policy version, reason codes and computation time
   through authorised writers.
3. Switch pipeline, defence-build decision, reconcile, held state, alert/email and save gates
   to the same decision object.
4. Remove each switched consumer's independent gate/scoring/readiness ladder and legacy
   fallback — including the `autoSaveGate` `undefined`-readiness fallback (R1), which silently
   drops the gate onto the legacy blocker-count path.
5. Package choice stays out of the persisted decision.
6. `normal` and `deadline` adapters against the selector contract; **the deadline adapter
   implements P-6's five conjunctive conditions and nothing looser.**
7. Automation may not import argument-plan or review internals.

### 8.2 Time-invariance, stated so it isn't self-contradictory

> The decision may carry the **absolute** evidence due date. It may never carry, or be derived
> from, a **relative** time state — time remaining, window open/closed, days to deadline.
> Executors compute window state from the absolute due date at execution.

Required test: evaluate identical inputs at two clock times, assert identical input hash **and**
identical reason codes. A due-date change is an input change and must change the hash.

### 8.3 Acceptance

- All entry points return identical action and reason codes for the same inputs.
- Hard blocks, coverage/concession, stale assessment and missing decision always prevent
  filing.
- Passage of time alone does not stale the stored decision.
- No executor can obtain a package through a direct fileable-row query after cutover.
- Deadline execution satisfies all five P-6 conditions or files nothing.
- **CI invariant:** enumerated legacy gate ladders have zero readers; no `undefined`-readiness
  fallback remains; no cron route bypasses `cronEnvGate`.
- Coverage Gate and Fatal-loss Gate behaviour unchanged — coverage still beats fatal-loss,
  `COVERED_STATUSES` still exactly `{PROTECTED, ACTIVE}`, no bank-facing text cites a
  fatal-loss reason.

---

## 9. Epic D — Integration, pre-activation rebuild, cutover

**Owner:** coordinator, with targeted fixes by A–C.

### 9.1 PR 1 — assessment/UI activation

Epic A, implemented **and activated**, for the shop set P-7's rule produces. Contains the
replay for its own scope (§9.4), the three tabs switched to server projections, and the
client-side recomputations deleted in the same PR. Reversible class only.

### 9.2 PR 2 — argument, package, automation, dark

Coordinator merges B → C into `epic/canonical-pipeline-lite`, connects the `normal` and
`deadline` executors to the real selector, and runs the full production-shaped pipeline tests
plus the whole-pipeline replay — **re-run against the post-PR-1 production state**, not the
kickoff baseline. Production switches disabled throughout. D-1 is answered in this PR's
review. Reversible class only.

### 9.3 Between PR 2 and PR 3 — the pre-activation rebuild (operational step)

Per §1A's hash decision: rebuild **current open, unsubmitted cases** through an explicit
authorised writer — never from a GET/read path — so they carry current hashes before anything
can be marked stale. Legacy packages are not grandfathered and are expected to go stale.

Required property, verified by PR 2's replay before the rebuild runs: **the rebuild must not
change what the still-live legacy path reads or files.** It writes the canonical fields;
legacy-read fields are unchanged. If the replay cannot show that, the rebuild waits and the
sequence is re-planned — it does not proceed on assumption.

Run on dev first, then prod, guard per command, count reconciled against CP-0's recorded
population before and after.

### 9.4 Replay methodology — pinned

**Population.** `disputes.final_outcome IS NULL`. **Never** `evidence_packs.status`: a pack
that passes the gate is immediately moved to `saved_to_shopify` (`pipeline.ts:813-821`), so
`status='ready'` is precisely the complement of "packs that cleared the gate" — run that way
the harness reported **zero eligible packs on both shops** and concluded the threshold decides
nothing. 73 → 115 packs, eligible 0 → 19.

**Two baselines.** *Operational* (persisted-live: the gate over `completeness_score`,
`submission_readiness`, `blockers` exactly as `pipeline.ts` reads them) for crossing counts,
trade-offs and go/no-go. *Semantic* (current engine re-run now) for attribution only. Three
faithful details, each of which changes an answer: `?? 0`, `?? undefined` for readiness (drops
the gate onto the legacy blocker-count path), `?? []`.

**Pre-declared drift categories**, counted before the replay runs:

1. `persisted_score_not_reproducible_by_current_engine` — was **67 of 115**
2. `persisted_strength_stale_vs_recompute` — was **15 of 76**
3. `legacy_no_strength` — was **all 10** of surasvenne's eligible packs
4. `hash_churn_r4` — anything whose only change is the one-time rotation

A transition inside a declared category is classified. Anything outside all four blocks until
explained.

### 9.5 PR 3 — activation and legacy cutover

Small by construction: flip the canonical argument/package/automation switches and delete the
corresponding legacy paths in the same PR. Nothing else.

**Not in PR 3:** column drops and any other destructive schema change. Those run later as
mechanical migrations gated on zero-reader proof, with their own rollback note; they are
cleanup, not delivery, and they do not carry a review cycle.

### 9.6 Production release gate

Each PR promotes `develop → master` with **in-chat approval for that specific change** (one
prior yes is never standing permission). No auto-merge on a `master` PR; no `--admin` past a
red check. Attached to each promotion: the replay classification table, the rollback SHA and
change class, and the named post-deploy checks.

### 9.7 End-to-end acceptance matrix

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
| Legacy (not rebuilt) package on an open case | Stale ⇒ non-fileable. Expected, per §1A |
| Unsafe verified-address delivery claim (C-11 population) | Blocked at every save/forward/auto-file/deadline boundary, reproducing 212 of 280 |

---

## 10. Epic E — Historical remediation (deferred)

Corrected in this pass. The rebuild that **wave two requires** is not deferred — it is §9.3,
scheduled before activation. What stays in CP-E is remediation of **historical and already-sent
cases**: regeneration, backfill or `pack_json` rewrite of disputes that are closed, submitted,
or otherwise not needed for activation.

That scope keeps its standing constraint: *"no regeneration, no backfill, no `pack_json`
rewrite, no submission-state change. Remediation is its own decision and its own PR."* C-11
shipped its gate to production on 2026-08-08 and deliberately left **212 package versions
across 91 disputes** un-regenerated; that population is still standing and is not touched by
this delivery.

---

## 11. Mechanical invariants required at each cutover

The most valuable artifact of the previous effort was the falsification-guarded divergence
manifest test — it fails if the defect returns **and** re-runs detection against the pre-fix
rule to prove the detector still works. Each consumer cutover ships an equivalent:

| Consumer | Invariant |
|---|---|
| Overview / Evidence / Review & Forward | zero client-side strength or readiness recomputation |
| Scoring | zero direct `calculateCaseStrength` call sites outside the assessment derivation (there were 4, with 4 different gate sets) |
| Completeness | zero readers of the v1 completeness path |
| Package / issuer surfaces | exactly one bank-inclusion predicate; exactly one AVS/CVV match-code set (there were 4) |
| Automation | zero independent gate ladders; no `undefined`-readiness fallback (R1) |
| Executors | zero direct fileable-row queries |

A review claim is not a substitute for one of these.

---

## 12. Delivery — three reviewed PRs

| PR | Contents | Class | Review |
|---|---|---|---|
| **PR 1** | Epic A implemented **and activated** — assessment, completeness (P-7 shop set), UI projections, client recomputations deleted | reversible | agent self-review → coordinator integration review → **one** maintainer review |
| **PR 2** | Epics B + C integrated, **dark**: argument plan, package projections, selector, automation decision, executors wired but switched off. Carries the whole-pipeline replay and the D-1 measurement | reversible | same, one maintainer review; **D-1 is answered here** |
| **PR 3** | Activation and legacy cutover — flip the switches, delete the legacy paths. Small by construction | reversible | same, one maintainer review |

Between PR 2 and PR 3: the pre-activation rebuild (§9.3), an operational step, not a PR.
After PR 3: destructive schema cleanup on zero-reader proof — mechanical, no review cycle.

Each PR lands on `develop` (auto-merge fine) and is promoted to `master` with per-change
in-chat approval. Agent branches get CI and self-review; they are not separately reviewed.

**No issue becomes a fourth PR merely because it is conceptually separable.** Split only if a
migration or production rollback boundary genuinely requires it.

---

## 13. Review rule

Per PR: implementing agents self-review and run required checks → coordinator integration
review → **one** maintainer review against this plan's acceptance criteria → all valid findings
returned in **one** consolidated correction request → targeted rechecks plus full required CI.
Do not restart a whole-PR audit unless the correction changes another epic's contract or a §3
safety outcome.

A finding blocks merge only when it can create a false issuer-facing claim; can file a blocked,
stale, invalid, unsupported or ambiguous package; breaks tenant isolation or data integrity;
causes a concrete regression in approved behaviour; or fails a required check. Hypothetical
bypasses, comment perfection, optional abstractions and future merchant-review features go to
the backlog.

---

## 14. Deferred backlog

Append-only merchant resolution history; optimistic-concurrency review heads; merchant
policy/classification overrides; base/resolved two-hash overlays; separate draft/full/safe
promotion lifecycle; advanced review queue and resolution notifications; submit-enqueue dedupe
redesign; lost-response audit remediation; `finalizeRefused` cron alerting redesign;
transaction-authorized final → submitted/superseded transitions; **historical / already-sent
remediation (CP-E)**.

---

## 15. Target schedule

| Work | Target |
|---|---|
| Day 0: baseline, contract commit (shapes + fixtures + ownership + §1A), worktrees | 0.5–1 day |
| P-7 calibration re-run, applying §1A's rule | 1–2 days, parallel |
| CP-A, CP-B, CP-C **simultaneously** | 4–7 working days |
| PR 1 review, promotion, prod observation | 1 day + observation window |
| PR 2 integration, whole-pipeline replay, D-1 measurement, review | 2–3 working days |
| Pre-activation rebuild (ops step, dev then prod) | 0.5 day |
| PR 3 activation and legacy cutover | 1 working day |
| **Total** | **≈ 9–12 working days**, plus the PR 1 observation window |

Zero decision latency is now a property of the plan rather than an assumption: the four
constants are decided, and the single open item resolves inside a review that was already
scheduled. This is a delivery target, not permission to suppress a concrete safety blocker,
and not an invitation to add speculative completeness work.

---

## 16. Authoritative completion definition

The plan is complete when:

- every active consumer uses the canonical layer assigned to it;
- no active legacy fallback can alter strength, completeness, argument inclusion, package
  selection, or automation action — **proven by the §11 CI invariants, not asserted**;
- the §9.7 end-to-end acceptance matrix is green;
- the replay has zero transitions outside the four declared categories (§9.4);
- the pre-activation rebuild's before/after counts reconcile against CP-0's recorded
  population;
- production post-deploy checks show no stale, ambiguous or invalid package was filed.
