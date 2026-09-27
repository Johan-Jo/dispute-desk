# Mein Maison complaint: response status, escalation visibility and the "no return" argument

**Status:** PLAN rev 4, nothing implemented · **Author date:** 2026-09-27 · **Rev 2:** incorporates the code review of 2026-09-27 (response-cycle model, monotonic-guard override, pack/approval retirement, cycle-aware dedupe keys, no new attention value, Shopify creation state instead of an "ingest artifact", unattributed under-review state, no `returns_channel` prefill, no blanket correspondence exemption) · **Rev 3:** second review: no-deadline normalization branch + one shared predicate, pack-cycle migration rule + B4 pack reconciliation, A5 bounded to the current cycle with a live-status check, C2 test requires a specific supporting citation, D2 banner sentences gated on data · **Rev 4:** third review: cycle ledger with a stable anchor key and one idempotent `reconcileResponseCycle`, history reconstruction before live repair, both-order tests on the two known cases; C2 bans absence claims outright and allows only narrow descriptions of one cited message · **Trigger:** Mein Maison (`6a8848-dd`, shop `ea035a1b-8aec-4305-ba2b-27713a6aeff3`) emailed on 2026-09-27 to say the system "would create more damage than good, as it is today".

The complaint makes three claims, and the maintainer added a fourth item on 2026-09-27. Each was checked against prod and against the live Shopify REST API on 2026-09-27, and all four are real:

| # | Claim | Verified finding | Class or instance? |
|---|---|---|---|
| A | "Disputes that have had responses already outside DisputeDesk are seen as pending." | 19 of the 34 disputes on the "Building & monitoring" card are `under_review` in Shopify, meaning a response already went through Shopify. | **Class.** It affects every shop that answers in Shopify Admin. |
| B | "The number of cases and inquiries pending is very wrong." | The dashboard shows 34 building plus 19 under review. Shopify shows **17** that need a response and **36** under review. Two disputes are wrong in the dangerous direction (see B). | **Class** |
| C | "Stuck on the fact that it does not detect a refund, so the case must be fought on that angle." | 27 of Mein Maison's last 50 letters (14 days) argue "no return was initiated". Some go further: "through any channel", "no return request is on record", "inconsistent with a genuine not-as-described complaint". Our only source is Shopify `returnStatus = NO_RETURN`. This merchant takes return requests by email. | **Class.** It affects every merchant whose returns happen outside Shopify. |
| D | Maintainer: "Reopened disputes and inquiries that escalate to chargebacks need a clear flag, and the detail pages don't say whether it's an inquiry or a chargeback." | The list shows an Inquiry/Chargeback pill, but no detail page does. On prod, 42 disputes escalated from inquiry to chargeback (11 open) and at least 36 were reopened after a response (12 open; a lower bound, see §0-B). None of this is recorded or shown. | **Class** |

Work order: **B** (reopen reset) and **D** (visibility) first, because a live deadline on 2026-10-01 is hidden. Then **A** (responses sent through Shopify) and **C** (no-return claims) in parallel.

Our DB `status` matched Shopify on all 53 open disputes. **The sync is correct. The interpretation layered on top of it is wrong.**

---

## 0. Evidence (so nobody has to re-derive it)

### A. A response sent in Shopify is ignored

- `lib/disputes/presentation/resolveLifecycle.ts` → `isTransmissionConfirmed()`. It was changed in `33596a78` on 2026-09-03. It ignores Shopify `under_review` whenever our `submission_state = 'not_saved'`. The stated premise was: *"`under_review` is the ordinary open state for an inquiry from the moment it is created."*
- **The premise misreads Shopify's creation state.** Shopify's own `disputes/create` webhook carries `status: "under_review"` with `evidence_due_by: null`. Minutes later a `disputes/update` moves it to `needs_response` and sets the deadline. Verified from the stored `webhook_events.payload_excerpt` for #103403 and #101111. The mapper (`lib/disputes/disputeSnapshot.ts`) copies the status faithfully, so this is Shopify's pre-deadline state, not our artifact. Across all shops (disputes from the last 60 days, first `status_changed` event):

  | phase | first → second | within 1h of opening | n |
  |---|---|---|---|
  | inquiry | under_review → needs_response | yes | 44 |
  | chargeback | under_review → needs_response | yes | 39 |
  | chargeback | needs_response → under_review | no | 49 |
  | inquiry | needs_response → under_review | no | 6 |

  So `under_review` means two different things:
  - with `evidence_due_by = null`, before any deadline exists: Shopify's creation state, and nothing has been answered;
  - after `needs_response`, with a deadline set: a response went through Shopify. Mein Maison examples: #100300 (answered 09-08 19:05), #99277 (09-21), #103403 (09-25).

  A first observation of `under_review` **with** a deadline and no prior `needs_response` is a third case: under review, but we don't know who responded. We never claim a responder for it without a submission signal (review point 5).
- Inquiry responses in Shopify leave **no** `evidence_sent_on` and **no** `dispute_evidence.submitted_by_merchant_on`, so the status transition is our only observation. Chargebacks answered in Admin sometimes have `submitted_by_merchant_on` without `evidence_sent_on`. Example: #90055 was answered 08-25 and still shows "building evidence" with an out-of-credits warning.
- **Side effect: credits spent on answered disputes.** Packs were built for #101259, #103403 and #103467 on 2026-09-25 21:25, after Shopify had already moved them to `under_review` that morning.

### B. A reopened dispute keeps the old "sent" flag

| Dispute | Shopify now | Our `submission_state` / `normalized_status` | Deadline |
|---|---|---|---|
| #99142 (chargeback, FRAUDULENT) | `needs_response`, `evidence_sent_on` null | `submitted_confirmed` / `submitted` | **2026-10-01** |
| #99348 (inquiry → chargeback) | `needs_response`, `evidence_sent_on` null | `submitted_confirmed` / `submitted` | **2026-10-05** |

- `applyDisputeSnapshot.ts:616` sets `submitted_confirmed` on `evidenceSentOn`, and **nothing ever resets it**.
- It goes further than that. `applyDisputeSnapshot.ts:222-231` is a deliberate **monotonic guard**: when Shopify's `evidenceSentOn` goes from a timestamp back to null, the existing `submitted_at` is *preserved* and only a warning is logged. So a reopen cannot be picked up by the current code at all.
- `normalizeStatus.ts` maps `needs_response + submitted_confirmed → "submitted"`.
- Consequences:
  - The UI shows "Under review".
  - `dispute-reminders` skips the dispute (`submitted_at` is set, and `normalized_status` is not actionable).
  - `defence-package-deadline-submit` skips it (`normalized_status` is not actionable).
  - **No part of our system will act before the deadline.**

**This happens often, and nothing records it.** On prod, all time, measured 2026-09-27:

| Shop | Inquiry → chargeback (open now) | Reopened: `under_review → needs_response` after the first hour (open now) |
|---|---|---|
| 6a8848-dd (Mein Maison) | 39 (10) | 33 (11) |
| cay-collective | 3 (1) | 3 (1) |

- `applyDisputeSnapshot` overwrites `disputes.phase` silently on upsert. It emits no `phase_changed` event and has no column recording that an escalation happened.
- The only trace is the `dispute_opened` event's `metadata_json.phase`. A merchant cannot see an escalation anywhere.
- **The reopen counts are a lower bound.** The status event's dedupe key is `${disputeId}:STATUS_CHANGED:${old}_${new}` (`applyDisputeSnapshot.ts:516`), with no cycle in it. A dispute's *second* `under_review → needs_response` collides with the first, so the ledger silently drops it. The full history of what Shopify sent is in `webhook_events.payload_excerpt`, as far back as `cleanup-webhook-events` keeps it.
- **Old approvals and packs outlive the cycle.** A review approval is stored in two places: `disputes.review_state` and `evidence_packs.approved_for_save_at` (`app/api/packs/[packId]/approve/route.ts:120`). `serverFacts.ts` and the save path read the latest `evidence_packs` row. Clearing `review_state` alone would leave the previous cycle's ready, approved pack eligible to be filed.
- Latent, separate bug found while checking: `updateNormalizedStatus.ts` reads `from("packs").eq("dispute_id", …)`, but the legacy `packs` table has no `dispute_id` column. The query errors, so its pack status is always null. It is out of scope here, but it means `normalized_status` never reflects pack state.

### C. `no_return_initiated` is overclaimed

- **Source:** `lib/packs/sources/orderSource.ts`. We emit this fact when `returnStatus === NO_RETURN` and no refund exists.
- **Admission:** `lib/defence/alwaysAdmissible.ts:78` admits it for every claim type. The rationale reads: *"no adverse reading, PROVIDED the goods really did not come back"*. That proviso cannot be checked for an email-returns merchant.
- **Strength:** `lib/argument/caseStrength.ts` counts it as the product family's "validity" signal (the `refund` signal, labelled `disputes.signalLabelValue.noRefundOwed`). For Mein Maison's not-as-described cases it is often the fact that lifts the rating to Moderate. Example: #100705's strength reason is literally "No refund owed + Delivery".
- **Letter:** the writer widens "Shopify has no return record" into a claim about the buyer's behaviour across all channels. The claim guards explicitly *sanction* "The customer did not request a return." (`claimGuards.test.ts:503`). For this merchant that sentence may simply be false.
- **Unrelated leak:** 1 of the 50 letters (#93670, prompt v39, 09-25) cites "Visa 13 / Mastercard 4853" on what is probably a PayPal-wallet dispute. The PayPal overlay forbids this, so either the payment family didn't resolve or the overlay didn't apply. This needs checking before it is filed (§C6).

### D. The detail page does not say whether it's an inquiry or a chargeback

- The list shows a phase pill: `DesktopDisputesTable.tsx:47` `phasePillColors` plus `lib/disputes/phaseUtils.ts` `phaseLabel` / `phaseBadgeTone`. `MobileDisputeCard.tsx` shows it too.
- The detail pages show nothing. `WorkspaceShell.tsx` (open disputes), `DecidedWorkspace.tsx` (won/lost) and the portal's `app/(portal)/portal/disputes/[id]/page.tsx` never render `phase`. The header is just "Order #…".
- An inquiry and a chargeback need different things from the merchant: an inquiry can be refunded, a chargeback cannot (`reference_never_refund_an_open_chargeback`). The page they act on must say which one it is.

---

## Fix B first: reopened disputes (P0, deadline 2026-10-01)

B goes before A because it hides a live deadline from both the merchant and our own crons. B is built around an explicit **response cycle**. Resetting individual fields is not enough (review points 1, 2 and 4).

**B0. Response-cycle model (migration).**
- **Cycle ledger (review 3, point 1): `dispute_response_cycles`**, one row per cycle *after* the first:
  - `dispute_id`, `cycle int`, `started_at timestamptz` (the time **Shopify** reopened it; never "now"), `trigger` (`reopen` | `escalation`), `source` (`live` | `webhook_history` | `event_history` | `live_repair`);
  - `anchor_key text` with **`unique (dispute_id, anchor_key)`**. The anchor is the prior response the cycle follows: `resp:{timestamp of that response}`. That is our `submitted_at`, Shopify's `evidence_sent_on`, or the time of the `under_review`-with-deadline transition. The anchor is the same whichever path discovers the cycle, and whenever it runs.
- `disputes.response_cycle`, `disputes.reopened_at` and `evidence_packs` / `defence_packages.response_cycle` are **derived from the ledger, never incremented**:
  - `response_cycle = 1 + count(ledger rows)`;
  - `reopened_at = max(started_at)`.
- Plus `disputes.escalated_from_inquiry_at timestamptz`.
- `evidence_packs.response_cycle int` and `defence_packages.response_cycle int`, stamped at build time from the dispute's current cycle.
- **Migration rule for existing rows (review 2, point 2).** One migration, applied before any check reads the column:
  1. add the columns as nullable;
  2. backfill every existing `evidence_packs` and `defence_packages` row to `1`, the same as every dispute's initial `response_cycle` (`default 1`);
  3. set them `not null default 1`.

  No row is ever null when the checks run. The B3/B4 reconciliation then moves disputes to cycle ≥ 2 and reconciles their packs at the same time.
- **The checks ship behind the backfill.** The save, approval and deadline checks land in the same PR as the migration, but they only compare cycles. Until the reconciliation has run, every dispute and every pack is on cycle 1, so the checks are a no-op and cannot refuse a legitimate pack.
- **One invariant:** a pack, a defence package or an approval from cycle N can never be filed, auto-filed or shown as "ready" once the dispute is on cycle N+1. It is enforced in three places:
  - the save job (`saveToShopifyJob.ts`);
  - the deadline-submit cron (`defence-package-deadline-submit`);
  - the approve route (`app/api/packs/[packId]/approve`).
  Each one compares the pack's `response_cycle` with the dispute's and refuses on a mismatch. A test proves each refusal.

**B1. Detect a new cycle and open it.** In `lib/disputes/applyDisputeSnapshot.ts`, a **new response cycle** starts when all of these hold:
- the new Shopify status is `needs_response`;
- a real deadline is set (`evidence_due_by` non-null, not epoch);
- the dispute was previously in a responded state: `existing.status = 'under_review'` *with* a deadline, or `submission_state ∈ {submitted_confirmed, saved_to_shopify, responded_via_shopify}`, or `existing.submitted_at` set.

When it starts, in one update:
- Call **`reconcileResponseCycle(disputeId, { anchorKey, startedAt, trigger, source: 'live' })`**. It is the only writer of cycle state, and the B3 and B4 scripts call it too:
  1. `insert … on conflict (dispute_id, anchor_key) do nothing`. A cycle that already exists for this anchor is **not** added again.
  2. Recompute `response_cycle` and `reopened_at` from the ledger.
  3. Only if step 1 inserted a row, run the reset and retirement below. Re-running the function with a known anchor is a no-op.
- `startedAt` is the time of the Shopify transition: the webhook's `received_at`, or else the snapshot's `shopifyUpdatedAt`. It is **not** the wall-clock time of the run, so a pack built for the new cycle is always newer than its cycle start.
- **Explicit override of the monotonic guard** (lines 222-231): for this transition only, `submitted_at → null` is allowed. The guard keeps preserving `submitted_at` for every other `evidenceSentOn → null` walk-back, which is what it was built for, so the walk-back warning stays for everything else. The previous value goes into the event metadata, never lost.
- Reset `submission_state → 'not_saved'`, `evidence_saved_to_shopify_at → null`, `reminder_sent_at → null` and `review_state → null`.
- **Retire the previous cycle's artifacts, bounded by `startedAt`.** Only rows created **before** `startedAt` are retired. A pack built at or after the cycle start belongs to the new cycle and is re-stamped, never retired. Retired `evidence_packs` rows go to `status = 'archived'` with `approved_for_save_at → null`. The value stays in the event metadata for audit. Open `defence_packages` rows go to `status = 'superseded'`. The B0 check is the backstop if a row is missed.
- Emit `response_cycle_reopened` with dedupe key `${disputeId}:RESPONSE_CYCLE_REOPENED:${anchorKey}`, keyed by anchor so it can't double-fire from two paths, carrying the old `submitted_at`, `submission_state`, `review_state`, the retired pack ids and the old and new deadlines.
- Enqueue a pack build for the new cycle, following the shop's automation mode (decision D-3).

**Phase change is recorded separately** (inquiry → chargeback), whether or not the status changes in the same snapshot:
- emit `escalated_to_chargeback` (key `${disputeId}:ESCALATED_TO_CHARGEBACK`; this happens at most once per dispute);
- stamp `escalated_from_inquiry_at`;
- if the snapshot also opens a new cycle, B1 runs too. Otherwise the escalation alone does not reset anything.

**B2. Cycle-aware dedupe keys everywhere a cycle can repeat (review point 4).**
- `STATUS_CHANGED`: `${disputeId}:STATUS_CHANGED:${old}_${new}:c${cycle}`. This stops a second reopen colliding with the first.
- `SUBMISSION_CONFIRMED`: this key already includes the timestamp; keep it.
- `response_sent_via_shopify` (A2): `${disputeId}:RESPONSE_SENT_VIA_SHOPIFY:c${cycle}`.
- Escalation and reopen emails (D4): keyed by the same cycle.
- `submitted_confirmed` is only re-set when `evidenceSentOn` is **later than** the current cycle's `reopened_at`. A stale non-null value cannot flip a new cycle back to "sent".

**B3. Reconstruct history first (was B4).** Script: `scripts/shopify/reconcile-response-cycles.mjs --mode history`. It is dry-run by default.
- **Escalation:** `escalated_from_inquiry_at` comes from the `dispute_opened` phase vs the current `phase`. For the timestamp, prefer the first `webhook_events` payload with `type: "chargeback"`. Fall back to the first following `due_date_changed`.
- **Cycles:** for every dispute, walk `webhook_events.payload_excerpt` first (because `dispute_events` under-counts repeats, B2), then `dispute_events`. For each `under_review`-with-deadline (or evidence sent) followed by `needs_response` with a deadline, call `reconcileResponseCycle` with:
  - `anchorKey` = that response's timestamp;
  - `startedAt` = the `needs_response` payload's time;
  - `source` = `webhook_history` or `event_history`.

  Where webhook history has been cleaned up, the row is marked `event_history` and counted as a lower bound in the report.
- **Packs:** reconciled inside `reconcileResponseCycle` by the `startedAt` bound (B1). It prints, per dispute, the packs it re-stamps and the packs it retires before `--apply`.
- Print per-shop counts before writing. The earlier measurement (42 escalations and 36 reopens, from events) is a lower bound for reopens. Run on dev, then prod.

**B4. Then confirm the live rows (was B3).** Script: the same file, `--mode live`, using the offline token and an explicit `--env-file`.
- **Candidates:** open disputes that our DB **still** believes are sent after B3: `submitted_at` set, or `submission_state ∈ {submitted_confirmed, saved_to_shopify}`.
- For **each** candidate, fetch the live REST dispute and its evidence, then print the complete set: order, phase, our state, Shopify `status`, `evidence_due_by`, `evidence_sent_on`, `submitted_by_merchant_on`, the anchor it would use, and whether the ledger already holds that anchor.
- **Update only rows confirmed to be in a new cycle:** Shopify `needs_response`, a real future deadline, Shopify `evidence_sent_on` null, AND a prior response to anchor on. Every other row is listed and left alone.
- It writes through `reconcileResponseCycle(… source: 'live_repair')`:
  - `anchorKey` is the prior response's timestamp;
  - `startedAt` is the earliest evidence of the reopen: the webhook or event time if one exists, otherwise the first sync that saw `needs_response` after the anchor. It is recorded once; a re-run hits the same anchor and changes nothing.
- The expected result on prod is #99142 and #99348. That is a check on the output, **not** a selection criterion.

**Why this order and this key.** History runs first, so the live step only handles what history could not see. That covers #99142, whose second `under_review → needs_response` was dropped by the old dedupe key. Because both steps (and the live sync) share one function and one anchor per cycle, running them in either order, or twice, gives the same cycle count, the same `reopened_at` and the same set of retired packs.

**Tests:**
- `applyDisputeSnapshot`:
  - a new cycle opens only when all B1 conditions hold;
  - the guard override applies only to that transition, and a plain walk-back still preserves `submitted_at` and warns;
  - the previous packs are archived, approvals cleared and defence packages superseded;
  - a stale `evidenceSentOn` does not re-confirm the new cycle.
- Dedupe: two reopens on the same dispute produce two `response_cycle_reopened` and two `STATUS_CHANGED` events.
- B0 invariant: the save job, the deadline cron and the approve route each refuse a cycle-N pack on a cycle-N+1 dispute.
- `dispute-reminders` and `defence-package-deadline-submit` select a reopened dispute.
- Repair script: a row that fails any confirmation condition is printed and not updated.
- **Idempotency across paths (review 3, point 1).** Fixtures shaped like **#99142** (second reopen missing from `dispute_events`, present only in live state) and **#99348** (inquiry answered, escalated, reopened):
  - run history → live, then live → history, then each twice;
  - every order ends with exactly **one** ledger row, `response_cycle = 2`, the same `reopened_at`, and the same retired set;
  - a pack built for cycle 2 **between** the two steps is re-stamped to cycle 2 and never retired;
  - a live snapshot arriving afterwards with the same anchor adds nothing and emits no second `response_cycle_reopened`.

---

## Fix D: make phase, escalation and reopening visible (P0 alongside B)

B fixes what the system does. D makes sure the merchant can see it. A reset the merchant cannot see just looks like a dispute that went backwards.

**D1. Phase badge on every detail page.**
- Render the same pill the list uses, "Inquiry" or "Chargeback", from `phaseLabel` / `phaseBadgeTone` in `lib/disputes/phaseUtils.ts`, next to the header title.
- Pages:
  - `WorkspaceShell.tsx` (open disputes)
  - `DecidedWorkspace.tsx` (won/lost)
  - the portal's `app/(portal)/portal/disputes/[id]/page.tsx`
  - the mobile detail layout (check at 393, 375 and 320 px)
- Move `phasePillColors` out of `DesktopDisputesTable.tsx` into `phaseUtils.ts`, so list and detail cannot drift. Existing i18n keys only: `disputes.inquiryBadge` and the chargeback label.
- **Design note (CLAUDE.md rule 8):** `DecidedWorkspace` transcribes Claude Design `DecidedView.dc.html`, which has no phase pill. Adding one is a deliberate change to that design at the maintainer's request (2026-09-27). It is not an interpretation of the design. See D-4.

**D2. Escalation flag: "Escalated from inquiry".** Shown when `escalated_from_inquiry_at` is set.
- **List:** a second chip next to the phase pill, "Chargeback · escalated from inquiry". It's filterable, so the merchant can find all 10 open escalations.
- **Detail:** a banner above the tabs. Each sentence appears only when its data establishes it (review 2, point 5):
  - always: "This started as an inquiry and the buyer escalated it to a chargeback on {date}."
  - only when the **current** Shopify status is `needs_response` **and** a real deadline exists: "A response is due by {deadline}."
  - only when that escalation **opened a new response cycle** (B1 ran, so the `response_cycle_reopened` event exists for this escalation's cycle) **and** the previous cycle had a recorded response: "The response sent for the inquiry does not carry over."

  An escalation that did not open a new cycle, for example one where the inquiry was never answered, or where Shopify reports `under_review`, shows only the first sentence. The "A response is due" line never shows on its own claim; it comes from live status and deadline.
- **Timeline:** the `escalated_to_chargeback` event, rendered through `localizeDescription` (new event type in `MERCHANT_ACTIVITY_EVENT_TYPES`).
- **Decided view:** for escalated disputes, the executive summary names the inquiry cycle, so "who responded" covers both rounds.

**D3. Reopen flag: "Reopened — new response needed".** Shown when `reopened_at` is set, the status is `needs_response` and the dispute is not an escalation. Escalation already says this.
- **List:** a chip.
- **Detail:** a banner. "Shopify reopened this dispute on {date} after an earlier response. A new response is due by {deadline}."
- **Timeline:** the `response_cycle_reopened` event.
- **Dashboard: no new attention value (review point 3).** `resolveAttention.ts` returns attention *values* (`blocking`, `requested`, …) mapped from reasons, and its rule is that a deadline alone never creates a merchant task. A reopen is a **fact about the dispute**, in the same category as deadline risk. It amplifies emphasis but is not itself an action. The merchant action comes from the existing ladder once B1 has reset the cycle:
  - **review mode:** the new cycle's pack becomes ready and unapproved, so the existing approval-gate rung gives `blocking` and the dispute is in **Action required**;
  - **auto mode:** we rebuild and file, so there is no merchant task and the dispute shows in **Building & monitoring**, with the reopen chip and the deadline;
  - a genuine blocker (quota, `auto_build_off`, missing required evidence) surfaces through its existing reason.

  What changes on the dashboard is that the dispute **leaves "Under review"**, because B1 cleared the stale transmission. `DisputePresentation` gains two presentation facts, `reopened: boolean` and `escalatedFromInquiry: boolean`, read by the chips and banners. They are not attention and not buckets.

**D4. Email.** The escalation or reopen of an open dispute sends one email: "{Order} escalated to a chargeback — new deadline {date}". It's gated on the team-email / notification preferences, like `sendNewDisputeAlert`, and deduped per cycle. This follows the standing rule that merchant notifications go by email, not in-app flags only.
- `historicalImport` suppression applies, so backfill (B4) sends nothing.

**D5. Copy.** Every new string goes into all 6 locales in the same commit. Wording rules:
- Use the established Inquiry/Chargeback terms per locale.
- Never write "Shopify automatic response".
- The banner states facts only: no "you must", no advice to concede.
- Update the help articles (`help.embedded.*`: dispute statuses, inquiry vs chargeback) in the same commit.

**Tests:**
- Phase pill renders on all three detail pages (null phase → "Chargeback", matching `phaseLabel`'s safe default).
- Escalation and reopen banners appear and disappear with the columns.
- D2 banner truth table: an escalation without a new cycle shows only the first sentence; `needs_response` + deadline adds the due line; a new cycle after a recorded inquiry response adds the carry-over line; `under_review` never shows a due line.
- A reopened dispute in review mode lands in Action required through the existing approval-gate rung. In auto mode it lands in Building & monitoring. `resolveAttention` is unchanged.
- Email dedupes per cycle and is suppressed on historical import.

---

## Fix A: record a response sent through Shopify (P1)

**A1. Tell Shopify's creation state apart from a response.** Revised after review: there is no ingest artifact to remove. `disputes/create` really does carry `under_review` with `evidence_due_by: null` (§0-A). The rule is:
- `under_review` **and** no deadline (`due_at` null or epoch): **awaiting Shopify's deadline**. Nothing has been answered and nothing has been sent. It is shown as "New", and a pack may be built.
- **Normalization branch (review 2, point 1).** Today `deriveNormalizedStatus` (`lib/disputeEvents/normalizeStatus.ts`) takes no deadline and maps **every** `under_review` to `submitted_to_bank`. It needs:
  - a new `dueAt` input, passed from `updateNormalizedStatus`, which must add `due_at` to its select;
  - an explicit first branch: `under_review` + no real deadline → `new`, with `status_reason` "Awaiting Shopify's response deadline";
  - only `under_review` **with** a deadline still reaching `submitted_to_bank`.
- **All three readers must agree, with one shared predicate** `isAwaitingShopifyDeadline({ status, dueAt })` in `lib/disputes/` used by:
  - normalization (above);
  - `isTransmissionConfirmed` / `resolveLifecycle` (returns false, so the dispute is not "Under review");
  - the build gate (A3: a pack **may** be built, unlike the two responded states).

  One test drives a single fixture (`under_review`, `due_at` null, `not_saved`) through all three and asserts the dashboard bucket, the detail lifecycle and the build decision together.
- The 09-03 guard in `isTransmissionConfirmed` stays correct for this case, and a test pins it.
- Separately, the status-changed feed hides the creation-state hop (`under_review → needs_response` while no deadline exists yet), so the activity feed stops showing a phantom "under review" on every new dispute. The event is still written.

**A2. Two new submission states, so we never claim a responder we didn't observe.** Migration: extend the `submission_state` CHECK. The dead value `manual_submission_reported` means "the merchant told us", which is a different claim, so it is not reused.
- **`responded_via_shopify`**: we observed a response through Shopify. Set in `applyDisputeSnapshot` when either:
  - the status goes `needs_response → under_review` with a deadline set, `submission_state = 'not_saved'` (we sent nothing), and the dispute is not closed; or
  - Shopify's dispute evidence has `submitted_by_merchant_on` (a reliable submission signal) and we sent nothing. This covers #90055, first ingested on 08-29 already answered on 08-25.
- **`under_review_unattributed`** (review point 5): the first observation is `under_review` *with* a deadline, there is no observed `needs_response` before it, and there is no submission signal. Shopify says it is under review, but we do not know who responded or whether anyone did.
  - Presentation: Under review, with the neutral copy "Under review in Shopify". It never says "a response was sent".
  - No pack build. There is nothing to respond to while Shopify reports it under review.
  - If Shopify later moves it to `needs_response`, B1 treats that as a new cycle, because a status with a deadline counts as a prior responded state for B1's purposes.
- **Record:** emit `response_sent_via_shopify` (cycle-keyed, B2) with `actor_type = 'shopify'` for the first state only. The actor is Shopify because we cannot tell a merchant's Admin response from Shopify's own automatic filing (see `project_shopify_files_anyway_reframes_guards`).

**A3. Read it everywhere the "sent" question is asked.** One predicate, so each consumer does not reinvent it:
- `isTransmissionConfirmed()`: `responded_via_shopify` and `under_review_unattributed` return true. `not_saved + under_review` with no deadline returns false (the A1 creation state). The truth table is pinned in tests.
- `normalizeStatus.ts`: → `submitted_to_bank`, with its own `status_reason`.
- `resolveLifecycle` → `under_review`. Dashboard bucket → Under review.
- `lib/disputes/heldState.ts`, `reviewDecision.ts`, `metrics.ts`: audit each one for `submitted_confirmed`-only checks (list in `rg "submitted_confirmed" lib app`).
- **Automation:** do not build, rebuild or spend a credit on a `responded_via_shopify` or `under_review_unattributed` dispute. Gate this in the build-pack entry point and in the credit-arrival sweep (`replayBlockedBuilds.ts`). Reminders and the deadline cron already exclude `submitted_to_bank`, but a test must prove it.

**A4. Merchant copy (6 locales).**
- Detail and list: "A response was sent through Shopify" (the established phrase; never "Shopify automatic response"). No strength warnings and no "held / needs review" chips on these disputes.
- Help article `help.embedded.*` for dispute statuses: one paragraph explaining that we detect responses made in Shopify Admin.

**A5. Backfill: classify only within the current cycle (review 2, point 3).** Run it **after** B3 and B4, so every dispute has its `response_cycle` and a cycle start. The cycle start is the latest of `reopened_at`, `escalated_from_inquiry_at` and `initiated_at`.
1. **Check live status first.** Fetch the dispute and its evidence from Shopify. Continue only if Shopify **now** reports `under_review` with a real deadline and our `submission_state` is `not_saved`. Any other live state is printed and skipped.
2. **Bound every signal by the cycle start.** A transition or submission signal counts only if its timestamp is **after** the current cycle start. So:
   - an inquiry's response from before the escalation cannot mark the chargeback as answered;
   - a response from before a later reopen cannot mark the new cycle as answered.
3. **Classify:**
   - a `needs_response → under_review` transition (with a deadline) inside the current cycle, from `webhook_events` first and then `dispute_events`, or `submitted_by_merchant_on` later than the cycle start → `responded_via_shopify`;
   - neither inside the cycle → `under_review_unattributed`.

The same cycle-start bound applies to the live A2 rule in `applyDisputeSnapshot`: a `submitted_by_merchant_on` older than the current cycle start never sets `responded_via_shopify`.

Script: `scripts/shopify/backfill-response-state.mjs`. It is dry-run by default and prints every row with its evidence before `--apply`.
- Print per-shop counts first. The expected result for Mein Maison is 16 inquiries plus #100506, #100825 and #90055, split across the two states. That is a check, not a selection criterion.
- Run on dev, then prod.
- Closed disputes are left alone, since they no longer show as pending. The event is still emitted so the decided view can say who responded.

**Tests:**
- Transition sets `responded_via_shopify`. First-seen `under_review` with a deadline and no signal sets `under_review_unattributed`. `under_review` with no deadline sets neither. Our own save becomes neither.
- Closed disputes are untouched.
- A reopen (B1) clears it.
- `isTransmissionConfirmed` truth table.
- The build gate refuses. The credit sweep skips.

---

## Fix C: say only what we know about returns (P1, runs alongside A)

**C1. Name the fact by its source.** `no_return_initiated` means "no return is recorded in Shopify", and nothing more.
- Rename the label token to `packs.section.noReturnRecordedInShopify` in all 6 locales.
- Add `source: "shopify_returns"` to the payload so the letter writer sees the scope.

**C2. Claim guard: scope of return statements.** New guard `return_claim_beyond_record` in `lib/defence/claimGuards.ts`. It fails any bank sentence claiming:
- the buyer did not *request / contact / complain / reach out* about a return or refund,
- "no return request is on record",
- "through any channel",
- "at any point",
- "inconsistent with a genuine … complaint", or
- "has not followed the merchant's resolution process",

**Mechanism: unconditional ban on absence claims, no content-support check (review 3, point 2).** The citation validator can prove that a cited fact id exists. It cannot prove that a message *supports* a sentence, and no set of messages can prove an absence ("did not request a return"). So:
- **Absence and contact-history claims are banned outright.** They fail even when correspondence facts exist and even when cited. That covers every pattern above, plus "never contacted", "made no complaint" and "did not ask for a refund". There is no exemption path in v1.
- **Allowed:** narrow statements that directly describe **one cited message**, such as "The customer's email of {date} asked about delivery timing", with that fact's citable id. The existing citation check enforces the id. These describe what a message says; they never generalise to what the customer did or did not do overall.
- **Allowed:** "No return has been recorded in Shopify for this order." It is always true.
- A content-support checker (verifying that a cited message supports a specific sentence) is **not** part of this plan. If one is wanted later, it needs its own design and evaluation.

This **reverses** the sanctioned phrase "The customer did not request a return." in `claimGuards.test.ts:503`. That phrase is exactly the false sentence for an email-returns merchant (**decision D-1**).
- Mirror the rule as a prompt instruction in the product and INR reason modules. Two layers, same as the bank non-disclosure rule.

**C3. Stop scoring absence of data as strength.** In `caseStrength.ts`, `no_return_initiated` counts toward the product family's validity axis and the refund family **only when** the shop's return channel is known to be Shopify (C4).
- Otherwise it stays in the letter as a supporting fact (scoped by C1 and C2) but cannot lift the rating.
- The merchant-facing "No refund owed" label goes. It asserted an obligation we never checked.

**C4. Shop setting: where do customers ask for returns?** `shop_settings.returns_channel`: `'shopify' | 'email_or_other' | null`.
- Asked once in setup and editable in Settings → Automation.
- **Stays `null` (unknown) until the merchant answers.** No prefill (review point 6): one Shopify return in a year proves the shop *sometimes* records returns there. It does not prove that email or other channels are absent. `null` is treated like `email_or_other` for scoring. Wording is governed by C2 for every shop regardless. That fails safe.
- **Only `'shopify'` restores the scoring weight,** and it means the merchant confirmed that Shopify is the **only** channel. The setting copy asks exactly that: "Do customers request returns only through Shopify?"
- Set Mein Maison to `email_or_other` once this ships.

**C5. Ask for the evidence that actually answers the claim.** For `email_or_other` shops, the not-as-described checklist's top ask becomes "Customer correspondence". Merchants can supply it by connecting Gorgias (if they use it) or uploading the email thread.
- To verify before promising this to Mein Maison: do they have a Gorgias integration, and does the upload control render on the embedded detail page? (`feedback_ask_only_for_what_the_merchant_can_actually_do`)

**C6. The card-network leak on #93670.** Check its resolved payment family and whether the PayPal overlay's prohibited phrases were applied.
- If the family was unresolved (the NULL `payment_method` era), re-resolve it and add a test.
- Either way, rebuild #93670 before its deadline of 2026-10-07.

**C7. Rebuild Mein Maison's open letters.** After C1–C3 are on prod:
- Canary with 3 disputes first. Read them.
- Then rebuild the rest of the open, not-yet-sent set: 17 at most after A removes the answered ones.
- Cost at the counsel-v2 rate is about $0.016 per package.

**Tests:**
- The guard catches every paraphrase and allows the scoped sentence ("No return has been recorded in Shopify for this order").
- **Absence claims fail whatever facts exist.** Test cases:
  - "The customer did not request a return." with no correspondence → fails;
  - the same sentence citing a correspondence fact → **still fails**;
  - "The customer never contacted us about this order." citing a fact → fails.
- **A narrow description of a cited message passes:** "The customer's email of {date} asked about delivery timing." with a valid citable id → passes; the same sentence uncited → fails (citation check).
- The sanctioned sentence "No return has been recorded in Shopify for this order." → passes.
- Scoring: `email_or_other` + no_return alone ≠ Moderate.
- Label token parity (`verify-i18n-parity`).

---

## Rollout

| Step | Ships | Gate |
|---|---|---|
| 1 | B0–B2 + migration (`response_cycle` on disputes/packs/defence packages, `reopened_at`, `escalated_from_inquiry_at`) + D1 (phase pill) → develop, then subset-promote to master | **Per-change approval**. Target: on prod before 2026-10-01. D1 is small and independent, so it can go first on its own if B slips. |
| 2 | B3 history reconstruction (dry-run, read, `--apply`), **then** B4 live confirmation (dry-run, read the full printed set, `--apply`) on prod | Both go through `reconcileResponseCycle`. Update only rows confirmed against live Shopify. Verify #99142 and #99348 are no longer "Under review": new cycle, old packs archived, a new pack queued, and the deadline cron and reminders select them. |
| 2b | D2–D5 (escalation/reopen chips, banners, timeline, email, copy) → develop → master | **Per-change approval**. Check on prod data: Mein Maison's 10 open escalations are filterable in the list. |
| 3 | A1–A4 + migration → develop | Run `mm-pres`-style script on prod data. Expect 17 open disputes that need a response (Building & monitoring + Action required, after B) and 36 under review for Mein Maison, which matches Shopify. |
| 4 | A5 backfill on prod | Print per-shop counts first. |
| 5 | C1–C5 → develop | Render 3 Mein Maison letters on prod data and read them. |
| 6 | Master promotion of A + C | **Per-change approval** |
| 7 | C7 canary 3, then the batch | Read the canary before the batch. |
| 8 | Reply to Mein Maison | Only after 1–6 (including 2b) are in prod. Say what changed, with their own counts. |

For every step: `npm test`, `npx tsc --noEmit`, `npm run build`, plus `docs/technical.md` (submission states, reopen/escalation columns and events, the no-return fact, the returns-channel setting) and the help articles in the same commit.

## Decisions needed

- **D-1 (deferred by the maintainer, 2026-09-27):** Fix C (C1–C7) waits on this decision; Steps 1–2b do not depend on it. Narrow the sanctioned no-return wording **for all shops** (proposed), or only for `email_or_other` shops? Proposed: for all shops. "Not recorded in Shopify" is always true. "Did not request" never is, unless we have the inbox.
- ~~D-2~~ **Resolved by review:** `returns_channel` stays unknown until the merchant confirms. No prefill.
- **D-3:** On an inquiry → chargeback escalation or a reopen, should we auto-build and file the new cycle per the shop's automation mode (proposed, consistent with the merchant's-counsel stance), or always park it for review?
- **D-4:** Design for the new UI (phase pill on detail pages, escalation/reopen chips and banners). Proposed: reuse the existing list pill and the existing banner component, with no new design. Alternatively, get a Claude Design pass first, since `DecidedWorkspace` is a design transcription (CLAUDE.md rule 8).

## Out of scope

- Reading the merchant's email inbox directly (IMAP or Gmail connector). That is the real fix for email-returns merchants, but it is a product, not a bug fix. It deserves its own plan.
- The 2026-08-29 install-day "new dispute" alerts for already-closed disputes (#95035, closed 08-23). This is a one-time historical-import issue and needs checking against the `historicalImport` flag separately.
