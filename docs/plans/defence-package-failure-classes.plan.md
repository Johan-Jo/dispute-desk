# Defence package failures: close the classes, not the instances

**Status:** Phase 0a built 2026-10-09 (see §10). Decisions recorded (§8). The Phase −1 canary ran. Phases 0b onward are pending approval (ralplan revision 4, see §9).
**Trigger:** admin email "Defence package failed: whj8db-1q.myshopify.com #4898" (`no_counsel_letter`), and the maintainer's report that failures arrive every day and are being fixed one at a time.
**Code references:** `origin/master` at `b974a0d6`. **Prod:** `aokhplydttxtebvbeuzc`.

## 1. What prod shows

### 1.1 Every non-letter outcome

| status | code | rows | disputes | last 14 d | last 3 d | last seen |
|---|---|---|---|---|---|---|
| failed | daily_cap_reached | 72 | 51 | 9 | 0 | 09-30 |
| failed | validation_failed | 70 | 56 | 3 | 0 | 09-28 |
| failed | llm_error | 28 | 24 | 3 | 0 | 10-03 |
| failed | no_counsel_letter | 25 | 24 | 25 | 13 | 10-09 |
| failed | pdf_render_failed | 9 | 3 | 1 | 0 | 09-28 |
| skipped | no_bank_eligible_facts | 118 | 53 | 42 | 16 | 10-09 |

Failed packages on 11 of the last 17 days. The largest and fastest-growing bucket is `skipped`, which sends no email.

### 1.2 The 16 open, fileable disputes with no usable package (none has an earlier usable version)

| shop | reason | phase | due | latest | note |
|---|---|---|---|---|---|
| whj8db-1q | CREDIT_NOT_PROCESSED | inquiry | 10-10 | skipped | pack score 68 |
| 6a8848-dd | PRODUCT_UNACCEPTABLE | chargeback | 10-11 | failed llm_error, v7 | self-heal retried 3×, streak exhausted |
| 6a8848-dd | INCORRECT_ACCOUNT_DETAILS | chargeback | 10-14 | failed validation_failed | routed to module `product_unacceptable`; score 97 |
| 6a8848-dd | PRODUCT_NOT_RECEIVED | inquiry | 10-14 | skipped | score 85 |
| 6a8848-dd | PRODUCT_NOT_RECEIVED | chargeback | 10-15, 10-16, 10-16, 10-19 | skipped | scores 42, 85, 85, 77 |
| 6a8848-dd | SUBSCRIPTION_CANCELLED | chargeback | 10-19 | skipped, v4 | score 97 |
| whj8db-1q | CREDIT_NOT_PROCESSED | inquiry | 10-19 | failed no_counsel_letter | |
| whj8db-1q | CREDIT_NOT_PROCESSED | inquiry | 10-19, 10-22, 10-25, 10-25, 10-26 | skipped | score 68 each |
| 6a8848-dd | PRODUCT_NOT_RECEIVED | inquiry | 10-28 | skipped | score 55 |

3 failed, 13 skipped. At the deadline the cron files nothing for these and sends an admin "no file" alert on the due date (`app/api/cron/defence-package-deadline-submit/route.ts:213-241`); Shopify then files its own scrape.

**What this plan does not do:** the 13 skips happen at gates that run before the writer is chosen (`lib/jobs/handlers/buildDefencePackageJob.ts:409, 509, 516, 544, 573`). No phase below changes those gates. The plan makes each skip say truthfully why (Phase 0a) and Phase −1 reads the 13 by hand; a letter for any of them needs either a merchant upload or a separately scoped gate change that Phase −1 may recommend.

### 1.3 What `no_counsel_letter` is

One stored sentence covers four situations:

| situation | where | seen in prod |
|---|---|---|
| writer wrote; checks or reviewer rejected after two correction rounds | `lib/defence/counsel/run.ts:588` | all 25 rows (each has a recorded model run) |
| a bank claim was captured, so counsel is not called | `buildDefencePackageJob.ts:602` | none yet |
| kill switch `DEFENCE_COUNSEL_V2=off` | `run.ts:406` | none |
| no ledger | `run.ts:438` | cannot happen: `general()` always returns one (`run.ts:66-98`) |

The rejecting issues go to `console.warn` only; logs are kept one day. For 13 of the 25 the reason is gone, and `markFailed` stores neither facts nor ledger, so they cannot be reconstructed.

The 12 still in the log (today, `whj8db-1q`, Klarna, CREDIT_NOT_PROCESSED → general brief): 8 had a date repeated in summary and conclusion, 7 a computed interval ("forty-six") not in the ledger, 2 reviewer fact-check findings (one real). In all 12 the ledger was three rows: order placed, dispute opened, claim stated. 11 of the 12 disputes are `under_review` with no due date and could not have been filed.

### 1.4 Repeat builds

Since 09-28, 70 drafts were marked stale by a pack rebuild (4 by a guidance refresh). 13 of the letters written afterwards had a **counsel input hash identical to the draft they replaced**; in 6 of those 13 the evidence hash differed while the writer's input did not. So the "has anything changed" key used at enqueue (`evidence_hash`) is not the writer's input. Separately, 35 new versions followed a failed or skipped row (9 after a skip, 9 after `no_counsel_letter`, 8 after `daily_cap_reached`).

## 2. Root-cause classes

| # | class | evidence | effect |
|---|---|---|---|
| RC1 | **Blind outcomes.** Why a letter was rejected, and why a build was skipped, is not stored. | 25/25 `no_counsel_letter` carry one generic sentence. Four unrelated job skip sites and one enqueue skip site (`lib/defence/enqueue.ts:359-385`) share one fixed reason. `pdf_render_failed` (`:1349-1373`) never calls the notifier. | Nothing can be counted by cause. Each failure costs a same-day log read. |
| RC2 | **Brief coverage.** Counsel v2 became the only writer on 09-28 with briefs for two families (`lib/defence/counsel/briefs/index.ts:198-202`). Every other family gets `GENERAL_BRIEF`, whose ledger is in practice `claim_stated` plus the delivery sequence (`run.ts:66-80`; its one section needs `carrier_delivered`, `briefs/index.ts:177-191`). A refund record, a cancellation, authentication or a customer message has no claim to land in. Without a delivery it falls to the deliberate floor theory `sale_on_record`, which has three rows to write from. | 12 of 12 readable failures: the writer padded the floor letter and the copy rules rejected the padding. The job's comment: "until its family has a counsel playbook" (`buildDefencePackageJob.ts:683-686`). | A family fails as a "letter-writing failure". |
| RC3 | **Builds are not gated on being fileable or ordered by deadline.** `enqueue.ts:341-345` inserts with default priority; nothing reads status or `due_at`. `STATUS_CHANGED` and `DUE_DATE_CHANGED` effects do nothing (`lib/disputes/disputeEffectsDispatcher.ts:150-155`). | 11 of 12 today were unfileable. `whj8db-1q` ran 26 packages on install day against a cap of 25 while 9 of its disputes need a response. | Spend, cap exhaustion (`daily_cap_reached`) and email for disputes that cannot be filed, ahead of ones that can. |
| RC4 | **Alerting is per package and only for `failed`.** | 13 emails today for one cause; 13 fileable skipped disputes are silent until the due date; a rebuilt failure emails again. | The inbox is the triage system. |
| RC5 | **Model reply parsed as free text.** | 5 of the last 7 `llm_error`. Three in a row stops self-heal (`lib/defence/failedPackageSelfHeal.ts`, `MAX_TRANSIENT_STREAK = 3`); that is the dispute due 10-11. | Sporadic failures unrelated to the case, occasionally stranding a fileable dispute. |
| RC6 | **Prod is the test suite.** `scripts/counsel/eval-counsel.mts:43-45,119-151` runs the old summary-only writer on item-not-received only. | Every `no_counsel_letter` was found by email. | A new shop shape meets the checks for the first time in prod. |

Considered and **not** made a class: repeat builds on unchanged input (§1.4). They are real but cost about $0.21 in eleven days, and every fix reviewed (at enqueue on `evidence_hash`, or in the job on the writer's hash) adds a way for a fileable dispute to keep a stale or failed result. Left as a conditional item (Phase 6).

Not established and not claimed: that letters with a real argument are being lost to copy rules alone. All 12 readable cases are floor letters (RC2).

### 2.1 Each code against what exists and what this plan does

| code | existing recovery | this plan |
|---|---|---|
| no_counsel_letter | none | typed and replayable (0a); alerted by class (0b); not built when unfileable (1); floor letter made writable (2, pending decision 1); briefs (3) |
| skipped / no_bank_eligible_facts | none; deadline cron alerts on the due date | **typed and alerted only** (0a, 0b). Not fixed by any phase; see §1.2 |
| daily_cap_reached | self-heal daily, nearest deadline first, 3-streak bound | no unfileable builds, deadline order (1); cap question (§8.3) |
| llm_error | self-heal, 3-streak bound | canary for the stranded one (−1); structured output if the count warrants (5) |
| validation_failed | none by design | signature only (0a); the fileable case is read in −1 |
| pdf_render_failed | none; no notification | notified (0a) |

## 3. RALPLAN-DR

**Principles**
1. Nothing untrue or unsupported reaches a bank.
2. Every outcome that is not a letter has a stored, typed, countable, true reason.
3. Spend, cap and alerts go first to disputes that can still be filed.
4. A counsel run is replayable from what was stored.
5. Measure before building: no mechanism without a counted case for it.

**Decision drivers**
1. Fileable disputes must not reach their deadline with nothing, for a reason we could have known.
2. One look per cause, not per package.
3. No loss of truthfulness; the copy rules (each fact once, no arithmetic) stay.

**Options**

| | A. Patch per incident | B. Observability only | C. Typed outcomes + fileable-first + coverage backlog (chosen) | D. Fallback writer | E. Briefs first |
|---|---|---|---|---|---|
| For | no design work | smallest; no risk to letters | removes what makes failures repeat (RC1, RC4, RC6), bounds waste (RC3), turns coverage into a counted backlog | always a letter | attacks the largest cause |
| Against | the last 17 days | fileable disputes and the daily email storm wait | several small phases | retired 09-28, "never re-add a fallback" | each brief is a design job; without 0a families cannot be ranked or a brief verified |
| | rejected | kept as 0a | chosen | rejected | kept as Phase 3 |

## 4. The plan

Each phase is one PR to `develop`, then a `master` PR that waits for the in-chat go. Migrations are applied by the agent, dev then prod, with the explicit-target scripts. A phase does not wait for the previous phase's 7-day SQL check unless it says so. A PR that changes prompt text, a brief, a check rule or a ledger builder bumps `COUNSEL_PROMPT_VERSION`; 0a and 0b change none of them and do not bump.

### Phase −1 — today: read the 16 (one read-only script, no deploy)

1. `scripts/defence/explain-build-exit.mts` loads a pack and calls the same exported library functions the build calls (the enqueue-time classifier exit at `enqueue.ts:146`, then classifier, plan derivation, fatal-loss, claim scoping, `ledgerForBrief`), in order, and prints which exit fires and why. It writes nothing. In 0a it is kept and switched to call the extracted function (0a.8), so there is one decision sequence.
2. Run it for the 16 (all 13 skips were written by the job, none at enqueue). Sort each into: (a) our gap — approved facts exist and a gate or the ledger drops them; (b) a true evidence gap — name the merchant control that exists in the UI for it; (c) structurally unwinnable.
3. Run it for today's 12 failures and save the reconstructed writer inputs (labelled reconstructed, not original).
4. Canary, one dispute: the chargeback due 10-11 (`llm_error`, streak exhausted), rebuilt through the existing Regenerate path. Before the rebuild, read the shop's automation rule and say in chat whether a successful build files immediately; get the maintainer's go for this one dispute; no second rebuild until the maintainer has read the letter. The `validation_failed` case due 10-14 is not rebuilt under unchanged rules; it is read in step 2.
5. Report the table with an action per row: (a) a scoped follow-up naming the gate; (b) the ask to the merchant; (c) none. Decision 1 (§8) is needed for the `no_counsel_letter` inquiry due 10-19.

### Phase 0a — store everything; no change to letters

1. **Typed result.** `runCounsel` returns `{ ok: true, … } | { ok: false, kind: "checks_failed" | "counsel_disabled", issues, lastDraft }`. The job adds `bank_claim_present` for `:602`. New failure codes `counsel_bank_claim_unsupported` and `counsel_disabled` beside `no_counsel_letter` (no check constraint on `failure_code`; added to `DefencePackageFailureCode`; neither is in self-heal's transient list).
2. **Issues stored.** Every issue producer gets a stable rule id: each `issues.push` in `checks.ts` (including each of the 20 `LINT` rules at `:117-138`, the hard length at `:217-224`, the absence rules at `:251, 254`, the whole-order rule at `:270-273`, and `english:` issues emitted with a section prefix at `:243`) and the reviewer's `fact-check:` / `unclear:` (`generate.ts:258-259`). A test enumerates producers and fails on one without an id. Stored in `validation_errors` as `{rule, section, message}`, the shape `CompleteDefencePackageCard.tsx:71` reads; `message` is the rule's description, not the rejected sentence. The strings sent to the correction prompt are unchanged.
3. **Skips typed.** New column `outcome_detail` at every skip site: the job's `:409` (classifier reason), `:509` `fatal_loss`, `:516` `no_safe_argument`, `:544` `record_context_only`, `:573` `claim_scoped_empty`, and `insertSkippedRow` at `enqueue.ts:359` (`covered_shopify` or `enqueue_classifier`). Each writes a true `failure_reason` and the small gate inputs (approved-fact count by category, what scoping removed). `failure_code` values are unchanged, so `resolveBuildAttempt.ts:93`, `serverFacts.ts:113` and the card are untouched.
4. **Coverage measure.** For every counsel run, `outcome_detail` records the start brief, the chosen brief, the picked theory, and the approved-fact categories no ledger claim represents. This ranks Phase 3.
5. **Signature.** New column `failure_signature` on failed and skipped rows: `code · module · brief · payment family · sorted rule ids` (checks); `code · module · outcome_detail` (skips); `code · module · first validator rule` (`validation_failed`); `code · error class` (`llm_error`: `json_parse`, `api_4xx`, `api_5xx`, `timeout`, `other`); `code` otherwise.
6. **Replay input.** New column `counsel_replay_json` on every counsel run, letter or not: ledger, brief, frame, page context, check context, customer-order summary, not-as-described prep outputs, the input hash, the last draft. `app/api/defence-packages/[id]/route.ts:27-36` (`select("*")`, the only one on this table) gets an explicit column list; payload tests on it and on the workspace route. Retention ships in 0b; until then nothing is deleted.
7. `pdf_render_failed` goes through `notifyDefencePackageFailed` (one new email path).
8. The gate sequence (`enqueue.ts:146` and job `:409-573`) is extracted into one exported function used by the build and by the Phase −1 script.
9. **Replay script.** `scripts/counsel/replay.mts` takes a package id or a reconstructed-input file and runs `ledgerForBrief` + `writeLetter` with the stored frame against the working tree, through the staging pilot endpoint the old eval script uses; prints letter or typed non-letter, issues, tokens and cost; files nothing. It replaces `eval-counsel.mts`.
10. `scripts/sql/defence-failure-classes.sql`; `docs/technical.md`.

One migration: `outcome_detail`, `failure_signature`, `counsel_replay_json` (the immutability trigger is a deny-list; the new columns are writable).

Acceptance:
- a characterisation test with stubbed model replies (one clean letter, one corrected, one checks-failed) over the existing fixtures (`lib/defence/counsel/__tests__/fixture352543.ts` and the not-as-described fixture), written against pre-refactor code in the PR's first commit, passes unchanged after the refactor.
- by SQL 7 days after prod deploy: every `failed` or `skipped` row created after deploy has `failure_signature`; every `skipped` row has `outcome_detail`; every counsel run has `counsel_replay_json`; every `no_counsel_letter` row has non-empty `validation_errors`.

Revert: revert the PR; the columns stay, unused.

### Phase 0b — alerts by class

1. **One predicate.** `isDisputeActionable(dispute)` exported from one module: open, not saved to Shopify in the current response cycle, future `due_at`, and `normalized_status` null or in `merchantActionableStatuses` (null stays actionable, as `defence-package-deadline-rebuild/route.ts:122-125` does). In practice `due_at` is the deciding term: an `under_review` dispute with no deadline normalises to `new` (`lib/disputeEvents/normalizeStatus.ts:44-56`). Checked in prod today: all 28 `needs_response` disputes have a future `due_at`.
2. **Alerts.** Immediate email only when the dispute is actionable (and, for skips, due within 48 h), once per dispute per signature. Everything else in one daily digest (new cron route, `cronEnvGate` first, `vercel.json` entry), one line per `code · module · brief · payment family` with a rule histogram, count, shops and earliest deadline; actionable first.
3. **Retention.** The same cron route nulls `counsel_replay_json` for disputes closed more than 30 days.

Acceptance (tests): the 12 readable cases from today through the alert rule yield 1 immediate email (the one actionable dispute) and 1 digest line; a second failure with the same signature on the same dispute sends nothing; a fileable skip due in 24 h sends once.

Revert: `DEFENCE_FAILURE_DIGEST=off` restores per-package emails and skips the digest email only; the 30-day nulling in the same route keeps running.

### Phase 1 — the system builds only what can be filed, nearest deadline first (RC3)

1. **Requester.** Migration: `jobs.requested_by text` (nullable), mapped into `ClaimedJob` together with the existing `priority` column (`lib/jobs/claimJobs.ts:16-23, 70-77`; `claim_jobs` returns `setof jobs`, so both flow through). `build_pack` carries it and `lib/jobs/handlers/buildPackJob.ts:236` passes it on. `maybeEnqueueDefencePackage(packId, { requestedBy })` writes it to `generated_by` (hard-coded `system` at `enqueue.ts:330, 386`; the check constraint already allows `merchant` and `admin`).

   | enqueue site | requestedBy |
   |---|---|
   | `app/api/packs/[packId]/defence-package/route.ts:49` (direct) | merchant |
   | `app/api/defence-packages/[id]/regenerate/route.ts:89`; `app/api/packs/[packId]/regenerate/route.ts:161` | merchant |
   | `app/api/disputes/[id]/packs/route.ts:116`; `app/api/packs/[packId]/bank-claim/route.ts:266, 336`; `cardholder-acknowledgement/route.ts:274`; `parcel-outcome/route.ts:279`; `return-request-confirmation/route.ts:150` | merchant |
   | `lib/automation/pipeline.ts:499`; `app/api/cron/refresh-open-disputes/route.ts:115`; `lib/disputes/rebuildOnCarrierUpdate.ts:112`; `lib/disputes/requeueOpenPackBuilds.ts:46`; `lib/jobs/handlers/collectProductEvidenceJob.ts:70`; `lib/jobs/handlers/saveToShopifyJob.ts:952`; deadline-rebuild cron; `failedPackageSelfHeal.ts:255` | system |

   A vitest case enumerates every `build_pack` and `build_defence_package` insert in the repo and fails on a site not in this table (an admin-initiated site, if one exists, is classified `admin` by that test). For the first 7 days in prod an unset requester builds and logs.
2. **Gate.** A `system` request for a non-actionable dispute enqueues nothing. Every package insert and every refusal writes `defence_package_enqueued` / `defence_package_generation_skipped` with `requestedBy`, `normalized_status`, `due_at`, `actionable`. `merchant` and `admin` always build. Readers verified not to need a system-built package for a non-actionable dispute: decided view, post-outcome, effects and rebuild outcome read `status = 'submitted'` rows only (`lib/disputes/loadDecidedResponse.ts:73-76`, `lib/postOutcome/runPendingAnalyses.ts:97-99`, `disputeEffectsDispatcher.ts:583-586`, `lib/automation/rebuildOutcome.ts:142-145`); the presentation layer has a `none` state.
3. **Becoming actionable builds.** New: when `isDisputeActionable` flips false → true on `STATUS_CHANGED` or `DUE_DATE_CHANGED` (both no-ops today), enqueue a system build. The gate ships only together with this.
4. **Order.** Priorities today (lower first): sync 50, reconciliation 70, backfill/snapshots 80, refresh 90, default 100. Merchant-requested builds: 40. System `build_defence_package` for an actionable dispute: `60 + min(9, days to due)`, set at `enqueue.ts:341` where the dispute is already loaded.

Acceptance:
- integration: 30 system requests, 9 actionable → exactly 9 packages inserted; 30 actionable with cap 25 → the 25 nearest due get the runs; merchant Regenerate on a non-actionable dispute builds; self-heal and deadline-rebuild enqueue for an actionable dispute; a status flip and a `due_at` null → future change each enqueue; `RESPONSE_REQUESTED_AGAIN` and `RESPONSE_CYCLE_REOPENED` each produce an actionable dispute that builds (this also verifies the "not saved in the current cycle" term).
- prod, 7 days: zero `defence_package_enqueued` events with `requestedBy = system` and `actionable = false`.

Revert: `DEFENCE_BUILD_ACTIONABLE_ONLY=off`.

### Phase 2 — the floor letter (RC2, short term; needs decision 1; depends on 0a's replay script)

If decision 1 is (c): when the picked theory is the brief's last theory and no section is argued (computable in `writeLetter`, `generate.ts:176-181, 232-235`), the letter is summary and request only. The rule lives in `constitution.ts` (no restated date, no computed interval) and the conclusion is dropped in code in `draftFromWriter`; briefs stay data-only. An empty conclusion is already a supported shape (`toNarrative` lists it as omitted; `validateNarrative.ts:735-752` accepts it; `composePdfBlocks.ts:112-131` still prints the request block). Still counsel v2, same checks, same reviewer. Version bump; before it ships, check whether a bump rebuilds a draft the merchant has already approved and whether the approval survives, and report it. Fixtures built through `ledgerForBrief` from pack fixtures: general with delivery (full letter); general without delivery (floor); item-not-received fallen to general with no shipment (floor); not-as-described floor (`briefs/index.ts:126-128`).

If decision 1 is (a): the same condition exits before the writer's model call with skip code `no_counsel_argument` and merchant copy that does not ask for evidence (six locales; `resolveBuildAttempt.ts`, `serverFacts.ts`, the card).

Acceptance: the 12 reconstructed inputs, run through the replay script (nothing filed), give 12 letters that pass `checkDraft` and the reviewer under (c), or 12 typed skips with no writer call under (a). A miss is read and fixed, not re-rolled. Cost per floor letter is printed and compared with today's failing run. Then one real letter (the inquiry due 10-19) is built and shown to the maintainer before any other; the PDF is checked for the request appearing twice.

Revert: revert the change and the version bump.

### Phase 3 — the coverage backlog (RC2, long term)

0a's coverage measure ranks families by approved-fact categories the ledger could not represent on actionable disputes. One family per PR: a brief and its claim builders, designed in `docs/plans/defence-letter-structure.plan.md`, with replay cases, a cost estimate against the general brief, and a one-letter canary approved by the maintainer. Expected first on today's data: CREDIT_NOT_PROCESSED. A ranked list that shrinks; no end date.

### Phase 4 — replay as a release step (RC6)

1. Corpus in `tests/fixtures/counsel-corpus/` through one unit-tested scrubber (names, emails, addresses, order and tracking numbers), every fixture read before commit. Set: item-not-received rich (6a8848-dd) and thin; not-as-described rich and floor; general Klarna floor (whj8db-1q); general card with delivery.
2. Deterministic layers with recorded replies run in vitest on every PR. The live replay run is manual and noted in any `master` PR that changes prompt text, a brief, a check rule or a ledger builder.

Acceptance: reverting Phase 2 turns a vitest case red.

### Phase 5 — structured model output (RC5), conditional

Go criterion from 0a's data: at least 3 `llm_error` rows of class `json_parse` in 14 days. If met: `callClaudeMessages` gains optional `tools` / `tool_choice`; counsel `write` and `correction` force one tool whose input schema is the draft; `parseJson` stays as fallback; `cache_control` block count re-verified (the #798 class); cost on the Phase 4 corpus within 10 % of the current path. Acceptance: zero parse failures on 3 corpus runs against the current path's count on the same runs. Revert: env switch back to free-text replies.

### Phase 6 — conditional items, built only if 0a's data asks

- **Repair pass.** Go: at least 5 `no_counsel_letter` rows in 14 days on actionable disputes where a brief section was argued and every remaining issue is a copy or grounding rule. Then a separate plan, with the constraints already known: sentence spans on issues; never touch the request sentence or empty a part; keep the summary and home-section occurrence (`checks.ts:296-310`); refuse when the next sentence refers back; mandatory reviewer call; shadow first.
- **Letter reuse on unchanged input.** Go: more than 50 identical-input rewrites in 14 days (13 in the last 11). Then revive the voided hook (`run.ts:553-557`, `buildDefencePackageJob.ts:639`): letters only, never failures (the writer and reviewer are not deterministic, so a stored failure must stay retryable), from `counsel_replay_json.lastDraft` re-checked against today's ledger, with a cached prep key for not-as-described.

## 5. Pre-mortem

1. **The actionable gate starves a recovery path or a merchant action.** Mitigation: enumerating test over every enqueue site; unset requester builds for 7 days; the becoming-actionable enqueue ships in the same PR and is tested for status and due-date flips and both reopen events; off switch.
2. **A family goes quiet.** Under decision 1(a) every floor case exits without email. Mitigation: skips are in the signature, the digest and the immediate-alert rule, which ship first.
3. **The canary files something nobody read.** Mitigation: Phase −1 step 4 and Phase 2 read the shop's rule first, take one dispute, and wait for the maintainer.
4. **Stored replay input leaks or lingers.** Mitigation: explicit column lists and payload tests on both routes; scrubber on the corpus path; 30-day nulling that does not depend on the email switch.
5. **The digest cron is off or failing, so nothing alerts.** Mitigation: immediate emails for actionable disputes do not go through the cron; the deadline cron's existing no-file alert is unchanged; the digest route's last-run time is in the SQL file.

## 6. Test plan

- **Unit:** every issue producer has a rule id; signature stability; `isDisputeActionable` over status × due × null × cycle; priority derivation; floor-shape fixtures; scrubber.
- **Integration (stubbed model):** each non-letter path stores code, detail, signature and replay input; characterisation test for 0a; every enqueue site with actionable and non-actionable disputes; the two cap cases; becoming-actionable flips and reopen events; PDF failure notifies; alert dedup and digest content; both route payloads omit the replay column.
- **Replay/e2e:** the replay script from 0a; the 12 reconstructed inputs; the corpus from Phase 4.
- **Observability:** `defence-failure-classes.sql` before and 7 days after each phase; the digest.
- Before each "done": `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run release:verify`; a critic pass on the diff; two shop shapes (whj8db-1q floor Klarna, 6a8848-dd rich card/PayPal) before any prod PR.

## 7. ADR

- **Decision:** make every non-letter outcome typed, true, stored and replayable; alert by class; build only what can be filed, nearest deadline first; make the floor letter writable or exit it honestly; treat family coverage as a ranked backlog; build repair, reuse and structured output only when counted cases justify them.
- **Drivers:** fileable disputes reaching deadlines with nothing; one look per cause; truthfulness.
- **Alternatives:** per-incident patches; observability only (kept as 0a); fallback writer (retired); briefs first (kept as Phase 3); repair now (no supporting case); reuse now (about $0.21 of measured cost against new ways to keep a stale or failed result).
- **Why chosen:** RC1, RC3, RC4 are shown by code and prod counts and are what make failures repeat and multiply; RC2 is the content gap and needs 0a's measure to order.
- **Consequences:** two migrations (three package columns; `jobs.requested_by`); one cron route; `runCounsel` result type; a threaded requester and a new enqueue on becoming actionable; fewer system-built packages; a release step for counsel changes.
- **Follow-ups:** §8; whatever Phase −1 finds in the 13 skips.

## 8. Decisions (maintainer, 2026-10-09)

1. **Floor letter: (c).** Make it writable: summary and request only, no restated dates, no intervals, still counsel v2. Phase 2 is built on (c); the (a) branch is dropped. One letter is shown for approval before any other is built.
2. **Captured bank claim: a gap.** Counsel must write when a bank claim is uploaded; today `:602` skips it. Scheduled as the first item of Phase 3 (the bank claim scopes the facts as it does now, then counsel writes from the scoped ledger), with its own replay cases and one-letter canary. Until it ships these fail as `counsel_bank_claim_unsupported` (0a).
3. **Daily cap: exempt actionable disputes within 7 days of due.** Added to Phase 1: `checkDailyCap` does not refuse a build for an actionable dispute due within 7 days; covered by the "30 actionable, cap 25" test, which then expects every dispute due within 7 days to get a run.
4. **System builds for non-actionable disputes: never** (Phase 1).

Approved to run: the Phase −1 canary (one rebuild of the chargeback due 10-11). The shop's only rule is the default `review` fallback, so a successful build stays a draft and is filed only on the merchant's approval. Not yet run: the prod write was blocked by the session's permission guard and waits for the maintainer.

## 9. Review record

Three Architect + Critic rounds on 2026-10-09. Round 3: Architect "sound with changes" (four blocking edits), Critic "APPROVE WITH EDITS" (seven). All are applied in this revision; the reuse-related edits were resolved by moving reuse out of the committed phases (Phase 6), which both reviews raised as an option. This revision has not itself been re-reviewed.

## 10. Phase 0a as built (2026-10-09)

Built as planned, with these differences:

- **The run reports through a callback, not a new return type.** `runCounsel` still returns the letter or `null` and calls `onTrace` with the outcome, the issues and the replay input. The job tests and the canary script mock or call `runCounsel` with the old shape; a union return would have changed all of them for no gain in what is stored.
- **Issue strings are untouched.** Rule ids are read off the existing strings (`lib/defence/counsel/issueRules.ts`), so the correction prompt's input and every existing soft-issue decision are unchanged by construction. The characterisation test planned for the refactor was therefore not needed; `issueRules.test.ts` classifies a sample of every producer and pins their count.
- **0a.8 (extract the gate sequence) and the Phase −1 explain script were not built.** Each skip now records its own exit, so the 13 fileable skips are explained by rebuilding them once this is live, without a second copy of the gate logic.
- **A model error stores no replay input.** `writeLetter` throws before the trace exists; an `llm_error` row has its signature (`llm_error · module · class`) but not the writer's inputs.
- **`eval-counsel.mts` was kept.** `docs/technical.md` documents its judge; `replay.mts` is added beside it.
- **Retention** of `counsel_replay_json` is not implemented (Phase 0b).

Migration `20261009150000_defence_package_outcome_record.sql` applied to dev and prod on 2026-10-09 and verified on both (three columns, one index).
