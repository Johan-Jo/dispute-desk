# Mein Maison complaint: response status and the "no return" argument

**Status:** PLAN, nothing implemented · **Author date:** 2026-09-27 · **Trigger:** Mein Maison (`6a8848-dd`, shop `ea035a1b-8aec-4305-ba2b-27713a6aeff3`) emailed on 2026-09-27 to say the system "would create more damage than good, as it is today".

The complaint makes three claims. Each was checked against prod and against the live Shopify REST API on 2026-09-27, and all three are real:

| # | Merchant's claim | Verified finding | Class or instance? |
|---|---|---|---|
| A | "Disputes that have had responses already outside DisputeDesk are seen as pending." | 19 of the 34 disputes on the "Building & monitoring" card are `under_review` in Shopify, meaning a response already went through Shopify. | **Class.** It affects every shop that answers in Shopify Admin. |
| B | "The number of cases and inquiries pending is very wrong." | The dashboard shows 34 building plus 19 under review. Shopify shows **17** that need a response and **36** under review. Two disputes are wrong in the dangerous direction (see B). | **Class** |
| C | "Stuck on the fact that it does not detect a refund, so the case must be fought on that angle." | 27 of Mein Maison's last 50 letters (14 days) argue "no return was initiated". Some go further: "through any channel", "no return request is on record", "inconsistent with a genuine not-as-described complaint". Our only source is Shopify `returnStatus = NO_RETURN`. This merchant takes return requests by email. | **Class.** It affects every merchant whose returns happen outside Shopify. |

Our DB `status` matched Shopify on all 53 open disputes. **The sync is correct. The interpretation layered on top of it is wrong.**

---

## 0. Evidence (so nobody has to re-derive it)

### A. A response sent in Shopify is ignored

- `lib/disputes/presentation/resolveLifecycle.ts` → `isTransmissionConfirmed()`. It was changed in `33596a78` on 2026-09-03. It ignores Shopify `under_review` whenever our `submission_state = 'not_saved'`. The stated premise was: *"`under_review` is the ordinary open state for an inquiry from the moment it is created."*
- **That premise is an ingest artifact, not Shopify semantics.** Across all shops (disputes from the last 60 days, first `status_changed` event):

  | phase | first → second | within 1h of opening | n |
  |---|---|---|---|
  | inquiry | under_review → needs_response | yes | 44 |
  | chargeback | under_review → needs_response | yes | 39 |
  | chargeback | needs_response → under_review | no | 49 |
  | inquiry | needs_response → under_review | no | 6 |

  Every dispute is born `under_review` in our table and becomes `needs_response` on the first detail sync. A **later** `needs_response → under_review` means a response went through Shopify. Mein Maison examples: #100300 (answered 09-08 19:05), #99277 (09-21), #103403 (09-25).
- Inquiry responses in Shopify leave **no** `evidence_sent_on` and **no** `dispute_evidence.submitted_by_merchant_on`, so the status transition is our only observation. Chargebacks answered in Admin sometimes have `submitted_by_merchant_on` without `evidence_sent_on`. Example: #90055 was answered 08-25 and still shows "building evidence" with an out-of-credits warning.
- **Side effect: credits spent on answered disputes.** Packs were built for #101259, #103403 and #103467 on 2026-09-25 21:25, after Shopify had already moved them to `under_review` that morning.

### B. A reopened dispute keeps the old "sent" flag

| Dispute | Shopify now | Our `submission_state` / `normalized_status` | Deadline |
|---|---|---|---|
| #99142 (chargeback, FRAUDULENT) | `needs_response`, `evidence_sent_on` null | `submitted_confirmed` / `submitted` | **2026-10-01** |
| #99348 (inquiry → chargeback) | `needs_response`, `evidence_sent_on` null | `submitted_confirmed` / `submitted` | **2026-10-05** |

- `applyDisputeSnapshot.ts:616` sets `submitted_confirmed` on `evidenceSentOn`, and **nothing ever resets it**.
- `normalizeStatus.ts` maps `needs_response + submitted_confirmed → "submitted"`.
- Consequences:
  - The UI shows "Under review".
  - `dispute-reminders` skips the dispute (`submitted_at` is set, and `normalized_status` is not actionable).
  - `defence-package-deadline-submit` skips it (`normalized_status` is not actionable).
  - **No part of our system will act before the deadline.**

### C. `no_return_initiated` is overclaimed

- **Source:** `lib/packs/sources/orderSource.ts`. We emit this fact when `returnStatus === NO_RETURN` and no refund exists.
- **Admission:** `lib/defence/alwaysAdmissible.ts:78` admits it for every claim type. The rationale reads: *"no adverse reading, PROVIDED the goods really did not come back"*. That proviso cannot be checked for an email-returns merchant.
- **Strength:** `lib/argument/caseStrength.ts` counts it as the product family's "validity" signal (the `refund` signal, labelled `disputes.signalLabelValue.noRefundOwed`). For Mein Maison's not-as-described cases it is often the fact that lifts the rating to Moderate. Example: #100705's strength reason is literally "No refund owed + Delivery".
- **Letter:** the writer widens "Shopify has no return record" into a claim about the buyer's behaviour across all channels. The claim guards explicitly *sanction* "The customer did not request a return." (`claimGuards.test.ts:503`). For this merchant that sentence may simply be false.
- **Unrelated leak:** 1 of the 50 letters (#93670, prompt v39, 09-25) cites "Visa 13 / Mastercard 4853" on what is probably a PayPal-wallet dispute. The PayPal overlay forbids this, so either the payment family didn't resolve or the overlay didn't apply. This needs checking before it is filed (§C6).

---

## Fix B first: reopened disputes (P0, deadline 2026-10-01)

B goes before A because it hides a live deadline from both the merchant and our own crons.

**B1. Reset on reopen (the class fix)**
- **File:** `lib/disputes/applyDisputeSnapshot.ts`, status-change branch.
- **When:** the previous status is `under_review` (or `submission_state ∈ {submitted_confirmed, responded_via_shopify, saved_to_shopify}`) AND the new Shopify status is `needs_response`.
- **Reset:**
  - `submission_state → 'not_saved'`
  - `submitted_at → null`
  - `evidence_saved_to_shopify_at → null`
  - `reminder_sent_at → null`
  - `review_state → null`. An approval of the previous cycle's pack must not auto-file into the new cycle.
- **Record:** emit a `response_cycle_reopened` event, with the old values in `metadata_json`, so the history is kept.
- **If `phase` changed** (inquiry → chargeback), enqueue a pack rebuild. The reason module and the letter differ between phases.
- `updateNormalizedStatus` then derives an actionable status. Reminders, the deadline cron and the Action-required card pick the dispute up with no further change.

**B2. Keep `evidenceSentOn` from resurrecting the old state.** Only set `submitted_confirmed` when the snapshot's `evidenceSentOn` is **newer** than the reopen event, not merely non-null. Otherwise a stale field flips the dispute straight back.

**B3. Repair the existing rows.** Once B1 is on prod, the next sync repairs everything it touches. The two known rows should not wait for that. Their deadlines are 10-01 and 10-05, so run a scoped script: `scripts/sql/repair-reopened-submission-state.sql`. It selects rows where `status = 'needs_response' AND submission_state = 'submitted_confirmed'` and `closed_at IS NULL`, then prints the set before updating. Expected set on prod: #99142 and #99348, plus any other shop's rows. Run it on dev first. Emit a `response_cycle_reopened` event for each repaired row.

**Tests:**
- `applyDisputeSnapshot`: reopen resets every field, and a stale `evidenceSentOn` does not re-confirm.
- `normalizeStatus`: `needs_response + not_saved` after a reopen maps to an actionable status.
- `dispute-reminders`: a reopened dispute is selected.

---

## Fix A: record a response sent through Shopify (P1)

**A1. Find and kill the birth-as-`under_review` artifact.** Locate where a new dispute row gets `status = 'under_review'` before the first detail sync: webhook payload mapping, a default, or the list query. Store the status Shopify actually reports, or `null` until the detail sync.
- **Why first:** every other rule below is simpler once the first recorded status is truthful. It also stops the 83 "under_review → needs_response" events a month showing up in the activity feed.

**A2. New submission state `responded_via_shopify`.** Migration: extend the `submission_state` CHECK. The existing dead value `manual_submission_reported` means "merchant told us", which is a different claim, so it gets its own value instead.
- **Set** in `applyDisputeSnapshot` when:
  - the status goes `needs_response → under_review`, AND
  - `submission_state = 'not_saved'` (we did not send anything), AND
  - the dispute is not closed.
- **Also set** on first ingest when Shopify reports `under_review` with a real (non-epoch) `evidence_due_by` and `submitted_by_merchant_on` is present. This covers disputes answered before we ever saw them, like #90055.
- **Record:** emit a `response_sent_via_shopify` event with `actor_type = 'shopify'`. The actor is Shopify because we cannot tell a merchant's Admin response from Shopify's own automatic filing (see `project_shopify_files_anyway_reframes_guards`).

**A3. Read it everywhere the "sent" question is asked.** One predicate, so each consumer does not reinvent it:
- `isTransmissionConfirmed()`: `responded_via_shopify` returns true. Keep the 09-03 guard for plain `not_saved + under_review` with no observed transition. That now only occurs for the ingest artifact, which A1 removes.
- `normalizeStatus.ts`: → `submitted_to_bank`, with its own `status_reason`.
- `resolveLifecycle` → `under_review`. Dashboard bucket → Under review.
- `lib/disputes/heldState.ts`, `reviewDecision.ts`, `metrics.ts`: audit each one for `submitted_confirmed`-only checks (list in `rg "submitted_confirmed" lib app`).
- **Automation:** do not build, rebuild or spend a credit on a `responded_via_shopify` dispute. Gate this in the build-pack entry point and in the credit-arrival sweep (`replayBlockedBuilds.ts`). Reminders and the deadline cron already exclude `submitted_to_bank`, but a test must prove it.

**A4. Merchant copy (6 locales).**
- Detail and list: "A response was sent through Shopify" (the established phrase; never "Shopify automatic response"). No strength warnings and no "held / needs review" chips on these disputes.
- Help article `help.embedded.*` for dispute statuses: one paragraph explaining that we detect responses made in Shopify Admin.

**A5. Backfill.** Replay `dispute_events` into the new state: for each open dispute, take the last `needs_response → under_review` transition, then check that nothing later took it back to `needs_response`. Script: `scripts/sql/backfill-responded-via-shopify.sql`.
- Print per-shop counts first. The expected result for Mein Maison is 16 inquiries plus #100506, #100825 and #90055.
- Run on dev, then prod.
- Closed disputes are left alone, since they no longer show as pending. The event is still emitted so the decided view can say who responded.

**Tests:**
- Transition sets the state. Our own save does not become `responded_via_shopify`.
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

**unless** a `customer_communication` fact (Gorgias or an upload) supports it. "No return has been recorded for this order" stays allowed.

This **reverses** the sanctioned phrase "The customer did not request a return." in `claimGuards.test.ts:503`. That phrase is exactly the false sentence for an email-returns merchant (**decision D-1**).
- Mirror the rule as a prompt instruction in the product and INR reason modules. Two layers, same as the bank non-disclosure rule.

**C3. Stop scoring absence of data as strength.** In `caseStrength.ts`, `no_return_initiated` counts toward the product family's validity axis and the refund family **only when** the shop's return channel is known to be Shopify (C4).
- Otherwise it stays in the letter as a supporting fact (scoped by C1 and C2) but cannot lift the rating.
- The merchant-facing "No refund owed" label goes. It asserted an obligation we never checked.

**C4. Shop setting: where do customers ask for returns?** `shop_settings.returns_channel`: `'shopify' | 'email_or_other' | null`.
- Asked once in setup and editable in Settings → Automation.
- **Default for existing shops (decision D-2):** the proposal is `null`, treated like `email_or_other` for scoring and like the C2 guard for wording. That fails safe: no shop gets a claim it can't back.
- **Signal** for which shops really use Shopify returns: any order with `returnStatus` other than `NO_RETURN` in the last 12 months. We could pre-fill `'shopify'` from that.
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
- Guard catches every paraphrase and allows the scoped sentence. It stays silent when a correspondence fact exists.
- Scoring: `email_or_other` + no_return alone ≠ Moderate.
- Label token parity (`verify-i18n-parity`).

---

## Rollout

| Step | Ships | Gate |
|---|---|---|
| 1 | B1+B2 → develop, then subset-promote to master | **Per-change approval**. Target: on prod before 2026-10-01. |
| 2 | B3 repair on prod | Print the set, then update. Verify #99142 and #99348 are actionable in the API output. |
| 3 | A1–A4 + migration → develop | Run `mm-pres`-style script on prod data. Expect 17 open disputes that need a response (Building & monitoring + Action required, after B) and 36 under review for Mein Maison, which matches Shopify. |
| 4 | A5 backfill on prod | Print per-shop counts first. |
| 5 | C1–C5 → develop | Render 3 Mein Maison letters on prod data and read them. |
| 6 | Master promotion of A + C | **Per-change approval** |
| 7 | C7 canary 3, then the batch | Read the canary before the batch. |
| 8 | Reply to Mein Maison | Only after 1–6 are in prod. Say what changed, with their own counts. |

For every step: `npm test`, `npx tsc --noEmit`, `npm run build`, plus `docs/technical.md` (submission states, the no-return fact, the returns-channel setting) and the help articles in the same commit.

## Decisions needed

- **D-1:** Narrow the sanctioned no-return wording **for all shops** (proposed), or only for `email_or_other` shops? Proposed: for all shops. "Not recorded in Shopify" is always true. "Did not request" never is, unless we have the inbox.
- **D-2:** Default `returns_channel` for existing shops: `null`, fail-safe (proposed), or pre-fill from `returnStatus` history?
- **D-3:** On an inquiry → chargeback reopen, should we auto-build and file the new cycle per the shop's automation mode (proposed, consistent with the merchant's-counsel stance), or always park it for review?

## Out of scope

- Reading the merchant's email inbox directly (IMAP or Gmail connector). That is the real fix for email-returns merchants, but it is a product, not a bug fix. It deserves its own plan.
- The 2026-08-29 install-day "new dispute" alerts for already-closed disputes (#95035, closed 08-23). This is a one-time historical-import issue and needs checking against the `historicalImport` flag separately.
