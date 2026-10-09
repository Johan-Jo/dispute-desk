# The order's situation drives the dispute: returns and refunds

**Status:** ralplan revision 3 (2026-10-09), after two Architect + Critic rounds; consensus reached with edits (§10). Phase A is built (#1062 on `develop`; #1063 to `master` awaits the go). Phases B0, B, C and D are pending approval. Decisions so far and those still open are in §8.
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
| refund | `in_progress`, no refund | **not offered** | not something to supply | **not shown** | "Have the goods the customer sent back reached you?" (Phase C) | credit-not-processed brief (Phase C) |
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
| `returned_goods_not_received` | the merchant answered **no**; the answer is at most 7 days old; `returnStatus` equals `return_status_at_answer` and is `IN_PROGRESS` | "The merchant has confirmed that, as of {answered date}, it has not received any returned goods for this order." |

**Minimum ledger.** `return_authorised` never stands alone. A letter needs `refund_conditional_on_receipt` or `returned_goods_not_received` beside it; otherwise the build exits as today.

**New extraction (not existing work).** `lib/defence/counsel/policyTerms.ts` extracts only a return window and has one caller, gated on the not-as-described path. Phase C adds `refundOnReceipt` and its quoted sentence to the schema, `verifyRefundOnReceipt` (the sentence is in the policy text and carries a receipt or inspection word in the six locales), and a `prepareCreditNotProcessed` call site in `run.ts` that loads the policy snapshot. One extra model call per package, counted in the cost measurement. Whether the claim is allowed on Klarna is checked against decision D9 (`notAsDescribedLedger.ts:41-43`, which withholds the return route there): all six disputes are Klarna.

**The merchant's answer.** A new route (the existing one returns 409 whenever a return is on record, `return-request-confirmation/route.ts:88-96`), storing in the existing `dispute_return_request_confirmations` table with a `question` discriminator. The control is named for what it asks ("Have the goods the customer sent back reached you?", field `customer_return_received`) so it cannot be confused with `returned_parcel_outcome`, which is about an outbound parcel the carrier brought back.

- **no** → `returned_goods_not_received` (bank-eligible for the refund family only).
- **yes** → never bank-facing; no letter. Merchant-only copy:
  - inquiry: "You told us the returned goods have reached you. Shopify shows no refund on the order. A refund issued in Shopify resolves an inquiry."
  - chargeback: "You told us the returned goods have reached you. Shopify shows no refund on the order. A chargeback cannot be refunded in Shopify while it is open; the bank decides it."
- **Shopify records receipt** (`returns = returned`; no question is asked) → no letter. Merchant-only copy: "Shopify records the return as received and no refund on the order." followed by the same phase sentence.
- **not sure** / unanswered → treated as unanswered (§8.4).

Whether a refund resolves a **Klarna** inquiry as it does a card inquiry is verified before that sentence ships; if it does not, the inquiry copy for Klarna drops its last sentence.

## 5. Phases

Each is one PR to `develop`, then a `master` PR that waits for the in-chat go. Each ends with one render check of the dispute page in the embedded app on two shop shapes, at desktop and 393/375/320 px, as an explicit gate.

### 5.0 The six, exactly

All are Klarna inquiries on whj8db-1q (auto mode), credit not processed, return `IN_PROGRESS`, no refund.

| dispute | due (UTC) | Phase A (note) | Phase B (asks) | Phase C (letter) |
|---|---|---|---|---|
| `defa8294` #21037 | 10-10 23:00 | if released before the deadline | no | **no: cannot be built, canaried and approved in time** |
| `02d9de6d` | 10-19 | yes | yes, if released | only if C is in prod and its canary approved before then |
| `c87a84fd` | 10-22 | yes | yes | as above |
| `95e6c556`, `54f6dc2d` | 10-25 | yes | yes | likely |
| `d4b2b40c` | 10-26 | yes | yes | likely |

Phases A and B file nothing. **#21037 will pass its deadline with nothing filed by DisputeDesk; a response is sent through Shopify from the order's own data.** After the deadline the merchant receives the fallback email (D7), which today calls the inquiry "the chargeback dispute" and asks them to regenerate or upload. There is no operator path in this plan: contacting the merchant outside the app, or refunding, is the maintainer's call.

### Phase A — the merchant-only note (built: #1062 on `develop`, #1063 to `master` awaiting the go)

`orderSituation.ts`; the boolean readers delegate (parity test over the status × refund matrix, including an unrecognised status); `dispute.orderSituation` with `asOf` in the workspace payload; `OrderSituationNote` on `OverviewTab` and above the letter card in `ReviewSubmitTab`; copy in six locales; help article; structural tests. Verified: `tsc`, 7,428 tests, i18n parity, build. Not verified: rendered in the embedded app.

### Phase B0 — the deadline email names the proceeding (D7, small, ahead of B; decision §8.8)

`lib/email/sendDefenceDeadlineFallbackAlert.ts:223-253` (call sites `defence-package-deadline-submit/route.ts:478, 658`; `d.phase` is already selected at `:173`): the context gains `phase`, and the copy says "inquiry" or "chargeback" accordingly. Nothing else changes. Snapshot test for both phases, six locales.

### Phase B — the consequences table, and the asks that read it

0. Split the guarantee (§4.1): rewrite the Phase A import test and module header.
1. `situationConsequences` with the §4.2 table and its matrix test over every `ReasonFamily` × situation × phase.
2. `AcknowledgementOfferInput` gains **required** `situation` and `family`. It is constructed in three places, which `tsc` then fails until updated: `workspace/route.ts:1225`, `sendNewDisputeAlert.ts:1073`, `CardholderAcknowledgementCard.tsx:99` (`heldState.ts:396` and `heldState.legacy.ts:68` pass it through). Pack sections and reason are available at all three. Test on the email's text.
3. Checklist, keyed on the **field**: `OrderContext` gains `hasReturnOnRecord`; `resolveItemStatus` (and its v1 twin, `completeness.ts:244`) returns `unavailable` / `collectable: false` for `no_return_initiated` when it is set. Keyed on the field and not on a requirement mode, because the six disputes use the DB template for Klarna inquiries (`buildPack.ts:638`, `klarnaInquiryTemplate.ts:64-72`), where the row's mode is `optional` and a mode-based rule in the code templates never applies. Tests on both branches, including a Klarna-inquiry-template fixture.
   - Effect: the row leaves the score's denominator (weight 0.5, `completeness.ts:866-868`). `submission_readiness` and blockers do not move (the row is neither critical nor blocking); case strength does not move. Before release, count the open packs whose score crosses the shop's auto-save threshold because of it and report the number.
   - Stored checklists do not change by themselves (the read path only appends rows, `workspace/route.ts:530`; `deriveMissingItems` reads the stored status). After release the open packs with a return on record are rebuilt: two first, read, then the rest. A rebuild can send the merchant the evidence-ready email; the count of affected packs and that email are stated to the maintainer before the rebuild.
   - `refund_record` stays as it is and is presented through `refundPresentation.ts` ("No refund issued"); it is excluded from "Add missing evidence" when the consequences say it is not something to supply.
4. Letter tab, `CompleteDefencePackageCard.tsx:1027-1045`: a branch for the refund family with a return on record. The route exposes a derived exit token (it strips `outcome_detail`). Copy (`en`; `{proceeding}` is "inquiry" or "chargeback"):
   - title: "DisputeDesk has no response to file for this {proceeding} yet"
   - body: "Shopify records a return on this order and no refund. DisputeDesk has filed nothing for this dispute. If that has not changed by the deadline, a response is sent through Shopify from the order's own data."
   - after a merchant "yes" or with `returns = returned`: the same title, and the §4.4 copy as the body.
5. Deadline fallback email, for this situation: "DisputeDesk filed nothing for this {proceeding}. Shopify records a return on order {order} and no refund, and DisputeDesk has no response it can truthfully file for that yet. A response is sent through Shopify from the order's own data." No regenerate ask, no upload ask.
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

### Phase C — a letter for credit not processed with a return in progress

Behind `DEFENCE_CNP_RETURN_BRIEF`, which carries an **allow-list of dispute ids** and is empty in prod until the maintainer says otherwise.

1. Migration, expand then contract (the live writer upserts on `dispute_id,response_cycle`, `return-request-confirmation/route.ts:117-128`, and the loader does `.maybeSingle()` on dispute and cycle; a one-step change breaks both between the migration and the release):
   - **Expand:** add `question text not null default 'return_requested'`, `return_status_at_answer text`, the new answer values to the check, and `unique (dispute_id, response_cycle, question)`; keep the old unique. Dev then prod.
   - **Code release:** the loader filters on `question`; the writer uses the new conflict target.
   - **Contract:** a second migration drops the old unique, applied only after the release is live. No `return_received` row can be written before it; the control is gated on it.
2. Route and control (§4.4), same window guard as the parcel-outcome route. The question is shown on `in_progress` only.
3. Registration, all five places: a collector emitting a pack section with `fieldsProvided` (through `ctx.returnScope`, `orderSource.ts:271-274`), which also calls the resolver and stamps `order_situation` on the pack so build-time and read-time agree; a definition in `lib/evidence/model/definitions`; a category in `lib/defence/types.ts` mapped in `factClassifier.ts:265`; the category in `credit_not_processed.allowedFactCategories` (`reasonCodes/credit_not_processed.ts:44-55`), else `deriveArgumentPlan.ts:111` excludes it; and kept out of `RECORD_CONTEXT_FIELDS` (`factClassifier.ts:566`).
4. Counsel: the policy extraction of §4.4; a credit-not-processed brief and ledger builder; the `briefForModule` mapping; the three claims with their guards and the minimum-ledger rule.
5. Staleness: an answer older than 7 days, or given under a different `returnStatus`, is not used and the question is shown again.
6. Replay from the six stored inputs; LLM cost per package (including the extraction call) recorded before the `master` PR.
7. After release: `defence_prompt_modules` reconcile with `--apply` on prod (in the `master` PR's checklist).

**Canary, three stages.**
1. Replay of the stored inputs; the maintainer reads the letters.
2. One live dispute on the allow-list, built with `DEFENCE_CNP_RETURN_BRIEF_HOLD=1`, which keeps an allow-listed dispute's package a draft whatever the shop's mode; the maintainer reads the built letter and PDF; only then is the hold removed for that dispute.
3. The allow-list is widened, then removed.

Acceptance: with the allow-list empty, and for any dispute not on it, builds are byte-identical to today. For a listed dispute in dev: **no** → a letter whose return claims are exactly the three of §4.4, passing the checks, with the reviewer stubbed in the test and live in the replay; unanswered → per §8.4; **yes** → no letter and the phase's copy (test that the inquiry sentence never renders for a chargeback); `returns = returned` → no question, no return claim, no letter; a 10-day-old answer is not used; with the hold on, nothing is filed on an auto-mode shop.

### Phase D — collect the return shipment (outline; its own plan before execution)

Decided: request `read_returns` (§8.1). The plan must answer: the scope lockstep (`shopify.app.prod.toml:54`, `shopify.app.dev.toml:36`, `.env.example:39`, `lib/shopify/scopes.ts:33`, both Vercel projects' `SHOPIFY_SCOPES`, `scripts/internal/populate-dev-vercel-env.mjs:28`, the drift-guard test, the CLAUDE.md and `docs/technical.md` scope lists); what merchants see (any scope in `SHOPIFY_SCOPES` raises the non-dismissible `ScopeReauthBanner` for every shop, so "optional per shop" is not available without an on-demand optional scope, to be verified against the pinned CLI and token-exchange installs); `order.returns` as a **separate query gated on the shop's granted scopes** (in the main order query an `ACCESS_DENIED` can null the order); the dev app has no dispute scopes, so end-to-end testing needs a store that does; and the contradiction rule when the carrier shows the return delivered but the merchant answered "no" (the sentence is withheld; `contradictionGate.ts` is the precedent). "Delivered to the merchant" is never bank-facing.

## 6. Pre-mortem

1. **The note leaks into a bank document.** Mitigation: the narrowed structural test (§4.1); the bank-facing claims are separate, code-owned sentences.
2. **The merchant reads the note as advice to refund a chargeback.** Mitigation: the note states the record only; refund mechanics appear only after a "yes" or a recorded receipt, in phase-specific copy with a test that the inquiry sentence never renders for a chargeback.
3. **The merchant's "no" is wrong or goes stale.** Mitigation: the sentence is attributed and dated; the 7-day and same-status rule; Phase D's carrier record overrides it.
4. **Shopify already records receipt and we argue as if it did not.** Mitigation: `returned` has its own row: no question, no claim, no letter; a matrix test that `returned` never yields a return claim. Before Phase C ships, confirm the deadline-rebuild cron re-reads `returnStatus` so a flip to `returned` before filing is seen.
5. **The pack's status is stale.** Mitigation: the note says when the order was last collected; the deadline-rebuild cron rebuilds before filing.
6. **Asks are removed and nothing replaces them.** Mitigation: Phase B's copy (step 4) says nothing has been filed and what happens at the deadline; the email fix ships in the same release; §5.0 names the disputes in the gap.
7. **The migration lands ahead of the code and breaks the existing return question.** Mitigation: expand, release, contract (Phase C step 1).
8. **Turning the flag on files for every return-open dispute at once.** Mitigation: the allow-list and the hold (three-stage canary); a count of "filed without a merchant answer" in the failure-classes SQL.
9. **A scope change breaks order collection for shops that have not re-consented.** Mitigation: Phase D's separate, scope-gated query; its own plan.

## 7. Test plan

- **Unit:** resolver matrix (built); consequences matrix over every `ReasonFamily` × situation × phase; claim conditions (`requested` and `returned` license nothing; `return_authorised` never alone); staleness; phase-specific copy.
- **Integration:** workspace payload for return-open, refunded, no-return, pre-2026-10-02 and building packs; completeness on the code templates and the Klarna inquiry DB template; both emails; Phase C answer → fact → letter with stubbed model, for no / yes / unanswered / stale / `returned`; allow-list empty is byte-identical; hold on files nothing; a non-English event text.
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
6. (was open 7) "The merchant authorised a return" may go to the bank beside the policy sentence, without the "has not received" sentence: **yes**.
7. (was open 8) Ship the deadline email's inquiry/chargeback wording now (Phase B0): **yes** (built 2026-10-09).
8. Release the note (Phase A) to production: **yes** (#1063 merged, `7f15972c`).

Still open: decision 4 below (what is filed when the merchant has not answered).

**Open:**
4. **The merchant has not answered.** What is filed?
   - (a) A letter from "the merchant authorised a return" and "the policy refunds once returned goods are received", saying nothing about receipt. On an auto-mode shop it files with no merchant input. It confirms the customer's return and relies on the bank inferring the goods have not arrived.
   - (b) No letter until the merchant answers.
   - (c) Ask until 48 hours before the deadline, then file (a).
   Recommendation: (c). Silence should not withhold a truthful filing, and the merchant gets the chance to make it stronger or stop it first.
5. **After "yes", or when Shopify records receipt: no letter.** A deliberate exception to "always defend": every remaining true sentence argues for the refund. Recommendation: accept, for this situation only.
6. **Phase B before Phase C?** It removes the irrelevant asks about ten days before a letter is possible, with the copy written in Phase B step 4. Recommendation: yes.
7. **May "the merchant authorised a return" go to the bank without the "has not received" sentence?** It is implied by 4(a) and 4(c) and was not part of decision 2. The plan requires the policy sentence beside it and never lets it stand alone. Recommendation: yes, under that rule.
8. **Ship the deadline email's inquiry/chargeback wording now (Phase B0)**, ahead of the rest, so #21037's fallback email at least names the proceeding correctly. Recommendation: yes.

Also fixed by the plan unless changed: the 7-day life of an answer; the question is asked on `in_progress` only.

## 9. ADR

- **Decision:** derive the order's return/refund situation once, state its consequences per family in one table, and make the note, the asks, the checklist, the emails, the merchant question and the letter read them; collect the return shipment later under its own plan.
- **Drivers:** irrelevant asks under a running deadline; six disputes with nothing to file; truthfulness and the counsel stance.
- **Alternatives:** string patches (repeats per surface and family); a shared input without a consequences table (each surface still decides); scope first (slow, nothing for the six); a checklist-layer fix only (one defect of nine); four targeted gates on the existing boolean plus the brief (faster to the five, but leaves the next surface and the next family to repeat it).
- **Why chosen:** the app already holds the status; what is missing is one place that says what follows from it.
- **Consequences:** one module and one table read by the workspace route, the held state, the completeness context, the emails, the not-as-described ledger and counsel; a discriminator on an existing table through a two-step migration; a new policy extraction and brief behind an allow-listed flag; a rebuild of open return-on-record packs; later a new scope.
- **Follow-ups:** §8.4–8.8; cancellations into the same table; the fatal-loss Overview wording.

## 10. Review record

Round 1 (2026-10-09): Architect "sound with changes" (15 edits); Critic "ITERATE" (7 blocking; Phase A approved with four edits).
Round 2: Architect "sound with changes" (4 blocking); Critic "APPROVE WITH EDITS" (8). All are applied in this revision 3: the split guarantee (§4.1); `returned` as its own row with no question, claim or letter; field-keyed checklist resolution that reaches the Klarna inquiry template, with the rebuild; the policy extraction named as new work; the minimum-ledger rule; the expand/contract migration and `return_status_at_answer`; the written copy for the letter tab and the deadline email; the surface table; the allow-listed flag and three-stage canary; `ReasonFamily` named; decisions §8.4 reframed and §8.7, §8.8 added. This revision has not itself been re-reviewed.
