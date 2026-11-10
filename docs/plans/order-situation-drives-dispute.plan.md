# The order's situation drives the dispute: returns and refunds

**Status:** ralplan revision 7 (2026-10-10), after five review rounds (§10). **Phase B has consensus** (Critic: approve with edits, applied here). **Phase C** carries the round-5 edits and has not been re-reviewed since. **Phase B1** needs a design choice and its own short plan before it is built. Revision 4's rule (letter in the chargeback phase only) is withdrawn. Phases A and B0 are in production (#1063 `7f15972c`, #1065 `4930b595`). Phases B, C and D are pending approval. Decisions are in §8.
**Trigger:** whj8db-1q order #21037, dispute `defa8294-38cb-435f-b09c-5c354ea509d5` (Klarna inquiry, credit not processed, 967 SEK, due 2026-10-10 23:00 UTC, auto mode). The maintainer: "everything is wrong here. We are asking to upload evidence that has no relevance … a customer acknowledgement of receipt of a product that's already been returned. This has to be brought up on a higher level."
**Consistent with:** `docs/plans/defence-package-failure-classes.plan.md` (Phase 0a shipped: `outcome_detail`, `failure_signature`, `counsel_replay_json`).
**Code references:** `origin/develop` at `81791d82`.

## 1. What is established (read-only, 2026-10-09)

### 1.1 The case

| date | event (Shopify's own order events, stored in the pack's `access_log` section; 30 fetched, latest 20 kept) |
|---|---|
| 10 Aug | ordered, paid with Klarna |
| 12 Aug | shipped, DHL |
| 24 Aug | carrier: collected at pickup point |
| 27 Aug | store created return #21037-R1, added tracking information to it, emailed return instructions |
| 22 Sep | customer opened the inquiry |

`Order.returnStatus = IN_PROGRESS`. Refunded: 0.00. The customer's claim is "I returned it and was not refunded".

### 1.2 What the app does with it today

| # | behaviour | where |
|---|---|---|
| D1 | The return events are never shown to the merchant. The timeline is the bank letter's allow-list; "created return" matches no category and is dropped. The allow-list is shared by the PDF and its HTML mirror and must not be widened. | `lib/defence/chronology.ts` (`CHRONO_ALLOW`, `buildChronologyEvents`) |
| D2 | "Add cardholder acknowledgement" is offered on every open dispute without a merchant-supplied acknowledgement. `canOfferCardholderAcknowledgement` takes three inputs (the marker, `submissionState`, `finalOutcome`) and no order or family input. Its input is constructed in three places and reaches the new-dispute email through `resolveHeldState`. | `heldState.ts:224-231, 396`; `heldState.legacy.ts:68`; `CardholderAcknowledgementCard.tsx:99`; `sendNewDisputeAlert.ts:787-803, 1062` (email: "Add cardholder acknowledgement →") |
| D3 | "Refund status: missing" and "Return status: missing". Both rows are filled from Shopify only. For the return row, "missing" means a return IS open. The missing rows also feed "Add missing evidence". | `completeness.ts:175-187, 531-545`; `orderSource.ts:260-295`; `useDisputeWorkspace.ts:1123` (`deriveMissingItems`) → `OverviewTab.tsx:1292`; `refundPresentation.ts:66-76` |
| D4 | The letter tab says "Not enough bank-facing evidence … Upload additional supporting documents". No brief can use an upload for this family. | `CompleteDefencePackageCard.tsx:1027-1045` (`messages/en.json:1441, 1876`) |
| D5 | The build is skipped: `outcome_detail.exit = record_context_only`, facts `{order_record: 1, policy_refund: 1}`. Nothing is filed. | `buildDefencePackageJob.ts:552-557` |
| D6 | The return and its shipment are not collected. | no collector; no scope |
| D7 | At the deadline the fallback email calls an inquiry "the chargeback dispute", says DisputeDesk has filed nothing, and asks the merchant to regenerate the package or add evidence in Shopify Admin. | `defence-package-deadline-submit/route.ts:430-492` (`sendDefenceDeadlineFallbackAlert`) |
| D8 | A not-as-described letter can say the return route is open while a return is in progress: `return_route_open` does not read `returnStatus`. | `notAsDescribedLedger.ts:224` (only `no_return_recorded` at `:193` reads it) |
| D9 | Overview said "Pack prepared — No action required". | fixed 2026-10-09, #1060 / #1061 |

### 1.3 Who already reads return or refund state

`returnRequestConfirmation.ts:56-80` (boolean), `orderSource.ts:215-256` (`refundHistory` section), `:275-295` (`no_return_initiated` gate), `creditTiming.ts:86-140` (coverage, currency-aware), `fatalLoss.ts:117-141` and `returnedToSender.ts:100-108` (raw refund ≥ dispute amount), `buildPack.ts:743`, `contradictionGate.ts:113-144`, `notAsDescribedLedger.ts:191-193`, `refundPresentation.ts:38-76`, `heldOrCancelledUnrefunded.ts:47-69` (an existing merchant-only order-state note), `workspace/route.ts:489-494, 1257`, `bankClaimAnalysis.ts:127`.

Fifteen readers, three refund comparisons. The return status itself had one consumer.

### 1.4 What Shopify gives us

Probed live (`scripts/shopify/probe-order-returns.mjs`, read-only): `order { returnStatus totalRefundedSet refunds events }` is available. `order { returns { … } }` answers **`ACCESS_DENIED` — "Access denied for returns field."** The return, its status and its tracking need `read_returns`, which the app does not request.

## 2. Root cause

There is no single statement of the order's situation and, more importantly, no single statement of what follows from it. Each surface derives its own partial view and its own consequence (checklist from a per-reason template, acknowledgement offer from nothing about the order, timeline from a bank allow-list, letter gate from approved facts, two emails from their own inputs). A return or refund changes what is true, what is relevant and what the merchant can do, differently per dispute family, and nothing carries that across the surfaces.

## 3. RALPLAN-DR

**Principles**
1. One derivation of the situation and one table of its consequences. Surfaces read both; none forms its own.
2. Ask the merchant only for something they can do, where the control renders and the answer changes the outcome. An irrelevant ask is worse than no ask, and its removal comes with a true statement of what happens next.
3. The merchant sees the facts that explain the state of their dispute, including facts that are never bank-facing.
4. A return or refund reaches the bank only where it answers the claim made, as a true sentence, never as an admission the claim did not raise.
5. Nothing is collected or asked that the access we hold cannot support; a new scope is its own plan.
6. Silence from the merchant never withholds a filing that could be made truthfully (counsel stance).

**Decision drivers**
1. The merchant must not be sent to do irrelevant work while the deadline runs.
2. Six fileable disputes on one shop have nothing we can file; the fix has to reach a letter.
3. Truthfulness and the counsel stance.

**Options**

| | A. Patch strings; hide the offer for this reason | B. Shared situation, per-surface consequences (draft 1) | B′. Shared situation **and one consequences table** (chosen) | C. New scope first | E. Fix the checklist at the completeness layer only |
|---|---|---|---|---|---|
| For | fastest | one input | one input and one place that says what follows per family; a matrix test; new surfaces cannot drift | the decisive fact is collected | stored state is right |
| Against | repeats per surface and family | each surface still decides for itself: half of "a higher level" | a per-family table to agree with the maintainer | every shop re-consents; nothing for the six meanwhile | fixes one of nine defects |
| | rejected | superseded | **chosen** | own plan (Phase D) | folded into B′ (the checklist reads the table) |

## 4. Design

### 4.1 The situation (built, Phase A)

`lib/disputes/orderSituation.ts`: `resolveOrderSituation({ returnStatus, refundedAmount, events })` → `{ returns: none | requested | in_progress | returned | failed | unknown, refund: none | some | unknown, returnOpenedAt }`. Unrecognised or absent values are `unknown`, never `none`. Coverage of the disputed amount stays in `creditTiming.ts`. `shopifyRecordsReturnOrRefund` / `packShowsReturnOrRefund` read it (parity-tested).

**Two things with two guarantees (Phase B step 0).** Phase A ships a test that nothing under `lib/defence`, `lib/packs`, `lib/argument`, `lib/shopify` or `lib/jobs` may reference `orderSituation`, and a module header saying it is not read by the letter. Phases B and C need the resolver in exactly those places. So the guarantee is split:
- The **resolver and the consequences table** are pure and importable anywhere.
- The **merchant note** is what must never reach a bank: `OrderSituationNote`, the `disputes.overviewExtra.orderSituation.*` copy and the `dispute.orderSituation` payload stay out of `DefencePackageHtmlView`, `lib/defence/pdf` and `chronology.ts`. The Phase A test and header are rewritten to say so.

### 4.2 The consequences (one function, one table)

`situationConsequences(situation, family, phase)` in the same module, pure, returning tokens and flags that every surface reads. `family` is `ReasonFamily` from `resolveReasonFamily` (`lib/argument/reasonFamily.ts:19-27`), passed in by the caller. The matrix test iterates the whole union, so a new family fails the test until it has a row.

| family | situation | acknowledgement offer | return row in the checklist | upload ask on a skipped letter | merchant question | letter path |
|---|---|---|---|---|---|---|
| refund | `requested`, no refund | **not offered** | not something to supply | **not shown**; the situation's own explanation | none (nothing may have been sent yet) | no return claims; the build exits as today |
| refund | `in_progress`, no refund | **not offered** | not something to supply | **not shown** | "Have you received the return?" (Phase C; optional) | credit-not-processed brief (Phase C); files without an answer, in either phase (decision 11) |
| refund | `returned`, no refund | **not offered** | not something to supply | **not shown** | **none: Shopify already records receipt** | **no letter**; merchant-only copy by phase (§4.4, "received") |
| refund | `failed` | not offered | not something to supply | not shown | none | no return claims; the build exits as today |
| refund | no return, no refund | offered (unchanged) | "no return recorded" (existing fact) | unchanged | none | existing |
| refund | any refund on record | not offered | states the record | not shown | none | existing refund facts; fatal-loss gate unchanged |
| product | any return on record | not offered: a receipt acknowledgement does not answer "not as described" once the goods are on their way back | not something to supply | unchanged | none | **no sentence about returns; `return_route_open` withheld** (D8) |
| product | no return | offered | existing | unchanged | existing return-request question where configured | existing |
| delivery | any return state | **offered (unchanged)**: an acknowledgement of receipt is on point | not something to supply | unchanged | none | never mentions the return |
| fraud | any | **offered (unchanged)** | n/a | unchanged | none | never mentions the return |
| subscription, billing, digital, general | any | offered (unchanged) | not something to supply when a return is on record | unchanged | none | never mentions the return |
| any | partial refund only, no return | per the family row; suppresses nothing outside `refund` | unchanged | unchanged | none | unchanged |
| any | `unknown` | unchanged | unchanged | unchanged | none | unchanged |

An exchange appears in Shopify as a return plus a new order; it follows its return row. Cancelled or on-hold unrefunded orders keep `heldOrCancelledUnrefunded`; folding cancellations into this table is a follow-up, stated so principle 1 is not claimed where it is not yet true.

### 4.3 Bank-facing rules (principle 4)

| family | may the letter mention the return or refund? |
|---|---|
| credit not processed | Yes, as a **scoped exception** to the rule in `returnRequestConfirmation.ts:9-11` that "the customer asked for a return" is never bank-facing: here the claim itself asserts a return and a refund owed. Only while the return is `in_progress`. Permitted claims are code-owned and verbatim (§4.4). Never: that goods were received and not refunded, and never anything once Shopify records the return as received. |
| not as described | Only "no return has been recorded" (existing) when `returns = none`. With a known status other than `NO_RETURN`: no sentence about returns, and `return_route_open` is withheld (Phase B, D8). `unknown` is unchanged. |
| not received | Never. A return started by the customer is evidence of receipt, but citing it tells the bank the merchant accepted a return on goods it kept the money for; the delivery record makes the same point without that. |
| fraud, subscription, billing, digital, general | Never, until that family has its own brief. |

A processed refund covering the disputed amount remains the fatal-loss gate's case and is unchanged.

### 4.4 The credit-not-processed claims (Phase C)

All code-owned and verbatim; each a ledger claim with `mustNot`; each with its own exemption in `claimGuards.ts` beside `RETURN_ABSENCE_REQUIRED` (`:488-489, 533-535`). A paraphrase with "conditional" or "only after" trips `policy_terms_beyond_record`, which is why they are not left to the writer.

| claim | condition | sentence |
|---|---|---|
| `return_authorised` | `returns = in_progress` at build time | dated (English-admin shops, when the event is in the kept timeline): "The merchant authorised a return for this order on {date}." Otherwise: "The merchant authorised a return for this order." |
| `refund_conditional_on_receipt` | the published refund policy says so, **verified by a new extraction** (below) | "The store's published refund policy provides a refund once returned goods have been received." |
| `return_not_recorded_received` | `returns = in_progress` at build time; the merchant's most recent answer is not a "received" kind; and there is no fresh "not received" answer | "The store's records do not show the returned goods as received." (approved 2026-10-10, §8 decision 9; narrower wording proposed, decision 15) |
| `returned_goods_not_received` | the merchant answered **not received**; the answer is at most 7 days old; `returnStatus` equals `return_status_at_answer` and is `IN_PROGRESS` | "The merchant has confirmed that, as of {answered date}, it has not received any returned goods for this order." Replaces `return_not_recorded_received`; the two never appear together. |

**Minimum ledger.** Klarna's evidence page lists "Return status unclear or not stated" among its rejection reasons (§8.1; read as a summary, to be read line by line before Phase C is built). So every letter states the status: exactly one of `return_not_recorded_received` or `returned_goods_not_received`, with `return_authorised` beside it. `refund_conditional_on_receipt` is added when the policy supports it and is no longer required (this replaces decision 6's pairing). `return_authorised` never stands alone. If neither status claim's condition holds, the build exits as today.

**Where the rule lives.** The code-owned sentences are rendered in `lib/defence/counsel/recordSections.ts` (`:204-210`). The ledger builder is the only producer of the two status claims and emits exactly one or none; `checkDraft` (`counsel/checks.ts`) gains a presence rule that a draft from this brief contains exactly one of the two rendered sentences. The existing exemption in `claimGuards.ts:533-535` removes a verbatim constant; that fits `return_not_recorded_received` and the undated `return_authorised`. The two dated sentences are exempted by matching the sentence rendered from the fact (date included), not by a constant; `runClaimGuards` already receives the approved facts (`:496-500`). Step 4 first runs the four sentences through `runClaimGuards` and adds an exemption only where one fails. `checkDraft` validates every brief other than not-as-described and general against the not-received rules (`checks.ts:336`); the new brief gets its own branch there.

**No-letter exit.** A new `SkipExit` value, `return_received`, for the three cases where the goods are back: `returns = returned`, the merchant answered **received**, or (until Phase C2) **received, but not accepted**. It sits in `buildDefencePackageJob.ts` inside the `if (activePlan)` block (`:501`), after `fatal_loss` (`:517`) and `no_safe_argument` (`:524`), before `record_context_only` (`:552`) and so before `runCounsel` (`:619`). Its inputs are not in the job today and are added: the reason family from `resolveReasonFamily` (the `:333-335` value is the payment family), the situation from the pack's order section, and a loader for the stored answer across cycles. It is behind the same allow-list as the brief.

**New extraction (not existing work).** `lib/defence/counsel/policyTerms.ts` extracts only a return window and has one caller, gated on the not-as-described path. Phase C adds `refundOnReceipt` and its quoted sentence to the schema, `verifyRefundOnReceipt` (the sentence is in the policy text and carries a receipt or inspection word in the six locales), and a `prepareCreditNotProcessed` call site in `run.ts` that loads the policy snapshot. One extra model call per package, counted in the cost measurement. Whether the claim is allowed on Klarna is checked against decision D9 (`notAsDescribedLedger.ts:41-43`, which withholds the return route there): all six disputes are Klarna.

**The merchant's answer.** A new route (the existing one returns 409 whenever a return is on record, `return-request-confirmation/route.ts:88-96`), storing in the existing `dispute_return_request_confirmations` table with a `question` discriminator. The control asks Klarna's own question, "Have you received the return?" (field `customer_return_received`), with Klarna's three answers, so what the merchant tells us is what Klarna will ask them. It cannot be confused with `returned_parcel_outcome`, which is about an outbound parcel the carrier brought back. It is optional. Rows are keyed on the dispute and its response cycle, as the existing question is, but the two kinds of answer live differently:

- **The most recent answer across all response cycles governs** (by `answered_at`). The question stays answerable, so the merchant can always replace an answer.
- If the most recent answer is **"received"** of either kind, it never expires: at any age and in any later cycle the build exits `return_received`. It cannot decay into the record sentence.
- If the most recent answer is **"not received"**, it goes stale after 7 days, on a different `returnStatus`, or in a new response cycle. A stale one is not used, the question is shown again, and the build files the record sentence. That holds also when it had replaced an earlier "received": the merchant's last word was that the goods had not arrived.

The three outcomes:


- **not received** → `returned_goods_not_received` (bank-eligible for the refund family only).
- **received, but not accepted** → **no letter** until Phase C2 (below), exit `return_received`. The merchant told us the goods arrived, so the record sentence would be one we know to be misleading. Merchant-only copy: "DisputeDesk cannot yet argue a refused return for you. Add your reason and any photos or inspection notes in Shopify Admin."
- **received** → never bank-facing; no letter. Merchant-only copy:
  - inquiry: "You told us the returned goods have reached you. Shopify shows no refund on the order. An inquiry can still be refunded in Shopify." (decision 16: the approved wording "resolves an inquiry" is sourced for Klarna only.)
  - chargeback: "You told us the returned goods have reached you. Shopify shows no refund on the order. A chargeback cannot be refunded in Shopify while it is open; the bank decides it."
- **Shopify records receipt** (`returns = returned`; no question is asked) → no letter. Merchant-only copy: "Shopify records the return as received and no refund on the order." followed by the same phase sentence.
- **unanswered** → the letter files with `return_not_recorded_received` (§8 decision 11).

A refund within the inquiry period resolves a Klarna inquiry (Stripe's Klarna guide, §8.1). The copy renders for every refund-family inquiry, card ones included, so it says only what holds for all of them.

**The store's own return label.** Klarna holds the merchant liable for a return sent on the merchant's label "even if it is lost in transit" and expects the label's status (§8.1). Neither status claim says the customer did not send the goods, and neither is to be strengthened into that. Whose label it was and where the parcel is are Phase D's facts; until then the letter states what the store's record and the merchant say, and no more.

**Phase C2 — a refused return (outline; needs decision 12 before design).** "Received, but not accepted" is a defence in Klarna's process and under Visa 13.7 (return outside the disclosed policy). It needs the merchant's reason from a code-owned list (outside the return window; not the items sold; parcel empty; items used or damaged), their file, and code-owned sentences per reason. No free text from the merchant reaches the bank. Not built in Phase C.

## 5. Phases

Each is one PR to `develop`, then a `master` PR that waits for the in-chat go. Each ends with one render check of the dispute page in the embedded app on two shop shapes, at desktop and 393/375/320 px, as an explicit gate.

### 5.0 The six, exactly

All are Klarna inquiries on whj8db-1q (auto mode), credit not processed, return `IN_PROGRESS`, no refund.

| dispute | due (UTC) | Phase A (note) | Phase B (asks) | Phase C (letter) |
|---|---|---|---|---|
| `defa8294` #21037 | 10-10 23:00 | live | no | **no: cannot be built, canaried and approved in time** |
| `02d9de6d` | 10-19 | live | yes, if released | only if C is in prod and its canary approved before then |
| `c87a84fd` | 10-22 | live | yes | as above |
| `95e6c556`, `54f6dc2d` | 10-25 | live | yes | likely |
| `d4b2b40c` | 10-26 | live | yes | likely |

Phases A and B file nothing. **#21037 passes its deadline with nothing filed by DisputeDesk; a response is sent through Shopify from the order's own data.** Its fallback email now calls it an inquiry (B0). What that costs is not known: §8.1 could not measure whether a response during a Klarna inquiry changes anything. There is no operator path in this plan: contacting the merchant outside the app, or refunding, is the maintainer's call.

### Phase A — the merchant-only note (in production: #1062, #1063 `7f15972c`)

`orderSituation.ts`; the boolean readers delegate (parity test over the status × refund matrix, including an unrecognised status); `dispute.orderSituation` with `asOf` in the workspace payload; `OrderSituationNote` on `OverviewTab` and above the letter card in `ReviewSubmitTab`; copy in six locales; help article; structural tests. Verified: `tsc`, 7,428 tests, i18n parity, build. Not verified: rendered in the embedded app.

### Phase B0 — the deadline email names the proceeding (in production: #1064, #1065 `4930b595`)

`lib/email/sendDefenceDeadlineFallbackAlert.ts` gained `phase`; the copy says "inquiry" or "chargeback dispute". The email is English-only, as before. Tests in `lib/email/__tests__/deadlineFallbackAlert.test.ts`.

### Phase B — the consequences table, and the asks that read it

0. Split the guarantee (§4.1): rewrite the Phase A import test and module header.
1. `situationConsequences` with the §4.2 table and its matrix test over every `ReasonFamily` × situation × phase.
2. `AcknowledgementOfferInput` gains **required** `situation` and `family`. It is constructed in three places, which `tsc` then fails until updated: `workspace/route.ts:1225`, `sendNewDisputeAlert.ts:1073`, `CardholderAcknowledgementCard.tsx:99` (`heldState.ts:396` and `heldState.legacy.ts:68` pass it through). Pack sections and reason are available at all three. Test on the email's text.
3. Checklist, keyed on the **field**: `OrderContext` gains `hasReturnOnRecord`; `resolveItemStatus` (and its v1 twin, `completeness.ts:244`) returns `unavailable` / `collectable: false` for `no_return_initiated` when it is set. Keyed on the field and not on a requirement mode, because the six disputes use the DB template for Klarna inquiries (`buildPack.ts:638`, `klarnaInquiryTemplate.ts:64-72`), where the row's mode is `optional` and a mode-based rule in the code templates never applies. Tests on both branches, including a Klarna-inquiry-template fixture.
   - Effect: the row leaves the score's denominator (weight 0.5, `completeness.ts:866-868`). `submission_readiness` and blockers do not move (the row is neither critical nor blocking); case strength does not move. Before release, count the open packs whose score crosses the shop's auto-save threshold because of it and report the number.
   - Stored checklists do not change by themselves (the read path only appends rows, `workspace/route.ts:530`; `deriveMissingItems` reads the stored status). After release the open packs with a return on record are rebuilt: two first, read, then the rest. A rebuild can send the merchant the evidence-ready email; the count of affected packs and that email are stated to the maintainer before the rebuild.
   - `refund_record` stays as it is and is presented through `refundPresentation.ts` ("No refund issued"); it is excluded from "Add missing evidence" when the consequences say it is not something to supply.
4. Letter tab, `CompleteDefencePackageCard.tsx:1027-1045`: a branch for the refund family when a return is on record **and no refund is** (`returns` in `requested`, `in_progress`, `returned`, `failed`; `refund = none`), shown only while the dispute's latest package is `skipped`. Any refund on record keeps today's copy. The package route selects only `defence_packages` and strips `outcome_detail` (`defence-packages/[id]/route.ts:29, 40`); it gains a derived token computed from the exit plus the source pack's order section. Copy (`en`; `{proceeding}` is "inquiry" or "chargeback"):
   - title: "DisputeDesk has no response to file for this {proceeding} yet"
   - body: "Shopify records a return on this order and no refund. DisputeDesk has filed nothing for this response. If that has not changed by the deadline, a response is sent through Shopify from the order's own data."
   - with `returns = returned`: the same title, and "Shopify records the return as received and no refund on the order." as the body.
   - Phase B makes no promise about a later letter. Because the branch is keyed on a `skipped` package, a dispute whose letter is built in Phase C's canary stops showing it without any copy change.
5. Deadline fallback email, under the same predicate as step 4 (refund family, a return on record, `refund = none`): "DisputeDesk filed nothing for this response. Shopify records a return on order {order} and no refund, and DisputeDesk has no response it can truthfully file for that yet. A response is sent through Shopify from the order's own data." With `returns = returned`: "DisputeDesk filed nothing for this response. Shopify records the return on order {order} as received and no refund." and nothing about a later response. No regenerate ask, no upload ask. Chosen from three inputs, all read in the cron at both call sites (`route.ts:478, 659`): the exit of the latest package for the dispute and cycle (`outcome_detail` is not selected today, `loadFileableSelection.ts:81-99`), the situation from the pack the cron already loads (`route.ts:296-303`), and the reason family. In Phase B the exit is still `record_context_only`, which is why the situation and family are needed beside it. The order name comes from `disputes.order_name`.
5b. Copy for steps 4 and 5 in six locales where the surface is localised (the letter tab is; the deadline email is English-only today and stays so); `docs/technical.md` and the dispute-page help article in the same commit.
6. Not as described (D8): `notAsDescribedLedger.ts` withholds `return_route_open` on a known status other than `NO_RETURN` (it already reads `returnStatus` at `:191`); test.
7. Every surface that asks the merchant for something, with its disposition:

   | surface | disposition |
   |---|---|
   | Overview acknowledgement panel (`OverviewTab.tsx:1294`) | reads the table (step 2) |
   | Evidence tab acknowledgement card (`CardholderAcknowledgementCard.tsx:99`) | reads the table (step 2) |
   | New-dispute email (`sendNewDisputeAlert.ts`) | reads the table (step 2) |
   | Overview "Add missing evidence" (`deriveMissingItems`) | changed by step 3 |
   | Evidence tab rows (`useEvidenceSections.ts:1054`) | changed by step 3 |
   | Letter-tab banner | changed by step 4 |
   | Deadline fallback email | changed by B0 and step 5 |
   | `sendEvidenceNeededAlert`, `sendDueReminder`, `sendDefencePackageFailedAlert`, `sendBankClaimNeededAlert` | read in this phase; each gets "reads the table", "cannot fire in this situation, because …" or "changed here", recorded in the PR |
   | List page | reads `lib/disputes/presentation`; unchanged |

Acceptance: the matrix test; `tsc` fails on a constructor without the situation; snapshot tests of both emails for a return-open refund-family dispute and for a fraud dispute with a partial refund (offer still present); on #21037's pack fixture, neither the return row nor `refund_record` is in `missingItems`, there is no acknowledgement offer, and the letter tab shows the step 4 copy; a not-as-described fixture with `IN_PROGRESS` yields no `return_route_open`; the surface table is complete in the PR.

### Phase B1 — a dispute that becomes a chargeback is rebuilt (outline; its own short plan before execution; prerequisite of Phase C; decision 14)

**The defect.** A rebuild needs a new response cycle, which needs all of: a prior response, a move into `needs_response` from another status, and a real deadline (`responseCycle.ts:91-93`). A status or due-date change alone triggers nothing (`disputeEffectsDispatcher.ts:150-157`). So an inquiry that stays `needs_response` and becomes a chargeback gets no build, with or without a letter on file. A response sent through Shopify counts as prior (`responseCycle.ts:33-38`), so some no-letter inquiries do rebuild. Every family, not only returns.

**Why it is not a one-line effect.** Running the pipeline on escalation builds nothing: `runAutomationPipeline` returns `existing_pack` for any pack that is not failed or archived (`pipeline.ts:470-480`) and `skipped_responded_via_shopify` at `:409-414`, and every escalating inquiry already has a pack. The reopen path builds only because `reconcileResponseCycle` retires the old artifacts first (`applyDisputeSnapshot.ts:613-634`).

**Design choice for that plan** (recommended first): treat inquiry → chargeback as a response-cycle trigger inside `opensNewResponseCycle`, so the one tested retire-and-rebuild path is reused; or a separate effect that retires and rebuilds on its own.

**The plan must answer:** whether the rebuilt pack is charged a pack credit; whether the merchant gets the evidence-ready email again; what happens when the inquiry's pack was already saved to Shopify; the `skipped_responded_via_shopify` exit; that one escalation is one build (decided inside the same `applyDisputeSnapshot` call, since the effect ledger's keys differ, `disputeEffectsDispatcher.ts:304-308`), and whether a cycle opening in a later snapshot is an accepted second build; tests with a pre-existing `ready` pack. First step: read the status history of the 66 Klarna inquiries with a response sent, to learn whether Shopify moves a filed Klarna inquiry out of `needs_response`.

### Phase C — a letter for credit not processed with a return in progress

Behind `DEFENCE_CNP_RETURN_BRIEF`, which carries an **allow-list of dispute ids** and is empty in prod until the maintainer says otherwise.

0. **Gate, with its result recorded in §8.1 before step 4 starts:** read Klarna's two pages line by line and correct §4.4 if the summaries were wrong (the minimum-ledger rule and the `checkDraft` presence rule rest on them). Also before step 4: confirm the deadline-rebuild cron re-reads `returnStatus` (pre-mortem 4); confirm on a Klarna inquiry in Shopify Admin that the merchant can add a reason and files there, or drop that sentence from the "received, but not accepted" copy. Add `return_received` to `SkipExit` and `SKIP_REASON` (§4.4).
1. Migration, expand then contract (the live writer upserts on `dispute_id,response_cycle`, `return-request-confirmation/route.ts:117-128`, and the loader does `.maybeSingle()` on dispute and cycle; a one-step change breaks both between the migration and the release):
   - **Expand:** add `question text not null default 'return_requested'`, `return_status_at_answer text`, the new answer values to the check, and `unique (dispute_id, response_cycle, question)`; keep the old unique. Dev then prod.
   - **Code release:** the loader filters on `question`; the writer uses the new conflict target.
   - **Contract:** a second migration drops the old unique, applied only after the release is live. No `return_received` row can be written before it; the control is gated on it.
2. Route and control (§4.4), same window guard as the parcel-outcome route. The question is shown on `in_progress` only, with Klarna's three answers; the answer values in the check constraint are `received`, `received_not_accepted`, `not_received`.
3. Registration, **with the collector's emission behind the allow-list** (for an unlisted dispute no section, no fact and no `order_situation` stamp are written, so its facts and its `record_context_only` exit do not move; `factClassifier.ts:566, 600-603`). The category is **not** added to `credit_not_processed.allowedFactCategories`: that list is an input of `plan_input_hash` (`planForCase.ts:135-137`, `planInputHash.ts:44`), so adding it would rotate the hash of every credit-not-processed package at release and make each one stale and non-fileable (`selectFileablePackage.ts:189-192`). It is admitted per case through `lib/defence/alwaysAdmissible.ts:125-141`, which returns only categories actually triggered. The places: a collector emitting a pack section with `fieldsProvided` (through `ctx.returnScope`, `orderSource.ts:271-274`), which also calls the resolver and stamps `order_situation` on the pack so build-time and read-time agree; a definition in `lib/evidence/model/definitions`; a category in `lib/defence/types.ts` mapped in `factClassifier.ts:265`; its admission through `alwaysAdmissible.ts` (above), without which `deriveArgumentPlan.ts:111` excludes it; and kept out of `RECORD_CONTEXT_FIELDS` (`factClassifier.ts:566`).
4. Counsel: the policy extraction of §4.4; a credit-not-processed brief and ledger builder; the `briefForModule` mapping; the four claims with their guards and the minimum-ledger rule.
5. Answer lifetime as in §4.4, read by a **separate loader** for this question (all cycles, newest `answered_at` first, one row); the existing `.maybeSingle()` on dispute and cycle (`returnRequestConfirmation.ts:99-103`) stays for `return_requested`.
5a. Six-locale copy for the question, its three answers and the merchant-only texts, including the letter-tab body after a merchant "received" (the §4.4 copy); `docs/technical.md` and the help article in the same commit.
6. Replay from the six stored inputs; LLM cost per package (including the extraction call) recorded before the `master` PR.
7. After release: `defence_prompt_modules` reconcile with `--apply` on prod (in the `master` PR's checklist).

**Canary, three stages.**
1. Replay of the six stored inputs, once unanswered and once with "not received"; the maintainer reads the letters.
2. One live dispute on the allow-list, built with `DEFENCE_CNP_RETURN_BRIEF_HOLD=1`, which keeps an allow-listed dispute's package a draft whatever the shop's mode; the maintainer reads the built letter and PDF; only then is the hold removed for that dispute.
3. The allow-list is widened, then removed.

Acceptance: with the allow-list empty, and for any dispute not on it, builds, `plan_input_hash` and outcome records are byte-identical to today (the collector's emission, the new exit and the claims are all behind the allow-list); a test that an unlisted credit-not-processed dispute with a return in progress still exits `record_context_only` with the same fact counts and an equal `plan_input_hash`. Before the allow-list is removed (stage 3), the number of open packages whose hash will then rotate is counted and reported. For a listed dispute in dev, in either phase: **not received** → a letter with `return_authorised` and `returned_goods_not_received` (and the policy claim when verified) and no `return_not_recorded_received`, passing the checks, with the reviewer stubbed in the test and live in the replay; unanswered → the same with `return_not_recorded_received` in place of the merchant's sentence; **received** → no letter, exit `return_received`, and the phase's merchant-only copy (test that the inquiry sentence never renders for a chargeback); **received, but not accepted** → no letter, exit `return_received`, and its one merchant-only text; a 10-day-old "received", and a build in response cycle 2 after a "received" in cycle 1 → no letter in both; "received" in cycle 1 then "not received" in cycle 2 → a letter with the merchant's sentence; `returns = returned` → no question, no return claim, no letter, exit `return_received`; a 10-day-old "not received" is not used and the build falls back to the record sentence; with the hold on, nothing is filed on an auto-mode shop. A test that no letter from this brief carries both status claims, and none carries neither.

### Phase D — collect the return shipment (outline; its own plan before execution)

Decided: request `read_returns` (§8.1). The plan must answer: the scope lockstep (`shopify.app.prod.toml:54`, `shopify.app.dev.toml:36`, `.env.example:39`, `lib/shopify/scopes.ts:33`, both Vercel projects' `SHOPIFY_SCOPES`, `scripts/internal/populate-dev-vercel-env.mjs:28`, the drift-guard test, the CLAUDE.md and `docs/technical.md` scope lists); what merchants see (any scope in `SHOPIFY_SCOPES` raises the non-dismissible `ScopeReauthBanner` for every shop, so "optional per shop" is not available without an on-demand optional scope, to be verified against the pinned CLI and token-exchange installs); `order.returns` as a **separate query gated on the shop's granted scopes** (in the main order query an `ACCESS_DENIED` can null the order); the dev app has no dispute scopes, so end-to-end testing needs a store that does; and the contradiction rule when the carrier shows the return delivered but the merchant answered "not received" (the sentence is withheld; `contradictionGate.ts` is the precedent). "Delivered to the merchant" is never bank-facing.

## 6. Pre-mortem

1. **The note leaks into a bank document.** Mitigation: the narrowed structural test (§4.1); the bank-facing claims are separate, code-owned sentences.
2. **The merchant reads the note as advice to refund a chargeback.** Mitigation: the note states the record only; refund mechanics appear only after a "received" answer or a recorded receipt, in phase-specific copy with a test that the inquiry sentence never renders for a chargeback.
3. **The merchant's "not received" is wrong or goes stale.** Mitigation: the sentence is attributed and dated; the 7-day and same-status rule; Phase D's carrier record overrides it.
4. **Shopify already records receipt and we argue as if it did not.** Mitigation: `returned` has its own row: no question, no claim, no letter; a matrix test that `returned` never yields a return claim. Before Phase C ships, confirm the deadline-rebuild cron re-reads `returnStatus` so a flip to `returned` before filing is seen.
5. **The pack's status is stale.** Mitigation: the note says when the order was last collected; the deadline-rebuild cron rebuilds before filing.
6. **Asks are removed and nothing replaces them.** Mitigation: Phase B's copy (step 4) says nothing has been filed and what happens at the deadline; the email fix ships in the same release; §5.0 names the disputes in the gap.
7. **The migration lands ahead of the code and breaks the existing return question.** Mitigation: expand, release, contract (Phase C step 1).
8. **Turning the flag on files for every return-open dispute at once.** Mitigation: the allow-list and the hold (three-stage canary); a count of "filed without a merchant answer" in the failure-classes SQL.
9. **A scope change breaks order collection for shops that have not re-consented.** Mitigation: Phase D's separate, scope-gated query; its own plan.
10. **The store never closes returns in Shopify, the goods are in its warehouse, and an auto-mode shop files "the store's records do not show the returned goods as received" with no one having looked.** The sentence is true of the record and wrong about the world; the merchant defends money it owes. What exists against it: the merchant note and the optional question are on the dispute page from the day the dispute opens; "received" stops the letter; the first live cases are held and read (canary); Phase D's carrier record withholds the sentence when the return shows delivered. What does not exist: any wait between the build and the filing on an auto-mode shop. That residual risk was accepted with decision 9 and is restated in decision 11.
11. **An inquiry escalates and no build runs.** Found in review, every family: see Phase B1 for the exact condition. Mitigation: Phase B1 ships before Phase C.
12. **The letter is filed during a Klarna inquiry and is not read, or is read and counts as the one round.** Stripe's guide says Klarna accepts no evidence during an inquiry; if so the filing is unread and harmless. It does not by itself guarantee a rebuild on escalation (Phase B1 does). If it were read as the single round, a wrong record sentence could not be corrected later. Not measurable from our data (§8.1). Decision 11.

## 7. Test plan

- **Unit:** resolver matrix (built); consequences matrix over every `ReasonFamily` × situation × phase; claim conditions (`requested` and `returned` license nothing; `return_authorised` never alone; exactly one status claim; the record claim only without a usable answer); the three answers; staleness; phase-specific copy.
- **Integration:** workspace payload for return-open, refunded, no-return, pre-2026-10-02 and building packs; completeness on the code templates and the Klarna inquiry DB template; both emails, the deadline email chosen from exit, situation and family, including the `returned` variant; the package route's derived token; Phase C answer → fact → letter with stubbed model, for not received / received / received but not accepted / unanswered / stale / `returned`, each in both phases; the `return_received` exit's position ahead of `record_context_only`; the `checkDraft` presence rule; the newest-answer rule across cycles and ages; allow-list empty is byte-identical including `outcome_detail` and `plan_input_hash`; Phase B1's tests with a pre-existing `ready` pack (in its own plan); hold on files nothing; a non-English event text.
- **End to end:** one render check of the dispute page per phase in the embedded app, two shop shapes, desktop and phone widths; the Phase C stage 2 canary.
- **Replay:** the six stored whj8db-1q inputs through `scripts/counsel/replay.mts`, with cost.
- **Observability:** `scripts/sql/defence-failure-classes.sql` gains open disputes by situation and family, and "filed without a merchant answer".
- Before each "done": `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run release:verify`; a critic pass on the diff.

## 8. Decisions

**Decided 2026-10-09:**
1. Request `read_returns`: **yes**.
2. The attributed "has not received" sentence, credit not processed only: **yes**.
3. Inquiry-only copy that a refund in Shopify resolves an inquiry, never for chargebacks: **yes**.
4. (was open 5) No letter after a merchant "yes" or a recorded receipt: **yes**.
5. (was open 6) Phase B before Phase C: **yes**.
6. (was open 7) "The merchant authorised a return" may go to the bank beside the policy sentence, without the "has not received" sentence: **yes**. *Superseded 2026-10-10 by the minimum ledger of §4.4: a status sentence is always beside it; the policy sentence is added when verified.*
7. (was open 8) Ship the deadline email's inquiry/chargeback wording now (Phase B0): **yes** (built 2026-10-09).
8. Release the note (Phase A) to production: **yes** (#1063 merged, `7f15972c`).

**Decided 2026-10-10:**
9. The bank-facing sentence "The store's records do not show the returned goods as received.": **approved**. It is true whenever `returnStatus = IN_PROGRESS` at build time and misleading if the store never closes returns in Shopify (pre-mortem 10).
10. Keep the merchant question, in Klarna's own wording (maintainer asked whether it is needed; §8.1 is the answer): **kept, optional**.

**Proposed, pending the maintainer's word:**

11. **In which phase is the letter filed, and what does an unanswered dispute file?** (This closes the old open item "the merchant has not answered".)

    | option | for | against |
    |---|---|---|
    | (a) File in whichever phase the dispute is in, as every other family does; unanswered files the record sentence. **Recommended.** | Counsel stance and principle 6 unchanged. No phase rule, no payment-method keying, no promise in merchant copy. The rebuild on escalation comes from Phase B1 in every option; a filing during the inquiry is one of three conditions for the existing trigger and not a guarantee (whether Shopify moves a filed Klarna inquiry out of `needs_response` is unverified). | Per Stripe the inquiry filing is probably not read. If it were read as Klarna's single round, a wrong record sentence could not be corrected. On an auto-mode shop it files with no wait (pre-mortem 10). |
    | (b) Build the letter during the inquiry as a held draft; file only at the chargeback. | The merchant sees the sentence and the question weeks early; nothing unread is filed. | A hold on auto-mode shops is new machinery; the escalation still needs a trigger that does not exist (pre-mortem 11); a model call per inquiry. |
    | (c) No letter during a Klarna inquiry (revision 4). | Matches Stripe's description. | Rested on a measurement that cannot show it (§8.1); an exception to the counsel stance; removes the trigger for the chargeback build; needs payment-method keying on four surfaces. Withdrawn. |

12. **Phase C2, a refused return:** build it after Phase C, with the reasons as a code-owned list. Until then "received, but not accepted" files no letter. Recommendation: yes, as its own small plan.
13. **The module label "Visa 13.6 / Mastercard 4860"** is too narrow for Shopify's `CREDIT_NOT_PROCESSED` (returns are Visa 13.7; Mastercard not verified). Recommendation: a separate small fix after the Mastercard guide has been read.
14. **A dispute that becomes a chargeback is not reliably rebuilt** (pre-mortem 11; every family). Recommendation: Phase B1, its own PR, before Phase C.
15. **Wording of the record sentence.** What is checked is Shopify's order record, not the store's warehouse. "The order record does not show the returned goods as received." says exactly that; the approved "The store's records …" says more. Recommendation: the narrower wording.
16. **Inquiry copy after "received".** Decision 3 approved "A refund issued in Shopify resolves an inquiry." That is sourced for Klarna only and the copy renders for card inquiries too. Proposed: "An inquiry can still be refunded in Shopify."

Also fixed by the plan unless changed: the 7-day life of an answer; the question is asked on `in_progress` only.

### 8.1 Rule text check (2026-10-10) and what it changes

Asked by the maintainer: is the "have the returned goods reached you?" question needed at all? Read on 2026-10-10:

| source | what it says | read how |
|---|---|---|
| Klarna, *Merchant evidence gathering* | For a return dispute Klarna itself asks the merchant "Have you received the return?" with three answers: "Yes, will make changes to the order", "Yes, but not accepted (please specify why)", "Return not received". If the customer used the merchant's return label, the merchant is "liable for the return, even if it is lost in transit", and is told to check the label's status and answer in more detail than "Return not received". If a prepaid label was offered and not used, say so. | page fetched, summarised by a reader model; not read line by line |
| Klarna, *Disputes evidence* (v4) | The response must state the return outcome. Listed rejection reasons include "Return status unclear or not stated", "No proof of return instructions or label", "Refund not issued with no valid justification". Recommended evidence: warehouse receipt logs, inspection reports, photos, customer communication. Missed deadline: decided for the customer. | same |
| Stripe, *Klarna disputes* | "Klarna doesn't accept evidence during the inquiry stage." Evidence is submitted only after the inquiry escalates to a chargeback (21 days; then 12 days to respond, one round). The customer gives Klarna proof of return such as the return tracking id, shown to the merchant as issuer evidence. Expected handling of a return inquiry: verify the return is in transit or has arrived, then refund within the inquiry period. | page text read in full |
| Shopify help, *Klarna* | Klarna decides. "Klarna verifies the order's tracking information with the customer." Silent on whether evidence filed during an inquiry is read. | fetched, summarised |
| Visa, *Dispute Management Guidelines for Visa Merchants* (June 2024), pp. 44-46 | **13.6** is narrow: the cardholder holds a credit or voided receipt that was not processed. Its responses do not mention returned goods. Return-based claims are **13.7** (Cancelled Merchandise/Services), whose listed responses include "merchandise was not returned. Provide evidence to support." and proper disclosure of the return policy. | PDF text read directly |
| Mastercard | Official Chargeback Guide **not read**. Secondary sources say 4860 was folded into 4853. | not verified |

Corrections to what this plan and the chat said before:
- "Merchandise not returned" is a Visa **13.7** response, not 13.6. Shopify's `CREDIT_NOT_PROCESSED` covers both; the module's label "Visa 13.6 / Mastercard 4860" (`reasonCodes/credit_not_processed.ts`) is too narrow. Follow-up, not in this plan's phases.
- The six disputes are decided by Klarna, and Klarna's own first question is the one this plan asks. The question stays.

Consequences for Phase C:
1. **The answer set becomes Klarna's three**, not yes / no / not sure: *received, refund follows* (no letter; today's "yes"), *received but not accepted* (new: a defence in Klarna's process; no letter here until Phase C2 argues it), *not received* (today's "no").
2. **A letter that does not state the return status is on Klarna's rejection list.** Revision 3's option of saying nothing about receipt is withdrawn. An unanswered dispute files with a stated status taken from the record: "The store's records do not show the returned goods as received." Approved as decision 9; a narrower wording is proposed as decision 15.
3. **"Not received" alone is weak when the store's own label was used.** Shopify's event "added tracking information to return" suggests it was, on #21037; it is not proof. Klarna expects the label's status. Phase D (return tracking under `read_returns`) is therefore what makes this defence strong, not an optional refinement, and it does not remove the question: "received but not accepted" can only come from the merchant.
4. **P1: does a response filed during a Klarna inquiry reach Klarna, and does it matter?** Stripe says Klarna accepts no evidence then. Shopify's dispute surface accepts a filing. Our data cannot answer it (below).

**P1, measured on production 2026-10-10** (disputes joined to `shopify_orders` with a Klarna payment method; "sent" = Shopify's `evidenceSentOn` is set; `scripts/sql/klarna-inquiry-outcomes.sql`):

| Klarna, credit not processed | response sent | won | lost | open |
|---|---|---|---|---|
| closed as an inquiry | no | 347 | 0 | 24 |
| closed as an inquiry | yes | 66 | 0 | 0 |
| chargeback | no | 1 | 11 | 1 |
| chargeback | yes | 12 | 14 | 0 |

**What the table does not show (found in review).** An inquiry cannot close as lost: it closes for the merchant or becomes a chargeback, and sync then overwrites `phase` on the same row (`applyDisputeSnapshot.ts:336`), so an escalated inquiry is counted in the chargeback rows. "0 lost" among inquiries is true by construction and is not evidence that silence costs nothing. "Sent" is Shopify's `evidenceSentOn`, which does not tell a DisputeDesk filing from Shopify's own. The chargeback rows mix escalated inquiries with direct chargebacks and cannot be separated: `escalated_from_inquiry_at` has been written only since 2026-09-27 and is empty on every Klarna row, and 69 of the 75 Klarna chargebacks were first synced more than 30 days after they opened. The 21 Klarna orders that have both an inquiry row and a chargeback row are the pre-September-2025 legacy flow (the chargeback row is `GENERAL`, lost the same day, and predates the inquiry), not escalations. Queries: `scripts/sql/klarna-inquiry-outcomes.sql`.

**Therefore:** revision 4's rule (no letter during a Klarna inquiry) is withdrawn. Nothing measured supports an exception to the counsel stance, and it left the chargeback with no build trigger (Phase B1). The letter is filed in whichever phase the dispute is in, as for every other family (decision 11).

Kept from this check in revision 5: the question in Klarna's wording with its three answers; a stated return status in every letter; the record sentence; no strengthening of "not received" into "not sent"; Phase C2; the label follow-up.

## 9. ADR

- **Decision:** derive the order's return/refund situation once, state its consequences per family in one table, and make the note, the asks, the checklist, the emails, the merchant question and the letter read them; collect the return shipment later under its own plan. The credit-not-processed letter always states the return status, from the merchant's answer or else from the order record, and is filed in whichever phase the dispute is in.
- **Drivers:** irrelevant asks under a running deadline; six disputes with nothing to file; truthfulness and the counsel stance.
- **Alternatives:** string patches (repeats per surface and family); a shared input without a consequences table (each surface still decides); scope first (slow, nothing for the six); a checklist-layer fix only (one defect of nine); four targeted gates on the existing boolean plus the brief (faster to the six, but leaves the next surface and the next family to repeat it). For the letter's timing: a held draft during the inquiry, or no letter until the chargeback (§8 decision 11).
- **Why chosen:** the app already holds the status; what is missing is one place that says what follows from it.
- **Consequences:** one module and one table read by the workspace route, the held state, the completeness context, the emails, the not-as-described ledger and counsel; a discriminator on an existing table through a two-step migration; a new policy extraction, a no-letter exit and a brief behind an allow-listed flag; Phase B1 (the escalation rebuild) as a prerequisite of the letter; a rebuild of open return-on-record packs; later a new scope.
- **Follow-ups:** §8 decisions 11-16; Phase B1's own plan; Phase C2; cancellations into the same table; the fatal-loss Overview wording; reading Klarna's pages and Mastercard's guide at source.

## 10. Review record

Round 1 (2026-10-09): Architect "sound with changes" (15 edits); Critic "ITERATE" (7 blocking; Phase A approved with four edits).
Round 2: Architect "sound with changes" (4 blocking); Critic "APPROVE WITH EDITS" (8). All are applied in this revision 3: the split guarantee (§4.1); `returned` as its own row with no question, claim or letter; field-keyed checklist resolution that reaches the Klarna inquiry template, with the rebuild; the policy extraction named as new work; the minimum-ledger rule; the expand/contract migration and `return_status_at_answer`; the written copy for the letter tab and the deadline email; the surface table; the allow-listed flag and three-stage canary; `ReasonFamily` named; decisions §8.4 reframed and §8.7, §8.8 added.
Round 3 (2026-10-10, on revision 4): Architect "sound with changes" (5 blocking); Critic "ITERATE" (7 blocking). Both found that the escalation of an unanswered inquiry triggers no build, that the Phase B inquiry copy promised Phase C behaviour, and that the production measurement could not carry "nothing is lost by not filing". Revision 5 withdraws the chargeback-only rule and with it `inquiry_not_filed`, the Klarna keying and the inquiry copy; makes "received, but not accepted" a no-letter case; names where the exactly-one-status rule is enforced and where the new exit sits; restates pre-mortem 10's residual risk without a mechanism it does not have; corrects §8.1; and updates §7, §8 and §9. Not yet applied: reading Klarna's two pages line by line (Phase C step 0).
Round 4 (on revision 5): Architect "sound with changes" (4 blocking); Critic "ITERATE" on Phase C (3 blocking, 1 small on Phase B; Phase B approvable with those edits). Applied in revision 6: a "received" answer is permanent across age and cycles and can never fall back to the record sentence; the collector's emission is behind the allow-list so the byte-identical acceptance holds, with a test and a count before the allow-list is removed; the escalation rebuild is stated by its three real conditions and becomes Phase B1, a prerequisite of Phase C; the deadline email's inputs and the letter tab's token are named; the Phase B branch is limited to a return with no refund on a skipped package; "for this response"; the "received" branch moved to Phase C; Phase C step 0 is a recorded gate; the exit's exact position and missing inputs; `recordSections.ts` and `checks.ts:336`; old vocabulary removed; decision 16.
Round 5 (on revision 6): Architect "sound with changes" (3 blocking, all in B1 and C); Critic **"Phase B: approve with edits"**, "Phases B1 + C: iterate" (3 blocking, one needing a design choice). Applied in revision 7: Phase B step 5 says "for this response", has its predicate and a `returned` variant; the newest answer across cycles governs, with a separate loader; the new category is admitted per case and not through the module's allowed list, so no hash rotates for unlisted disputes; Phase B1 is reduced to an outline with the design choice and the questions its own plan must answer, because running the pipeline on escalation builds nothing while a pack exists; §7 and §9 trued up. Five rounds is the loop's limit: Phase B stands approved; Phase C's round-5 edits and Phase B1's plan are reviewed when each is taken up.

**Done when:** `disputePage.renderedRealCases.test.tsx` > `#17066` (parcel ask on the Overview, action token is the parcel ask, no acknowledgement as primary action) is green without `.fails`; the `situationConsequences` steps (3, 5, 6) have their own plan.
