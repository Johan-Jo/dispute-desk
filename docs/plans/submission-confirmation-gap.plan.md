# Submission confirmation gap — "verified" does not mean filed

**Status:** **v3 2026-09-04 — PARTLY SHIPPED, verified 2026-09-07.** §3's detection is in prod. §0's urgency is WITHDRAWN — the six cases needed no action, and the reasoning that made them look urgent was wrong. §§4 and 5 remain open and are the real remaining value here.

> ### Status true-up — 2026-09-07
>
> Re-verified against prod (`aokhplydttxtebvbeuzc`), live Shopify, and `master`.
>
> | § | Claim | State today |
> |---|---|---|
> | **0** | Six live cases, manual submission required | **WITHDRAWN — no action needed.** See below. |
> | **3** | Watch saves the platform never confirmed | **DONE** — `lib/automation/unconfirmedForwarding.ts`, PR #649 (`7b24dcc2`), wired into `defence-package-deadline-submit`. |
> | **4** | Auto-build flip does not sweep the backlog | **OPEN** — no sweep on `false → true`. |
> | **5** | Deadline crons fire after early-morning deadlines | **OPEN** — `vercel.json` still `0 6` / `0 8` UTC. Re-measured 2026-09-07: **328 of 664 (49.4%)** of disputes due since 2026-06-01 fall before 08:00 UTC. The plan's 49.6% holds. |
>
> ### Why §0 is withdrawn
>
> §0 called for manually submitting the stuck saves in Shopify Admin. That was the wrong conclusion, and the population data says so:
>
> - **129 of 136 saves (95%) reach `submitted_confirmed` on their own.**
> - `240d293a` forwarded itself on **2026-09-06 23:21**, *hours after* its deadline, unprompted.
> - **`f3c335bf` (#13794) was WON — $637 recovered — with `submitted_at` NULL throughout.** The issuer saw evidence we never had confirmation of.
>
> So `evidenceSentOn: null` is substantially a **reporting gap on Shopify's side**, not proof the evidence was never forwarded. This plan's own §0 said as much (*"An unconfirmed save is NOT proof that nothing reached the issuer"*) and then recommended acting as though it were.
>
> **Submitting early is strictly worse than waiting.** It is a one-way door that closes the amendment window while the evidence is already on Shopify's object and will be forwarded at the deadline regardless. `#352218` improved across **five package versions** before its save — exactly the improvement an early submit forecloses. There is no upside to trade for that.
>
> The Shopify bug is unchanged and still reproduces (re-tested on canary `56c07c16`, 2026-09-07: HTTP 200, `userErrors: []`, `evidenceSentOn` still null, evidence fields intact). It simply does not require the response §0 proposed.
>
> **The genuine defect was never the submission** — it was reporting evidence as confirmed-filed when we could not know that. §3 fixed it.
**Deliverable:** stop DisputeDesk from reporting evidence as filed when Shopify never accepted it. Gate the terminal pack state on Shopify's own `evidenceSentOn` / `disputeEvidence.submitted` rather than on a field-echo readback, alert on the gap, and close the two adjacent paths that let a case reach its deadline with nobody having acted — the unswept backlog after an auto-build flip, and deadline crons that run after early-morning deadlines.
**Deployment:** branch `promote/assessment-policy-v2`; prod = `master`. All figures below are read from **prod** (`aokhplydttxtebvbeuzc`) on 2026-09-04.
**Evidence SQL:** `scripts/sql/submission-confirmation-gap.sql`, queries Q1–Q9d. Every figure in this plan is labelled with the query that produced it.
**External source:** S1 — [Shopify Developer Community, "Issue with evidence submission via the API"](https://community.shopify.dev/t/issue-with-evidence-submission-via-the-api/36411) — `disputeEvidenceUpdate` with `submitEvidence: true` returns success while `submitted` stays false and `evidenceSentOn` stays null. Reproduces 2025-01 → 2026-07. Acknowledged by a Shopify moderator as a known duplicate of an earlier report; **no fix, no timeline**.

> **Out of scope:** whether Shopify's bug is fixable by us (it isn't), the
> PayPal pre-May-2026 dispute blind spot (separate plan — see §6.4), and any
> change to what evidence we compose. This plan changes only what we *believe*
> and *report* about a save, and who gets told when belief and reality diverge.

---

## 0. Time-critical — six live cases, two expiring today

**Q2.** Six blume-box chargebacks are marked `evidence_packs.status = 'saved_to_shopify_verified'`, `defence_packages.status = 'submitted'`, `disputes.submission_state = 'saved_to_shopify'` — and Shopify still reports them `NEEDS_RESPONSE` with `evidenceSentOn: null`, twenty days after the save.

| Dispute | Amount | Reason | Saved at | Due (UTC) |
|---|---|---|---|---|
| `4f4c8560-5ead-4477-8869-4a1b2567905e` | $104.00 | FRAUDULENT | 2026-08-15 21:30:31 | **2026-09-04 23:00 — today** |
| `4b28f64f-e343-4b57-95e0-8e2bb6475389` | $104.00 | FRAUDULENT | 2026-08-15 21:30:17 | **2026-09-04 23:00 — today** |
| `240d293a-c3bc-4849-80a7-9aa0c23dd278` | $120.00 | FRAUDULENT | 2026-08-15 21:30:45 | 2026-09-06 23:00 |
| `5b195dd0-7951-4bd1-9ca8-9a5e852e4d12` | $210.00 | FRAUDULENT | 2026-08-15 21:31:39 | 2026-09-10 23:00 |
| `d00d141b-dba1-4c61-894f-9caa53353284` | $210.00 | FRAUDULENT | 2026-08-15 21:31:12 | 2026-09-10 23:00 |
| `56c07c16-5649-427b-af02-278a9347a69a` | $38.60 | FRAUDULENT | 2026-08-16 03:10:43 | 2026-09-23 23:00 |

**$786.60 total, $208.00 expiring within hours.** All six carry a rendered PDF (`defence_packages.pdf_path` set, v1–v5). The evidence exists; it is sitting on the evidence object unsubmitted.

All six come from the 2026-08-15 bulk filing run (see `[[feedback_canary_before_bulk]]`, `[[feedback_irreversible_scope_confirm]]`). That run's other saves landed — this is not "the whole batch failed", it is a silent partial failure nobody could see.

### 0.1 There is no programmatic remedy — confirmed on prod, 2026-09-04

Live state re-read from Shopify (not `raw_snapshot`) via `scripts/shopify/probe-submission-state.mjs`: all six still `NEEDS_RESPONSE`, `evidenceSentOn: null`, evidence fields present, windows open. Then **both** submission paths were attempted against the canary `4f4c8560`:

| Path | Call | Response | Result |
|---|---|---|---|
| GraphQL | `disputeEvidenceUpdate(input: { submitEvidence: true })` | HTTP 200, `userErrors: []` | `evidenceSentOn` **still null** |
| REST | `PUT …/dispute_evidences.json { submitted: true }` | HTTP 200, no errors | `submitted_by_merchant_on` **still null** |

Evidence fields intact after both (`accessActivityLog, customerEmailAddress, customerFirstName, customerLastName, uncategorizedFile` before and after). The REST record's `updated_at` still reads **`2026-08-15T14:30:28-07:00`** — our original save. Neither call so much as touched the row.

This settles the open question in S1 (*"whether programmatic submission via the public API is intended or if submission is restricted to the admin UI"*): **on this store, submission is Admin-UI only.** DisputeDesk cannot self-heal these, and no retry we write will ever land.

### 0.2 Two internal gates also refuse — and the second one is right

The app's *own* submitter was then tried on the canary, by correcting the pack status and enqueuing a normal `save_to_shopify` job. It hit two gates in sequence:

1. **`ALLOWED_PACK_STATUSES` (`saveToShopifyJob.ts:64`) = `{ready, saving, saved_to_shopify}`.** All six packs are `saved_to_shopify_verified`, which is **not** in that set, so every retry route — including the merchant's own submit button — refuses them as *"not a submittable state."* **The false `verified` stamp is what locked the submitter out of exactly the cases that needed it.** This is §1's defect producing a second, independent harm: it does not merely misreport, it disables the remedy.

2. **`selectFileablePackage` returned `none / stale`.** Not the row's DB status (v4 is `submitted`) but the freshness verdict at `:191` — the stored decision/assessment/plan hashes and policy version no longer match current, because v4 was built 2026-08-15 under the *previous* scoring policy. `:26-27` is emphatic: **"A DEADLINE RELAXES NOTHING (P-6). … Coverage, a hard block, staleness"**, and `PROMOTABLE_AT_DEADLINE` covers status only, never staleness. The handler's own comment: *"retrying cannot make a persisted narrative safe, a superseded row current… Only a rebuild can."*

Gate 2 is **correct behaviour and must not be relaxed.** It is refusing to file an argument scored under a retired policy. The consequence, though, is the thing to internalise:

> Once a save silently fails, the window to re-file it *as-is* closes the moment the scoring policy moves. After that the only routes are a rebuild (new credit, new LLM narrative, different content than what is attached to Shopify) or a human pressing Submit now on the PDF already sitting on the evidence record.

**That is the argument for §3.5's escalation being immediate rather than at T-24h.** A same-day alert is remediable by pressing one button; a twenty-day-old one may require a rebuild, or may be unrecoverable. Detection latency, not detection itself, is what decides which.

**Action A0 — today, before 23:00 UTC. A human must press "Submit now" in blume-box's Shopify Admin.** There is no API alternative. Links, in deadline order:

All links below are `https://admin.shopify.com/store/blume-box` + the path shown. **Build these with `getShopifyDisputeUrl` (`lib/shopify/shopifyAdminUrl.ts`), never by hand** — the first draft of this plan hand-rolled `/payments/disputes/{dispute_numeric_id}` and every link 404'd. The correct form is `/payments/dispute_evidences/{evidence_numeric_id}`; that file's header documents the trap explicitly.

| Due (UTC) | Amount | Shopify Admin path | DisputeDesk path |
|---|---|---|---|
| **09-04 23:00** | $104.00 | `/payments/dispute_evidences/11097276609` | `/apps/disputedesk-1/app/disputes/4f4c8560-5ead-4477-8869-4a1b2567905e` |
| **09-04 23:00** | $104.00 | `/payments/dispute_evidences/11097080001` | `/apps/disputedesk-1/app/disputes/4b28f64f-e343-4b57-95e0-8e2bb6475389` |
| 09-06 23:00 | $120.00 | `/payments/dispute_evidences/11103535297` | `/apps/disputedesk-1/app/disputes/240d293a-c3bc-4849-80a7-9aa0c23dd278` |
| 09-10 23:00 | $210.00 | `/payments/dispute_evidences/11111497921` | `/apps/disputedesk-1/app/disputes/5b195dd0-7951-4bd1-9ca8-9a5e852e4d12` |
| 09-10 23:00 | $210.00 | `/payments/dispute_evidences/11111334081` | `/apps/disputedesk-1/app/disputes/d00d141b-dba1-4c61-894f-9caa53353284` |
| 09-23 23:00 | $38.60 | `/payments/dispute_evidences/11141316801` | `/apps/disputedesk-1/app/disputes/56c07c16-5649-427b-af02-278a9347a69a` |

**Action A1 — after each click.** Re-run `node scripts/shopify/probe-submission-state.mjs <uuid>` to confirm `evidenceSentOn` is non-null. Do not trust the Admin UI's own confirmation; that is the same class of assumption this whole plan exists to remove.

**Action A2 — if the Admin button also fails,** this is a Shopify Support case with the six dispute ids, the two 200-with-no-effect responses above, and S1 as prior art.

---

## 1. The defect

`lib/jobs/handlers/saveToShopifyJob.ts` runs `saving → saved_to_shopify_unverified → saved_to_shopify_verified` (`:11`). The promotion to `verified` is decided by `verifyEvidenceReadback` (`:648`), and `verified === true` iff `fields_missing` is empty.

`lib/shopify/verifyEvidenceReadback.ts` defines what can be missing:

> *"Verifiable fields are the seven readable text columns on `disputeEvidence`. Write-only fields (`submitEvidence`, …) land in `fields_write_only` and never as missing."* — `:22-26`

So `submitEvidence` — the one field that decides whether the merchant is actually defended — is **structurally excluded from verification**. `saved_to_shopify_verified` asserts "the text and file fields we wrote are on the evidence object." It has never asserted "Shopify accepted this for the bank."

That was a defensible design when the mutation was assumed to be atomic. S1 shows it is not: the mutation can accept the fields, return no errors, and leave `submitted: false`. Our readback confirms the fields, reports success, and we write `verified` over a case that will expire undefended.

The primitive to detect this **already exists** — `disputes.submission_state` distinguishes `saved_to_shopify` from `submitted_confirmed`, the latter set by `applyDisputeSnapshot.ts:459-464` from Shopify's `evidenceSentOn`. Nothing reads the difference. `rebuildOutcome.ts:68` explicitly treats the two as equivalent:

```ts
return s === "saved_to_shopify" || s === "submitted_confirmed";
```

**This plan does not add a missing capability. It stops discarding one we already compute.**

---

## 2. Scale, measured

- **Q1** — prod `submission_state`: 793 `submitted_confirmed`, 334 `not_saved`, **10 `saved_to_shopify`**.
- **Q3** — of every save DisputeDesk has made (packs with `saved_to_shopify_at` set, n=106), **98 landed, 8 did not**. Two of the 8 have since closed (`f3c335bf` WON, `d466544f` LOST) — outcome reached without our evidence. The other six are §0.
- Landing rate **92.5%**. One save in thirteen silently does nothing, and no code path or human currently notices.

The rate is the finding, not the six cases. At blume-box's volume this recurs every bulk run.

---

## 3. Fix — gate the terminal state on submission, not on field echo

**3.1 Extend the readback query.** Add `submitted` to the `VerifyEvidence` query in `verifyEvidenceReadback.ts:44`, and read the parent dispute's `evidenceSentOn` in the same round trip. Keep `submitEvidence` in `WRITE_ONLY_FIELDS` — we verify the *effect*, not the input.

**3.2 Split the terminal state.** `verified` currently conflates two questions. Make it three-valued:

| Condition | Pack status | Meaning |
|---|---|---|
| fields confirmed **and** `submitted === true` | `saved_to_shopify_verified` | filed, window closed |
| fields confirmed, `submitted === false` | **`saved_to_shopify_unsubmitted`** *(new)* | our evidence is on the object; Shopify has not taken it |
| fields missing | `saved_to_shopify_unverified` | existing meaning, unchanged |

Do **not** reuse `unverified` for the new case — it already means "the write may not have landed," and merging them would hide which of the two failures occurred. Two levels, two names (`[[feedback_canonical_model_definitions_vs_instances]]`).

**3.3 Do not mark `defence_packages.status = 'submitted'` on an unsubmitted save.** All six §0 rows carry it. That column is what the merchant UI and the post-outcome analysis read.

**3.4 Retry once, then stop — do NOT build a retry loop.** §0.1 proves both API paths no-op with a success response, so a backoff schedule would burn quota re-proving a known-dead call. Re-attempt **once** (cheap, and covers a genuine transient), then go straight to §3.5. Re-use the same PDF and the same GID; never regenerate content — this is a mechanically failed API call, not a rejected generation (`[[feedback_no_generation_retry_loops]]`).

**3.5 Escalation is the remedy, not a fallback.** Because we cannot submit, the merchant is the only actor who can. When a pack lands `saved_to_shopify_unsubmitted`:

- emit `submission_not_confirmed` and set an attention reason so it appears in triage;
- email the merchant immediately — **not** at T-24h — with a deep link to the dispute in Shopify Admin and one instruction: press **Submit now** (`[[project_gorgias_evidence_ready_email]]` — merchant notifications are email, not in-app flags);
- re-check on the deadline-rebuild cron and re-notify while it stays unsubmitted and the window is open;
- never render this case as filed anywhere in the UI.

This inverts the current failure mode: today the merchant is told it is handled and it is not. `[[feedback_ask_only_for_what_the_merchant_can_actually_do]]` — pressing Submit now is something they genuinely can do, and it is the only thing that works.

**3.6 Write `submission_attempts`.** The table exists with exactly the right shape (`actor_type`, `method`, `readiness`, `shopify_result`, `override_reason`) and **has zero rows across all shops** — nothing has ever written it. It is the natural home for the attempt/outcome pair this plan produces. Populating it also makes §2's landing rate a standing metric instead of an ad-hoc join.

---

## 4. Enabling auto-build does not sweep the backlog

**Verified on Mein Maison (`6a8848-dd`) this session.** `auto_build_enabled` went `false → true` at **2026-09-03 19:48:19 UTC** (`automation_settings_changed`, `impersonated: true`). The pipeline resumed within nine minutes — but since the flip it has touched exactly **two** disputes, `769a11cc` and `7d2a3eb4`, both triggered by their own webhooks.

**Q6** — the shop has **24 open disputes, 8 with no pack at all**. Nothing re-evaluates them, because the pipeline only runs on a fresh trigger.

Concrete casualty: `a01dc3a9-4d82-42dc-ac06-b6424deccd18`, €50.36, **due 2026-09-06 03:00 UTC**. Pack `ready` at completeness 88, last touched 2026-09-02 00:08 — before the flip. It still shows the merchant *"Not assessed yet … DisputeDesk reassesses the case automatically before the response deadline — nothing is needed from you."*

**Fix.** When `auto_build_enabled` transitions `false → true`, enqueue a re-evaluation sweep for that shop's open disputes, ordered by `due_at` ascending, at background priority (`[[project_interactive_job_priority_starvation]]` — do not let a sweep starve interactive work). Same treatment for a quota top-up: the credit-arrival sweep of PR#608/#609 is the existing precedent (`[[project_quota_exit_burns_pipeline_claim]]`).

**Copy consequence.** The "reassesses automatically before the response deadline" promise in `messages/en.json:1971` is only true when auto-build is on *and* a trigger will arrive. Gate that sentence on `auto_build_enabled`; when it is off, say what the merchant must do. Note also that **prod is currently serving different text than this branch carries** — prod says *"assessed under an earlier version of our scoring… Nothing has changed about your evidence"*, the branch says *"The evidence on this case changed after it was last assessed."* Reconcile that drift before shipping more of `promote/assessment-policy-v2`.

---

## 5. Deadline crons fire after early-morning deadlines

`vercel.json`: `defence-package-deadline-rebuild` at `0 6 * * *`, `defence-package-deadline-submit` at `0 8 * * *`. Both scan `due_at` within the current UTC day (`route.ts:103-104` and `:153-154`).

A dispute due at 03:00 UTC is *inside* the query window and *past* its deadline when either cron runs.

- **Q4** — prod, disputes due since 2026-06-01: **323 of 651 (49.6%) are due before 08:00 UTC.**
- **Q5** — Mein Maison's open book: **16 of 24 due before 06:00 UTC**, i.e. missed by both crons. `a01dc3a9` (03:00 UTC) is one of them.

This is a class defect, not a tuning issue: European deadlines land in the small hours UTC by construction.

**Fix.** Run the deadline pair more than once a day — e.g. rebuild at `0 */4 * * *` and submit at `0 */4 * * *` offset by two hours — and change the window from "today in UTC" to "due within the next N hours, not yet submitted." The absolute-deadline decision logic in `deadline-submit` already computes its window at execution from `due_at` (`route.ts:283-284`), so it does not need to change; only the scan bounds and the schedule do. Confirm the per-shop job cap still holds under a 6× schedule increase before shipping.

---

## 6. Smaller items found in the same pass

**6.1 `build-one-pack.mjs` writes `actor_type='merchant'`.** **Q7.** Mein Maison's only four "merchant" audit rows are `job_queued` with `note: single-pack rebuild via scripts/build-one-pack.mjs`, `actor_id: NULL`. A local script is polluting the only channel that records genuine merchant action — the exact channel §3.6 and any "did the merchant act?" question depend on. Give the script `actor_type: 'admin'` or `'script'`.

**6.2 Two columns, one read.** `shops.auto_pack_enabled` was `true` while `shop_settings.auto_build_enabled` was `false`, and the pipeline reads only the latter (`pipeline.ts:325`). Either delete the dead column or make it a view of the live one. This is what made §4 hard to diagnose.

**6.3 Inquiry submission is possible on every rail we can observe — nobody has tried PayPal.** **Q8.** blume-box files on 3 of 3 card inquiries; cay-collective on 4 of 65 Klarna inquiries (filed by Shopify or the merchant — `saved_to_shopify_at` is null on all four, so not by us). Mein Maison: **0 of 174 PayPal-wallet inquiries**. Shopify's docs place PayPal Wallet disputes squarely in Admin and describe no auto-submission on the merchant's behalf, so every `evidenceSentOn` is a deliberate act. The likeliest reading is behavioural — inquiries move no money, so merchants ignore them — but it is **not separable from an API refusal until we attempt one**. §3.1's readback makes the first PayPal-wallet inquiry submission self-answering: it will report `submitted` true or false. Do not write copy promising anything about inquiries until that returns.

**6.4 PayPal pre-May-2026 blind spot — needs its own plan.** Every dispute we hold for Mein Maison sits on `payment_gateway='shopify_payments'`. Their ~44,000 orders on standalone `gateway='paypal'` (through April 2026) produced **zero** disputes in our data; PayPal disputes appear only from 2026-05, when PayPal moved inside Shopify Payments as a wallet. Any baseline computed for this merchant across 2025-08 → 2026-04 rests on 29 card disputes — about 5% of their book. The May 2026 step-change is visibility, not behaviour. Flag before the win-rate model is quoted again.

---

**6.5 Gorgias enrichment is slow and the waiting copy misdescribes why. NOT a loop — v2 of this plan claimed one and was wrong.**

The v2 text asserted an infinite re-enqueue driven by `no_matches` not being renderable. Pulling `gorgias_enrichment_runs` (**Q9d**) instead of inferring from two `app_events` rows refutes it:

| Run | Status | Trigger | Started | Completed |
|---|---|---|---|---|
| `b999f76a` | `no_matches` (`customer_not_found`) | manual | 16:08:40 | 16:10:39 |
| `3a937641` | `no_matches` (`customer_not_found`) | manual | 16:07:48 | 16:08:39 |
| `3c2695fc` | `no_matches` (`customer_not_found`) | dispute_opened | 2026-07-28 04:12:38 | 04:16:12 |

**Three runs in total, ever.** Both of today's are `trigger_source: manual` — the merchant clicking Refresh, not the app re-firing. Both jobs `succeeded`. The run status `no_matches` **is** persisted as a terminal state, and it is **not** in `RUN_PROCESSING_STATUSES` (`GorgiasCommsReviewSection.tsx:85`), so the UI does render `status.noMatches` — *"No support conversations were found for this customer."* There was no loop and nothing to fix there.

What is real:

- **(a) The runs are slow** — 51s, 119s, and 214s. During that window the spinner is correct, which is why it read as hung. Worth a look at why `customer_not_found` takes ~1–3 minutes to conclude, since it resolves nothing.
- **(b) `status.queuedNote` misdescribes the wait.** *"This is queued behind other background work and will run automatically"* fires at `QUEUED_GRACE_MS = 30_000`. blume-box had **zero** other queued or running jobs (**Q9c**); job `10223fc9` was created 16:08:40 and locked 16:10:38, so the ~2-minute wait was the worker cron's tick interval against an empty queue, not a backlog. The copy names a cause that was not the cause. Gate it on real queue depth, or say "waiting for the next worker run".

The lesson is the plan's own: **(a) and (b) are small; the v2 error was not.** Two `app_events` rows were read as a loop without checking the run table that records the outcome — the same shape as the `saved_to_shopify_verified` defect this plan exists to fix, an optimistic reading asserted without checking the fact behind it. `[[feedback_verify_absence_against_primary_source]]`.

---

## 7. Sequencing

| # | Work | Gate |
|---|---|---|
| A0 | Re-submit the two disputes due today; then the other four | **merchant-facing — needs the go first** |
| 1 | §3.1–3.3 readback + status split, with tests pinning `submitted: false` → `saved_to_shopify_unsubmitted` | `develop` |
| 2 | §3.4 bounded retry, §3.5 T-24h escalation + email | `develop` |
| 3 | §5 cron schedule + window | `develop`, verify job-cap headroom |
| 4 | §4 flip-triggered sweep + copy gate | `develop` |
| 5 | §3.6 `submission_attempts` writes; §6.1, §6.2 | `develop` |
| 6 | Prod promotion | **per-change approval, `[[feedback_no_prod_deploy_without_per_change_approval]]`** |

**Definition of done for step 1:** a test that stubs `disputeEvidenceUpdate` returning success with `submitted: false` and asserts the pack lands `saved_to_shopify_unsubmitted`, `defence_packages.status` is *not* `submitted`, and an audit event is written. Without that test this regresses the moment Shopify's bug intermittently resolves.

**Verification before "done":** `npm test`, `npx tsc --noEmit`, `npm run build` (§4 touches copy and UI).
