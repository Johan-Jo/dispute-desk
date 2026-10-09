# The order's situation drives the dispute: returns and refunds

**Status:** pending approval (ralplan draft 1, 2026-10-09), except Phase A (the merchant-only note), which the maintainer approved to build on 2026-10-09.
**Trigger:** whj8db-1q order #21037, dispute `defa8294-38cb-435f-b09c-5c354ea509d5` (Klarna inquiry, credit not processed, 967 SEK, due 2026-10-10 23:00 UTC, auto mode). The maintainer: "everything is wrong here. We are asking to upload evidence that has no relevance … a customer acknowledgement of receipt of a product that's already been returned. This has to be brought up on a higher level."
**Consistent with:** `docs/plans/defence-package-failure-classes.plan.md` (Phase 0a shipped: `outcome_detail`, `failure_signature`, `counsel_replay_json`).
**Code references:** `origin/develop` at `81791d82`.

## 1. What is established (read-only, 2026-10-09)

### 1.1 The case

| date | event (Shopify's own order events, stored in the pack) |
|---|---|
| 10 Aug | ordered, paid with Klarna |
| 12 Aug | shipped, DHL |
| 24 Aug | carrier: collected at pickup point |
| 27 Aug | store created return #21037-R1, added tracking information to it, emailed return instructions |
| 22 Sep | customer opened the inquiry |

`Order.returnStatus = IN_PROGRESS`. Refunded: 0.00. The customer's claim is "I returned it and was not refunded".

Five more fileable disputes on the same shop have the same shape (return created by the store, `IN_PROGRESS`, no refund).

### 1.2 What the app does with it today

| # | behaviour | where |
|---|---|---|
| D1 | The return events are never shown to the merchant. The timeline is filtered by an allow-list built for the bank letter; "created return" matches no category and is dropped. | `lib/defence/chronology.ts` (`CHRONO_ALLOW`, `classifyChronologyEvent`) |
| D2 | The merchant is offered "add the customer's acknowledgement" (of receipt) as the one way to improve the case. The offer is decided from strength and whether an acknowledgement was already supplied; it does not look at the return. | `lib/disputes/heldState.ts:85, 397` (`canOfferCardholderAcknowledgement`), rendered at `OverviewTab.tsx:1294` |
| D3 | The checklist shows "Refund status: missing" and "Return status: missing". Neither has a control: both are filled from Shopify only (a processed refund; `returnStatus === NO_RETURN`). "Missing" here means "a return IS open", which the row does not say. | `lib/automation/completeness.ts` (`CREDIT_NOT_PROCESSED` template); `lib/packs/sources/orderSource.ts:260-290` |
| D4 | The letter tab says "Not enough bank-facing evidence … Upload additional supporting documents". An upload cannot produce a letter for this case (no brief can use it). | `DefencePackageHtmlView.tsx:785` |
| D5 | The build is skipped: `outcome_detail.exit = record_context_only`, facts `{order_record: 1, policy_refund: 1}`. Delivery is on record and is (correctly) not an answer to this claim. Nothing is filed. | `buildDefencePackageJob.ts` gate; recorded since Phase 0a |
| D6 | The return shipment's status is not collected. | no collector |
| D7 | Overview said "Pack prepared — No action required". | fixed 2026-10-09, #1060 / #1061 |

### 1.3 What the app already knows

- `Order.returnStatus` is collected with the scopes we hold and stamped on the pack's order section since 2026-10-02 (`orderSource.ts:201`). For #21037 it is `IN_PROGRESS`.
- `shopifyRecordsReturnOrRefund` / `packShowsReturnOrRefund` (`lib/disputes/returnRequestConfirmation.ts`) already compute "a return or refund is on record". The workspace route uses it for one thing: hiding the "did the customer ask for a return?" question (`workspace/route.ts:1253-1257`).
- The order's full event list is in the pack (`comms` section, `timelineEvents`), including the return events with their dates.

So the knowledge exists; it is consulted in one place and ignored in every other.

### 1.4 What Shopify will and will not give us

Probed live against the store (`scripts/shopify/probe-order-returns.mjs`, read-only):

- `order { returnStatus totalRefundedSet refunds events }`: available.
- `order { returns { … reverseFulfillmentOrders { reverseDeliveries { deliverable { tracking } } } } }`: **`ACCESS_DENIED` — "Access denied for returns field."** The return, its status and its tracking need the `read_returns` scope, which the app does not request. The shop's granted scopes: `read_all_orders, read_customer_events, read_customers, read_fulfillments, read_legal_policies, read_orders, read_products, read_shipping, read_shopify_payments_disputes, write_pixels, write_shopify_payments_dispute_evidences, write_shopify_payments_dispute_file_uploads`.

Collecting the return shipment's tracking therefore means a new scope and a re-consent by every installed shop.

## 2. Root cause

There is no single statement of the order's **situation**. Each surface re-derives its own partial view (the checklist from a per-reason template, the held offer from strength, the timeline from a bank allow-list, the letter gate from approved facts), and only one of them reads the return. A return or refund changes what is true, what is relevant and what the merchant can do, for several dispute types, and nothing carries that change across the surfaces.

## 3. RALPLAN-DR

**Principles**
1. One derivation of the order's return/refund situation, read by every surface. No surface forms its own.
2. Ask the merchant only for something they can do, where the control renders and the answer changes the outcome.
3. The merchant sees the facts that explain the state of their dispute, including facts that are never bank-facing.
4. A return or refund reaches the bank only where it answers the claim made, as a true sentence, and never as an admission the claim did not raise.
5. Nothing is collected or asked that the access we hold cannot support; a new scope is its own decision with its own rollout.

**Decision drivers**
1. The merchant must not be sent to do irrelevant work while the deadline runs.
2. Six fileable disputes on one shop have nothing we can file; the fix has to reach a letter, not only a message.
3. Truthfulness and the counsel stance: defend, with true sentences only; never volunteer a confession.

**Options**

| | A. Patch the strings and hide the acknowledgement offer for this reason | B. A shared order-situation resolver; surfaces read it (chosen) | C. New scope first: collect returns, then redesign |
|---|---|---|---|
| For | fastest | closes D1–D5 for every family; works today with the access we hold; gives the letter a path (merchant confirmation) without waiting for a scope | the decisive fact is collected, not asked |
| Against | the next surface, or the next family, repeats it; "higher level" is exactly what was asked for | several surfaces change; needs a per-family table agreed with the maintainer | every shop must re-consent; weeks before data arrives; the six disputes get nothing meanwhile |
| | rejected | **chosen** | kept as Phase D, after B works without it |

## 4. Design

### 4.1 The situation (one pure function)

`lib/disputes/orderSituation.ts`, pure, no I/O, no English (tokens only):

```
resolveOrderSituation({ returnStatus, totalRefunded, disputedAmount, returnEvents, phase })
  → { returns: "none" | "requested" | "in_progress" | "returned" | "failed" | "unknown",
      refund:  "none" | "partial" | "full",
      returnOpenedAt: string | null,     // from the order's events, when present
      source: "shopify_order" }
```

- `returns` maps `Order.returnStatus`: `NO_RETURN` → none; `RETURN_REQUESTED` → requested; `IN_PROGRESS` → in_progress; `RETURNED`, `INSPECTION_COMPLETE` → returned; `RETURN_FAILED` → failed; absent (packs built before 2026-10-02) → unknown.
- `refund` from `totals.refunded` against the disputed amount (the same comparison the fatal-loss gate makes).
- `returnOpenedAt` from the pack's order events ("created return #…"). Shopify writes event messages in the shop's admin language, so the date is optional; the status is the authority.
- `packShowsReturnOrRefund` becomes a thin reader over this function, so there is one definition.

### 4.2 What each surface does with it

| surface | today | with the situation |
|---|---|---|
| Merchant note (new, **Phase A**) | none | On the Overview and the letter tab, when `returns ≠ none/unknown` or `refund ≠ none`: a merchant-only note stating the record — "A return was created on this order on 27 August 2026. No refund has been issued." Never in the letter, the PDF or anything sent to Shopify. |
| Acknowledgement offer (D2) | offered on any held weak/moderate case | not offered when `returns ∈ {requested, in_progress, returned}` or `refund ≠ none`: a receipt acknowledgement cannot answer a claim about goods sent back |
| Checklist rows (D3) | "Return status: missing", "Refund status: missing" | the rows state the record ("Return open in Shopify", "No refund issued") and are not presented as something to supply |
| Letter-tab message (D4) | "upload additional supporting documents" | the situation's own explanation; no upload ask when no brief can use an upload |
| Merchant question (new, **Phase C**) | none | when `returns ∈ {in_progress, requested}` and `refund = none`: "Has the returned parcel arrived?" — yes / no / not sure. Only the merchant can know this with the access we hold. |
| Letter (**Phase C**) | skipped | credit-not-processed brief: when the merchant answers **no**, one attributed sentence (below); when **yes** or unanswered, no letter and the merchant is told why, in merchant-only copy |
| Return shipment tracking (**Phase D**) | not collected | with `read_returns`: the return's status and tracking, then the carrier's record; replaces the question where it answers it |

### 4.3 Bank-facing rules (principle 4)

| family | may the letter mention the return or refund? |
|---|---|
| credit not processed | Yes: the claim itself is about a return and a refund. Permitted: the return was authorised on its date; the merchant has confirmed the returned goods have not been received (attributed, only on the merchant's **no**); with Phase D, the carrier's record of the return parcel. Never: that goods were received and not refunded. |
| not as described | Only "no return has been recorded" (existing) when `returns = none`. With a return open or completed: no sentence about returns at all; the existing return-route sentence is withheld. |
| not received | Never. A return on a not-received claim is not an argument and is adverse. |
| subscription cancelled, other | Never, until that family has its own brief. |

A processed refund covering the disputed amount remains the fatal-loss gate's case and is unchanged.

### 4.4 The merchant's answer (Phase C)

Same shape as the existing return-request confirmation (`dispute_return_request_confirmations`, one row per dispute and response cycle, merchant-only storage, rebuild queued on answer):

- **no** → fact `returned_goods_not_received`, bank-eligible for credit not processed only, licensing exactly: "The merchant has confirmed that the returned goods have not been received." 
- **yes** → never bank-facing. Merchant-only copy states the record and, for an **inquiry** only, that a refund issued in Shopify resolves an inquiry. For a **chargeback**, no mention of refunding (Shopify blocks it).
- **not sure** → recorded, treated as unanswered.

The control ships only with the brief that uses it: the question is not asked until a **no** produces a letter end to end.

## 5. Phases

Each is one PR to `develop`, then a `master` PR that waits for the in-chat go.

### Phase A — the merchant-only note (approved; build now)

1. `lib/disputes/orderSituation.ts` with `resolveOrderSituation` and its unit tests (every `returnStatus` value, refund none/partial/full, missing status, event date present/absent).
2. `packShowsReturnOrRefund` reads it.
3. Workspace route returns `orderSituation` (status tokens and the date; no free text from Shopify events).
4. Overview and letter tab render the note from tokens; `messages/{en,de,es,fr,pt,sv}.json`.
5. A test that the note's text and tokens appear in no bank-facing output: the composed PDF blocks, `narrative_json`, and the Shopify evidence payload composer.
6. `docs/technical.md`; the embedded help article for the dispute page.

Acceptance: on #21037 the Overview and the letter tab show the note with the date; a dispute with `NO_RETURN` and no refund shows none; the bank-facing test passes; `npm test`, `tsc`, `build` green; checked on a second shop shape (6a8848-dd, a dispute with a refund issued today).

### Phase B — asks follow the situation (D2, D3, D4)

1. `canOfferCardholderAcknowledgement` takes the situation; no offer when a return or refund is on record.
2. Checklist presentation: the two rows read as statements of the record when the situation explains them. The stored checklist and scoring are untouched.
3. Letter-tab message keyed on `outcome_detail.exit` (Phase 0a) and the situation, replacing the upload ask where no control can change the outcome.
4. The fatal-loss skip gets its own Overview wording (the limit left in #1060).

Acceptance: for each ask removed or reworded, a test names the control and shows it either renders and moves the outcome or is not shown. On #21037: no acknowledgement offer, no upload ask.

### Phase C — a letter for credit not processed with a return open (D5)

1. Migration: `dispute_returned_goods_confirmations` (dispute, response cycle, answer, note, answered_at). Applied dev then prod.
2. Route and control ("Has the returned parcel arrived?"), same window guard as the parcel-outcome route.
3. Fact `returned_goods_not_received` in the classifier; bank-eligible for the refund family only; claim guard licensing the one sentence.
4. Credit-not-processed brief and claim builders in counsel (`return_authorised`, `returned_goods_not_received`, the refund policy's return condition), per `docs/plans/defence-letter-structure.plan.md`. This is the first brief of the failure-classes plan's Phase 3.
5. Replay cases from today's six stored inputs; one letter (#21037 or, if it has passed its deadline, the next due) shown to the maintainer before any other is built.

Acceptance: a **no** on one of the six produces a letter that passes the checks and the reviewer; a **yes** produces no letter and merchant-only copy; nothing is filed in the canary without the maintainer reading the letter (the shop is on auto mode, so the canary runs through the replay script first).

### Phase D — collect the return shipment (D6)

1. Decision first (§8.1): add `read_returns` to both TOMLs and `SHOPIFY_SCOPES`; rollout is per shop, on the merchant's next re-consent.
2. Collector: `order.returns` status and reverse-delivery tracking; carrier lookup through the existing carrier adapters (DHL already used for outbound).
3. Facts `return_shipment_status` (in transit / delivered to merchant / no movement). Delivered to the merchant is **never** bank-facing; it becomes merchant-only copy. Not delivered is bank-eligible for credit not processed.
4. Where the collector answers the question, the Phase C question is not asked. Shops without the scope keep the question.

Acceptance: on a shop that has granted the scope, the fact is present with its source; on a shop that has not, the build is unchanged and no error is logged.

## 6. Pre-mortem

1. **The note leaks into a bank document.** A token is reused by the letter or a section composer. Mitigation: the Phase A test over every bank-facing output; the note's tokens live in a merchant-only namespace.
2. **The merchant reads the note as advice to refund a chargeback.** Mitigation: the note states the record only; the refund sentence exists only in Phase C's inquiry-only copy and has a test that it never renders for `phase = chargeback`.
3. **"No, it has not arrived" is wrong and the letter says so.** The merchant clicks no without checking. Mitigation: the sentence is attributed to the merchant; the question shows the return's date and says where to look; Phase D replaces it with the carrier's record where the scope exists.
4. **`returnStatus` is stale.** The pack was built before the store closed the return. Mitigation: the status is re-read on every pack rebuild; the note shows the pack's build date; the deadline-rebuild cron already rebuilds before filing.
5. **The scope request loses installs or stalls.** Mitigation: Phase D is separate, last, and optional per shop; nothing in A–C depends on it.

## 7. Test plan

- **Unit:** `resolveOrderSituation` over the status × refund matrix; acknowledgement offer with and without a return; note tokens; inquiry-only refund copy.
- **Integration:** workspace route payload for a return-open, a refunded and a no-return pack; bank-facing leak test (PDF blocks, `narrative_json`, Shopify payload); Phase C answer → fact → letter with stubbed model; answer **yes** → no bank fact.
- **Replay:** the six stored whj8db-1q inputs through `scripts/counsel/replay.mts` for the Phase C brief.
- **Observability:** `scripts/sql/defence-failure-classes.sql` before and after Phase C (the six move out of `record_context_only`); a count of disputes by situation in the same file.
- Before each "done": `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run release:verify`; a critic pass on the diff; two shop shapes.

## 8. Decisions for the maintainer

**Decided 2026-10-09:** 1 yes (request `read_returns`); 2 yes (the attributed sentence, credit not processed only); 3 yes (inquiry-only refund copy, never for chargebacks).

1. **`read_returns` scope (Phase D).** It is the only way to collect the return and its tracking. Every installed shop must re-consent. Recommendation: yes, but last, and only after A–C work without it.
2. **The merchant's "no, it has not arrived" as a bank-facing sentence** (attributed to the merchant, credit not processed only). Recommendation: yes; it is the same pattern as the existing return-request confirmation.
3. **Inquiry-only copy that a refund in Shopify resolves an inquiry**, shown only after the merchant answers that the goods arrived. It is a statement of what Shopify does, not advice to concede. Recommendation: yes for inquiries, never for chargebacks.

## 9. ADR

- **Decision:** derive the order's return/refund situation once and make the merchant note, the asks, the checklist presentation, the merchant question and the letter read it; collect the return shipment later, behind a scope decision.
- **Drivers:** irrelevant asks under a running deadline; six disputes with nothing to file; truthfulness.
- **Alternatives:** string patches (rejected: repeats per surface and family); scope first (kept as Phase D: slow, and unnecessary for a first letter).
- **Why chosen:** the app already holds the status; the defect is that only one surface reads it.
- **Consequences:** one new module read by the workspace route, the held state, the checklist presentation and counsel; one new merchant control and table; a new brief; later a new scope.
- **Follow-ups:** §8; the same table for cancellations (`cancelledAt`) once returns are done.
