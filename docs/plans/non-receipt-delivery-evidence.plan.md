# Non-receipt disputes — in transit, delivered, and what the letter may claim

**Status:** PLAN ONLY (**v2, 2026-09-23**). Not started. **Contains two time-boxed live
exposures — §0. Read that first.**

> **Rev 2** answers the maintainer's review of rev 1. Five corrections, all accepted,
> all of which made the plan smaller or more precise rather than larger:
> **(1)** pickup *availability* is not collection — rev 1's rollout count wrongly
> included `DeliveredToPickup`; the real figure is **13**, and the distinction is now
> an invariant with its own test (§6.1, §4.2). **(2)** an in-transit status supplies no
> movement timestamp — rev 1's permitted wording assumed event history it had just
> finished proving we lack; §5.2 now has two wordings, one per phase.
> **(3)** the fallback rules contradicted each other — §9.2 blocked auto-filing on an
> unavailable source while tests 18-19 allowed a fallback; §9.8 is the eligibility
> rule that resolves it, and a known-stale package never becomes eligible by a
> rebuild failing. **(4)** approval must pin the **argument**, not only the evidence
> hash (§9.5). **(5)** "no return" needs qualifying in refund disputes too — rev 1's
> test 2 preserved it unconditionally (§4.1d).
> Also added: §2.1, the shared-mechanism boundary with the not-as-described work,
> which stays a **separate plan**. And §0 carries a fresh live re-check, which
> **found a second exposure rev 1 missed**. §0.4 checks every open case's dates against
> the merchant's own published delivery terms, and §8.1 makes that check a procedure for
> every merchant.
**Deliverable:** make a non-receipt response say what the shipping record actually
shows. Three things have to change together: the evidence model must hold an
**in-transit** state instead of collapsing it into "no evidence"; a
carrier-confirmed delivery must be able to carry an INR case without a signature
nobody's carrier ever supplies; and the "no return was initiated" argument must be
structurally unavailable on a claim that the goods never arrived.
**Deployment:** prod = `master`. Every figure below was read from prod
(`aokhplydttxtebvbeuzc`) on **2026-09-22**, and §0 re-verified **2026-09-23 01:27
UTC**, via `npm run db:query:prod`. Code references are against `origin/develop` @
`0d383e16`.
**Evidence SQL:** `scripts/sql/non-receipt-delivery-evidence.sql` (Q1–Q18). Q15 is the
re-check to run before acting on any deadline claim here; Q16 finds every other dispute
in Case B's position.
**Source contract:** the supplied *"DisputeDesk: non-receipt disputes while goods
are in transit"*, revision 2, 22 September 2026. Its section numbers are preserved
in the mapping table at §3 so nothing in it is silently dropped. Where this audit
**contradicts** the contract, the contradiction is stated in §12.4 — never resolved
by guessing.

> **Out of scope, deliberately:**
> - **The merchant-tab projection defect.** `docs/plans/plan-projection-drift.plan.md`
>   owns it, on the same trigger dispute. That plan fixes *what the UI may claim about
>   the letter*; this one fixes *what the letter may claim about the shipment*. They
>   touch different files and must not be merged into one change.
> - **A new carrier integration or inbox integration.** The event source for parcels
>   we cannot read is `docs/plans/tracking-app-delivery-signals.plan.md` (ParcelPanel,
>   phases 2–4 not started). This plan consumes whatever that produces and works
>   correctly with nothing.
> - **The cron selection window.** Already fixed and on `master`
>   (`lib/cron/deadlineWindow.ts`, `docs/plans/deadline-cron-window-gap.plan.md`).
>   Reuse it; do not restate it.
> - **Provider staging semantics.** Settled, not open — see §9.1.

---

## 0. Live exposure — a letter that argues the wrong thing files itself on 3 October

`4576ee51-53ec-4ed2-8c66-65b04bb31d72` · blume-box · order **#360980** · **USD 129**
· Visa **13.1** · deadline **2026-10-03 23:00 UTC**.

The current draft (v2, generated 2026-09-21 11:54 UTC) contains **one** approved
fact — `no_return_initiated` — and its executive summary and conclusion are built
on it. Verbatim from prod (Q6):

> *"The merchant respectfully requests that the issuer consider that no return,
> refund request, or merchandise recovery has been initiated by the cardholder in
> connection with this transaction. **The absence of any return activity is
> inconsistent with a genuine non-receipt claim** and supports the conclusion that
> the dispute warrants further scrutiny."*

On an item-not-received claim that sentence is not weak, it is **self-refuting**: a
cardholder who never received the goods has nothing to return. It also asserts no
refund was requested, while the cardholder's own message — stored, analysed, and
sitting in the same database — asks to *"be reimbursed for having to wait over 2
weeks"* (Q10).

It will be filed. Not by a merchant clicking submit — by us:

| Check | Value | Where |
|---|---|---|
| rule mode | `auto` | `audit_events.rule_applied`, Q9 |
| decision | `hold_for_deadline`, `strength_insufficient` | `audit_events.auto_save_blocked`, Q9 |
| what that means | *"in auto mode it holds for the deadline, and the deadline path **FILES** it"* | `lib/automation/decision/deriveCaseAutomationDecision.ts:270-285` |
| blocked by the selector? | no — `validation_status = ok`, `document_validation_passed = true`, `plan_json.noSafeArgument = null` | Q4, Q5 |
| when | `defence-package-deadline-submit`, **2026-10-03 08:00 UTC** (rolling 24 h window reaches a 23:00 deadline) | `vercel.json`, `lib/cron/deadlineWindow.ts` |
| and then | `submitEvidence: true` — the save *is* the filing | `lib/shopify/composeShopifyMutationPayload.ts:40` |

**Decision needed from the maintainer before 2026-10-03 (see §11, Q-1).** The
options, none of which requires any of the engineering below:

1. **Concede / do not file.** Nothing is lost that the letter would have won.
2. **Suppress the fact and rebuild.** With `no_return_initiated` gone the plan holds
   no primary argument, `noSafeArgument` becomes non-null, and the selector refuses —
   a silent forfeit unless (3) lands first.
3. **Ship P0 (§4.1) and rebuild**, so the letter states the verified shipment history
   instead. This is the outcome the contract asks for and the only one that files
   something true.

### 0.1 Fresh live re-check — 2026-09-23 01:27 UTC

Rev 1's figures were read on 2026-09-22 and the maintainer rightly asked whether the
exposure still stands. Re-queried against prod:

| | Case A `4576ee51` #360980 | Case B `f0036694` #14784 |
|---|---|---|
| status | `needs_response` | `needs_response` |
| `submission_state` | `not_saved` | `not_saved` |
| `submitted_at` / `evidence_saved_to_shopify_at` | null / null | null / null |
| `delivery_status` | still **null** | `CollectedAtPickup` |
| order last re-ingested | 2026-09-22 02:32 UTC | 2026-09-22 02:32 UTC |
| deadline | **2026-10-03 23:00 UTC** | **2026-10-01 23:00 UTC** |
| verdict | **unresolved — the §0 exposure stands** | **a second exposure, below** |

### 0.2 The second exposure rev 1 missed — Case B files first, on 1 October

Rev 1 said Case B was "not in this danger". That was wrong, and the mechanism is the
one place rev 1 did not look.

Case B is `normalized_status = needs_review` under a **review-mode** rule
(`rule_applied` → `{mode: "review"}`, rule `e5819147`, `amount_range.min = 1` — every
cay-collective dispute). `needs_review` is a hard exclusion from the deadline submit
cron. **But `review_state = 'approved'` is an explicit exception** added 2026-07-29
(`app/api/cron/defence-package-deadline-submit/route.ts:144-170`): the merchant
pressing "Submit on the deadline" re-admits the dispute to the cron's selection
(`review_state.eq.approved` in the `.or(...)` filter). Case B carries that flag.

So Case B **will file on 2026-10-01 08:00 UTC**, two days before Case A, and its
approved letter contains (Q6, verbatim):

> *"The merchant notes that no return of the goods has been initiated and the carrier
> has not recorded any return transit event, **which is consistent with the goods
> having been received**."*

That is D2 again — the absence of a return recruited as corroboration of receipt on a
non-receipt claim — this time inside a letter a merchant has already approved. Plus
the raw enum *"recorded a `CollectedAtPickup` status event"* (§6.6) and no mention
anywhere that the inquiry was opened on 13 September, **three days before dispatch**
(§6.4 row 2).

Case B is the better letter of the two and it is still not one we should file as
written. It needs P0(c)'s validator and §6.6's chronology rule, or a manual edit
before 1 October.

### 0.3 What rev 1's option 2 would actually do — now observed, not predicted

Rev 1 guessed that suppressing `no_return_initiated` would leave Case A with no safe
argument. Case B's own **v1** proves it: built 2026-09-13 12:44 UTC, before dispatch,
with no delivery and no no-return fact, it ended as
`defence_package_skipped` / **`failureCode: no_bank_eligible_facts`** (Q9). The system
already behaves honestly there — it declines to write a letter rather than argue from
nothing. Which is exactly why P0(b) must land with P0(a): remove the bad fact without
adding the true one and the outcome is a silent forfeit, observed.

### 0.4 Re-check 2026-09-23 ~09:55 UTC, and each case's dates against the merchant's terms

Q15 re-run **after** the 02:32 UTC re-ingest: nothing moved. Case A's
`delivery_status` is still null, `submission_state = not_saved`; Case B is still
`approved`, `not_saved`, due 1 October. Both §0 exposures stand.

Then the question rev 1 never asked: **what did the merchant promise, and did the
shipment keep it?** Below is every open non-receipt case still awaiting a response,
measured against the shipping policy **in force on the order date**. The sources are
Q17, Q18 and a live `Shop.shopPolicies.updatedAt` check: every stored shipping policy is
still the published version, and each one predates every one of these orders. Days are
business days, Mon–Fri.

| case | merchant's published term | order → dispatch | order → delivery | dispute opened | reading |
|---|---|---|---|---|---|
| **B** cay #14784 | *"typically delivered within 5–7 business days after the order has been placed"* | **23 bd** | **25 bd** (window ended 25 Aug) | 20 bd: **after** the window, **before** dispatch | **Late delivery, against terms that offer a refund for late arrival** (below) |
| **A** blume #360980 | *"Orders will ship within 1-3 business days"*: dispatch only, no delivery window | **17 bd** (max 3) | still in transit | 20 bd | Dispatch 14 bd late; no delivery promise to measure against |
| blume #352543 | same | 0 bd | 2 bd | 56 bd | On time at every step |
| 6a8848-dd #101259 (two dispute rows, one order) | *"innerhalb von 0-3 Tagen verschickt … Lieferzeit 7-15 Werktage"* | 1 bd | 9 bd | 12 bd, after delivery | Inside both windows |
| 6a8848-dd #98250 | same | 5 bd (**over** 0–3 days) | 9 bd | 27 bd | Dispatch late, delivery inside the 7–15 bd window |

**Case B changes verdict.** Both of Cay Collective's policies have been in force since
2026-07-06, and the order was placed 2026-08-16. Read live from Shopify on 2026-09-23,
verbatim:

> **Refund policy**, under *"The seller wasn't able to help me"*: *"If the seller isn't
> able to help you, your next step is to request help from Cay Collective by opening a
> case by email. You'll receive a full refund if your order never arrives, **arrives after
> the estimated delivery window**, arrives damaged, or isn't as described."*
>
> **Shipping policy:** *"Delivery times vary depending on the seller and the product, but
> orders are typically delivered within 5–7 business days after the order has been placed
> and payment has been received."* … *"we are not responsible for delays caused by third
> parties, such as postal services and courier companies."*

What this does and does not say:
- The refund policy never defines "estimated delivery window". The only window
  published anywhere is the shipping policy's *typical* 5–7 business days. **Linking the
  two is our reading, not Cay's wording.**
- The refund is **conditional**. It applies after the seller "isn't able to help", through
  a case opened with Cay Collective. It is not an automatic entitlement on lateness.
  Whether the buyer contacted the seller or opened a case is **not established**.
- The third-party disclaimer does not cover this delay. The carrier took 2 days
  (16 → 18 Sep). The 23 business days before dispatch were on the seller's side.

The order arrived 18 business days after the only published window closed. The
cardholder disputed after that window had closed and before the order was dispatched.
Rev 1 treated Case B as a receipt case with a wording problem. It is a **late-delivery
case**, and the merchant's published terms offer the cardholder a refund for late
arrival. That is an argument against the merchant, not a concession the merchant has
already made. A letter that rests on "the carrier confirms it was collected" argues
against terms an issuer can read. See §11 Q-1b.

**Case A gains one fact and loses none.** Blume promises a dispatch time, not a delivery
date, so the premature-filing argument is unavailable: nothing was promised to arrive by
a given date. The letter must not contradict the 14-business-day late dispatch, and
§6.6's chronology rule already forbids smoothing it over.

This check was done by hand, for five cases. §8.1 turns it into the procedure every
merchant gets.

---

## 1. What was verified, and what it disproves

Two live disputes, deliberately different: one parcel still moving, one delivered.

| | **Case A** — blume-box #360980 | **Case B** — cay-collective #14784 |
|---|---|---|
| dispute | `4576ee51…` | `f0036694…` |
| phase / code | chargeback · `network_reason_code = 13.1` (**stored, not inferred**) | inquiry · `network_reason_code = null` |
| payment | Shopify Payments (`shopify_pay`) | Shopify Payments (**`klarna`**) |
| amount | USD 129 | SEK 649 |
| ordered | 2026-08-22 16:15 UTC | 2026-08-16 12:03 UTC |
| fulfilled | 2026-09-15 19:25 UTC (**24 days after the order**) | 2026-09-16 08:25 UTC |
| dispute filed | 2026-09-19 00:15 UTC | **2026-09-13 12:43 UTC — before dispatch** |
| carrier state held | `delivery_status = null`, `delivered_at_tracking = null` | `CollectedAtPickup`, `2026-09-18 16:23 UTC` |
| shipments | **two** — `GOFO` `YT2640221437435982` (IN_TRANSIT) and `USPS` `260914OET4` (FULFILLED) | one — `PostNord SE` `00573132901924649740` |
| `carrier_normalized` | `null` on both | `null` |
| `last_carrier_lookup_at` | `null` on both | `null` |
| approved facts in the letter | **1** — `no_return_initiated` | **3** — `delivery_proof`, `shipping_tracking`, `no_return_initiated` |
| completeness | **100 / ready / no blockers** | 85 / ready / no blockers |
| case strength | weak | weak |
| deadline | 2026-10-03 23:00 UTC | 2026-10-01 23:00 UTC |

### 1.1 Three claims in the source material that the data does not support

Stated here so the plan is not built on them.

1. **"We are not rebuilding although it has been delivered."** The letter quoted in
   the report ("Evidence Basis: No return initiated") is **Case A**, where nothing
   has been delivered — there is no delivery event to have missed. **Case B**, the
   delivered one, *did* rebuild: package v2 was generated 2026-09-21 21:34 UTC and
   **does** carry `delivery_proof` + `shipping_tracking`, and its letter leads with
   the PostNord collection (Q4, Q6). The two observations belong to two different
   disputes. The freshness requirement in the contract's §7 is still right as a
   design rule — it is simply **not evidenced by these two cases**, and §9.3 says so.
2. **"ID required at collection" is a new Shopify tag.** It is not. It is our own
   copy: `messages/en.json:1855` → `"factsCollected": "Collected at the pickup point
   {date} — ID required at collection"`, rendered from
   `lib/argument/evidenceLineItem.ts:1500`. Shopify supplied a `CollectedAtPickup`
   status and a timestamp, nothing about identification. `signed_by_name` on this
   shipment is **null**. See D6.
3. **The "customer-message-as-contradiction" mislabel is in the letter.** It is not —
   Case A's `communicationArgument` is `""` (Q6). The mislabel is real but lives one
   layer earlier, in `gorgias_evidence_messages.evidence_category`, where it is
   *offered to the merchant for approval* (Q10). See D7.

---

## 2. The defect classes

Eight, in the order they hurt. Each is a class, not an instance — the fix column
names the single place that closes it.

### D1 · The evidence model has no in-transit state

`DeliveryProofType` has five members and none of them means "the carrier has it and
it is moving" (`lib/argument/canonicalEvidence.ts:437-443`):

```
signature_confirmed | delivered_confirmed | delivered_unverified
| label_created | returned_to_sender
```

`resolveProofType` (`lib/packs/sources/fulfillmentSource.ts:401-448`) computes a
best tier over the shipments and returns `label_created` for **everything that is
not a delivery signal**. `categorizeEvidenceField` then maps `label_created` →
**`invalid`** — "excluded from the system" (`canonicalEvidence.ts:518-520`).

So a parcel with six carrier hub scans across three states scores **identically to a
label printed and never handed over**. The contract's §4 distinguishes *"in transit;
original delivery commitment unknown → shipment context only"* from *"label/fulfilled
only, no carrier acceptance → dispatch unverified"*. Today those are **the same
single value**, and that value contributes nothing.

That is the whole explanation for Case A's one-fact letter. The collector *does*
report the field — `fieldsProvided` gains `shipping_tracking` whenever any tracking
number exists (`fulfillmentSource.ts:578`) — and the argument plan *does* authorise
it (Q5 lists `shipping_tracking` ×2 and `delivery_proof` ×2 among 8 included
records). It is dropped between plan and letter because its category is `invalid`.

**Fix:** a sixth state, `in_transit`, categorised `supporting` — citable, never
scored as delivery. §5.

### D2 · `no_return_initiated` is admitted on every claim type, including this one

`inr_product_not_received.allowedFactCategories` deliberately omits it
(`lib/defence/reasonCodes/inr_product_not_received.ts:41-58`). It reaches the letter
anyway, through `ALWAYS_ADMISSIBLE_RULES`
(`lib/defence/alwaysAdmissible.ts:79-95`), which bypasses the reason module by
design.

That module's own admission test is *"can citing this read AGAINST us under any
claim type?"* — and it was answered for refund disputes, where "the customer never
returned the goods, so no refund was owed" is a real argument. On a non-receipt
claim the same fact is **vacuous at best and adverse at worst**: it invites the
issuer to note that the merchant is reasoning about the return of goods the
cardholder says never arrived. The rule already carries one conditional carve-out
(`hasReturnedToSenderShipment`, added 2026-08-20 for cay-collective #13195), so the
mechanism for narrowing it exists; it is the claim family that has never been
considered.

**Fix:** admission rules become claim-family-aware, with a deny-list, not a per-key
patch. §4.1.

### D3 · Carrier-confirmed delivery cannot lift a non-receipt case above weak

`lib/argument/caseStrength.ts:755-769`, the delivery-family rollup:

```ts
const hasStrongDelivery = strongSignalIds.has("delivery");
if (strongCount >= 2) overall = "strong";
else if (strongCount === 1 && moderateCount >= 1) overall = "moderate";
else if (hasStrongDelivery) overall = "moderate";
else overall = "weak";
```

The comment above it explains the `hasStrongDelivery` rung by saying
`delivered_confirmed` reaches strong via `deliveredToVerifiedAddress`. **That key was
retired on 2026-08-07 by PR-C1**, and `delivered_confirmed` now returns `moderate`,
always (`canonicalEvidence.ts:495-510`). The rollup was never updated. The only
surviving route to a strong `delivery` signal is `signature_confirmed`.

Measured on prod (Q11) — non-receipt disputes filed since 2026-06-01:

| delivery state we hold | disputes | **with a signature** | still open |
|---|---|---|---|
| `Delivered` | 167 | **0** | 12 |
| `null` (in transit / unknown) | 111 | 0 | 5 |
| `CollectedAtPickup` | 4 | **0** | 1 |
| `DeliveredToPickup` | 4 | 0 | 1 |
| `Returned` | 1 | 0 | 0 |
| **total** | **287** | **0** | 19 |

**Zero of 287.** `signature_confirmed` has never fired in this cohort, so the
`hasStrongDelivery` rung is dead code in practice and **every non-receipt case in
the book is rated `weak`** — including all 167 where the carrier says the parcel was
delivered. The consequence is not cosmetic: `weak` is the rung that returns
`hold_for_deadline` (D8), so no non-receipt case ever files early, and every one of
them shows the merchant a "weak case" banner over a carrier delivery confirmation.

This is what the reported Case B observation — *"verified collection should count as
strong evidence"* — is actually detecting. The fix is not to call a pickup
collection `strong`; it is to stop requiring a signature nobody supplies.

**Fix:** the rollup's own rung, plus the stale comment. §6.1.

### D4 · The improvement hint asks for evidence this claim type forbids

`disputes.decisiveHint.delivery` (`messages/en.json:731`) is
*"carrier signature confirmation or matching billing/IP signals"*, injected by
`hintParam(family)` (`caseStrength.ts:117`). On a non-receipt case:

- a **signature** is the thing 0 of 287 shipments have;
- **billing/IP** cannot establish receipt at all, and `ip_location` is on
  `inr_product_not_received.avoid` (`inr_product_not_received.ts:30-34`).

So the merchant is told to chase two signals, one unobtainable and one inadmissible.
Case B's rendered line also reads *"Delivery confirmation **provide** partial
support"* — `weak.moderateOnly` (`messages/en.json:764`) is written for two labels
and is used with one.

Worse, the honest in-transit explanation **already exists** —
`disputes.strengthReason.weak.deliveryInTransit`, *"…the tracking is active, but many
carriers never report delivery back to Shopify…"* — and it is **suppressed on Case
A**, because that branch requires `strong = 0 AND moderate = 0`
(`caseStrength.ts:201-234`) and `no_return_initiated` occupies the moderate slot. The
fact from D2 does not merely pollute the letter; it displaces the one merchant-facing
sentence that would have been true.

**Fix:** family-correct hints; plural-correct template; the in-transit branch keyed
on the shipment state rather than on emptiness. §6.2.

### D5 · Fraud copy on a non-receipt dispute

Case B's high-impact next step renders *"Cardholder acknowledgement is decisive
evidence for **fraud disputes**"* — `messages/en.json:1462`, a hardcoded family in a
string shown on a `PRODUCT_NOT_RECEIVED` inquiry. **Fix:** §6.2.

### D6 · Copy that asserts an identity check we do not hold

Two merchant-facing strings make claims the shipment record does not support:

- `titleCollected` / `titleCollectedOn` — *"**Collected by customer** at pickup
  point"* (`messages/en.json:1852-1853`)
- `factsCollected` — *"— **ID required at collection**"* (`messages/en.json:1855`)

The payload key `collectedByCustomer` was retired by PR-C1 precisely because it was
*"inferred from carrier event message text with no signature or identification
artifact"* — and the retired inference survived in the copy that renders beside it.
PostNord permits collection by BankID and by an authorised representative; a general
carrier policy is not per-shipment proof, and `signed_by_name` is null here.

This one has teeth beyond wording: it is why the reported Case B reading concluded we
hold ID verification. **Fix:** §6.3, and it is the cheapest item in the plan.

### D7 · The cardholder's own complaint is classified as a contradiction

Verbatim from prod, Case A (Q10):

| sender | sent | `evidence_category` | conf. | `review_status` |
|---|---|---|---|---|
| customer | 2026-09-05 16:15 | **`contradiction`** | 72 | `proposed` |

with the analyzer's own explanation stored alongside it:

> *"The customer claims the order has not shipped and not been received, but also
> states they have been waiting over 2 weeks, which contradicts a pure non-receipt
> claim by suggesting the order may have been in fulfillment ra…"*

"Waiting over two weeks" is **consistent** with non-receipt; it is the complaint, not
a contradiction of it. `EVIDENCE_CATEGORIES`
(`lib/integrations/gorgias/relevanceAnalyzer.ts:49-57`) offers `contradiction` on
every dispute reason, and the prompt's only worked example is a fraud one — *"a fraud
claim despite the customer discussing their own purchase"*
(`relevanceAnalyzer.ts:139-140`). There is no per-family restriction and no
deterministic check after the model answers.

It is `proposed`, so it never reached the letter — this time. It is offered to the
merchant for one-click approval into a bank-facing package.

**Fix:** a per-family category allow-list enforced **after** the model returns, not
only in the prompt. §7.

### D8 · Monitoring is triggered by builds and gated on a collapsed status

Three findings, one mechanism.

1. **Carrier lookups happen only during a pack build.** `resolveShipments` has
   exactly one non-test caller: `lib/packs/sources/fulfillmentSource.ts:44`. Nothing
   polls a shipment on a clock.
2. **The one time-based refresher rebuilds only on a status change.**
   `app/api/cron/refresh-open-disputes/route.ts` (02:30 UTC nightly) re-ingests the
   order, then compares `shopify_orders.delivery_status` before and after and
   enqueues `build_pack` **only if it moved** (lines 91-113). Case A was re-ingested
   at **2026-09-22 02:32 UTC** — `null` → `null` — and nothing was enqueued, while
   the parcel had moved through four facilities. The contract's §7.1 filed this as an
   *audit hypothesis*; it is a verified code fact.
3. **There is nowhere to put a new scan.** `shopify_fulfillment_trackings`
   (`supabase/migrations/20260715210000_carrier_tracking_persistence.sql`) stores one
   collapsed `shipment_status` ∈ {Delivered, DeliveredToPickup, Returned} plus
   `terminal_at`. There is **no event table**. "New scan, same state" is not
   representable, so the evidence fingerprint the contract's §7.3 needs has no
   substrate.

And for Case A there is no data path at all: `KNOWN_CARRIERS` identifies `yunexpress`
but not `gofo` (`lib/carriers/registry.ts:29-46`), and `ADAPTERS` holds **only DHL**
(`registry.ts:84`). PR #758 (merged today) taught `trackingLinkUrl.ts` about GOFO —
that is a *link builder*, not an event source. Q14 quantifies the general case.

**Fix:** §9 — and it depends on the ParcelPanel work, so §5 and §6 must not wait for
it.

---

## 2.1 Boundary with the not-as-described work — two plans, shared mechanisms

**Decision (maintainer, 2026-09-23): the two stay separate plans.** What they share is
machinery, not argument. The not-as-described work keeps its own home
(`docs/plans/product-not-as-described-scoring.plan.md`,
`[[project_product_not_as_described_scoring]]`); this plan is the one that hardens the
mechanisms below, and the NAD plan consumes them rather than re-deriving them.

| Shared mechanism | Non-receipt defence (here) | Not-as-described defence (there) |
|---|---|---|
| **Evidence relevance** | delivery or transit history | product specifications, conformity and remedies |
| **Return evidence** | **excluded** as a rebuttal to non-receipt (D2, §4.1a) | used **conditionally**, with source limitations — a return is a *precondition* to filing 13.3 post-Oct-2024, so the fact means something there that it cannot mean here |
| **Evidence provenance** | carrier events and observation dates (§5.2, §9.2) | listing snapshots and capture dates |
| **Canonical argument plan** | determines permitted **shipment** claims (§6.5) | determines permitted **product** claims — same `CaseArgumentPlan`, different claim vocabulary |
| **PDF / UI consistency** | owned by `plan-projection-drift.plan.md` | **reuse that fix**, do not implement a second projection |
| **Material updates** | new delivery events (§5.3, §9.2) | new product evidence or completed remedies |

Two consequences worth stating, because they are where the plans could collide:

1. **§4.1(a)'s `deniedForFamilies` field is the shared surface.** It must be a
   per-family deny-list from the start, not an `item_not_received` special case, or the
   NAD work will need a second mechanism for the same question. §4.1(d) is the first
   proof that the field alone is not enough.
2. **The claim vocabulary in `CaseArgumentPlan` (§6.5) must be extensible, not
   shipment-shaped.** `EvidenceFactCategory` has no conformity vocabulary today
   (`[[project_paypal_defence_plan_review]]` found the same gap from another
   direction). Do not name the new plan fields after shipping.

---

## 3. Contract coverage map

Every section of the supplied revision-2 contract, and where it lands. **"Exists"
means verified in code, not assumed.**

| Contract § | Subject | Verdict | Here |
|---|---|---|---|
| 1 | Outcome required | adopted verbatim as the acceptance standard | §5, §10 |
| 2 | Trigger case + immediate corrections | confirmed in prod, with three corrections | §0, §1.1, §4.1 |
| 3 | Independently sourced facts, source/retrieval timestamps, carrier state vocabulary | **partly exists** — per-shipment rows and lookup timestamps exist; the state vocabulary is missing its in-transit member and all event history | §5, §9.2 |
| 3.1 | Delivery-commitment resolver | **does not exist at all** — confirmed | §8 |
| 4 | Deterministic position selector | **the scaffold exists** — `StrategySubmodule` predicates + registry; three of the nine rows have no representable input | §6.4 |
| 5 | Four-dimension communication classification | one dimension exists (category); order-match, effect and inclusion are partly elsewhere | §7 |
| 6 | One canonical case assessment feeding every surface | **exists** — `CaseArgumentPlan` / `deriveArgumentPlan`. **Extend, do not rebuild** | §6.5 |
| 7.1 | Versioned evolving package | partly — versions exist, evolution does not | §9 |
| 7.2 | Verify the provider contract before deferral | **answered, and it closes a branch** | §9.1 |
| 7.3 | Observe events, documents and time | blocked on an event source | §9.2 |
| 7.4 | Polling/build schedule | proposed defaults kept, re-scoped | §9.3 |
| 7.5 | Cutoffs and recovery budget | largely already shipped | §9.4 |
| 7.6 | State / approval / concurrency axes | partly exists; one live approval-scope hazard | §9.5 |
| 7.7 | Final-day outcome matrix | adopted; two rows need §5 to be expressible | §9.6 |
| 7.8 | Writing contract at the cutoff | adopted; adds two new validator rules | §6.6 |
| 7.9 | Specimen response | kept as the P0 acceptance fixture | §5.4 |
| 7.10 | Additional risks | one is already live on Case A (two tracking legs) | §2 D8, §11 |
| 7.11 | Merchant-facing presentation | deferred to the projection plan + §6 | out of scope |
| 8 | Implementation sequence | reordered — §0 forces P0 first | §4 |
| 9 | Regression tests | adopted and extended | §10 |
| 10 | Sources and limits | kept, with our own limits added | §12 |

---

## 4. Phasing

Ordered by what the 3 October deadline forces, not by architectural tidiness.

### 4.1 P0 — stop the self-refuting argument, and say what is true instead (this week)

Three changes, one PR, no new data sources.

**(a) Claim-family-aware admission.** `ALWAYS_ADMISSIBLE_RULES` gains a
`deniedForFamilies: readonly FamilyKey[]` field; `no_return_initiated` carries
`["item_not_received"]`. `alwaysAdmissibleCategories()` takes the resolved family and
drops denied rules. The existing `hasReturnedToSenderShipment` carve-out is untouched.

Why a field and not an early return: the admission test in that module's header is
per-claim-type in its wording and per-key in its implementation, and this is the
second time that gap has produced a live defect. The field makes the question
answerable for every future member. A vitest case asserts, for each rule × each
family, that the rule's own rationale sentence is family-scoped.

**(b) The in-transit fact becomes citable.** §5. Without it, (a) alone turns Case A
into `noSafeArgument` and a silent forfeit.

**(c) Two new validator rules.** `lib/defence/validateNarrative.ts` must reject, on
the `item_not_received` family:
- any argument from the **absence of a return** (paraphrase-tolerant, per the
  contract's §6: "must detect paraphrases, not just banned exact phrases");
- any assertion that **no refund or reimbursement was requested** when a stored
  customer message requests one.

Rule (c) is the one that must not be skipped even if (a) is judged risky, because it
is the layer that catches the next re-entry of the same reasoning through a different
door. Prod counter for (a)+(c): **Q12 must fall to 0 and stay there.**

**(d) "No return" stays conditional where it IS admitted.** Rev 1's test 2 preserved
the fact unconditionally on `credit_not_processed`, and that is too generous. *No
recorded return does not establish that no refund was owed* — the merchant may have
agreed to refund without requiring one, or a return may be irrelevant to the agreed
remedy. So the fact remains **admitted** on the refund family and what it **licenses**
narrows:

| what the case holds | what may be claimed |
|---|---|
| `no_return_initiated` + return-conditional refund terms applicable to this order | the refund obligation had not arisen — the existing `credit_not_processed_no_return` argument, unchanged |
| `no_return_initiated` alone, no applicable return-conditional terms | **order context only.** State the return status; do not argue from it that no refund was owed |
| `no_return_initiated` + evidence of an agreed refund (message, credit, policy exception) | the fact is **adverse-adjacent** and the "no refund owed" claim is refused outright |

This is the same shape as the returned-to-sender carve-out already in
`ALWAYS_ADMISSIBLE_RULES`, and the same shape as
`docs/plans/returned-parcel-per-payment-method.plan.md`'s central finding — that the
argument turns on whether a **pre-disclosed** policy exists, not on the bare absence of
a return. Implement it as a claim gate on the existing `return_not_initiated` predicate
(`lib/defence/factPredicates.ts:319-331`), whose description today asserts the
"no refund was owed" licence unconditionally and must stop doing so. Do **not** solve
it by removing the fact from the refund family — that is where it earns its place.

**(e) The adverse-policy check (§8.1.4, row 4).** Before composing a receipt rebuttal,
compare the case's dates with the merchant's published delivery window and refund
policy, using the versions in force on the order date. If the parcel arrived after the
window and the merchant's own policy grants a refund for exactly that, no receipt
rebuttal is written. The case parks with a recommendation to concede. Only this row of
§8.1 ships in P0; the full profile and its confirmation flow follow in P3.

Then, for Case A specifically: rebuild, read the letter, and only then decide §11 Q-1.
For Case B, whose deadline is **two days earlier** (§0.2), P0(c) plus §6.6's chronology
rule are what its approved letter needs — or a manual edit before 1 October.

### 4.2 P1 — the strength rollup and the copy around it

§6.1–§6.3. D3, D4, D5, D6. No schema change; one measured regeneration set.

**Blast radius, corrected in rev 2.** Rev 1 said 14 open disputes would re-rate by
including `DeliveredToPickup`. That was wrong: **a parcel awaiting collection is not a
collected parcel**, and it must never qualify as confirmed receipt. The real figure is
**13** — 12 `Delivered` + 1 `CollectedAtPickup`. The one `DeliveredToPickup` case stays
`weak`, correctly.

The code already keeps that line and the fix must not blur it: `confirmedReceipt`
(`lib/packs/sources/fulfillmentSource.ts:247-256`) admits **`Delivered` or
`CollectedAtPickup` with a timestamp** and nothing else, so `DeliveredToPickup` falls to
tier 1 → `delivered_unverified` → `supporting`, below the `hasConfirmedDelivery`
threshold of §6.1. That is an **invariant with a test** (§10 test 8a), not an incidental
property of the current tier list — a future widening of `confirmedReceipt` would
silently promote pending pickups into receipt claims.

A case moving `weak → moderate` changes the automation decision from
`hold_for_deadline` to `auto_file`, i.e. it starts filing **earlier**. That is the
intended behaviour and it is still a behaviour change that needs the maintainer's eyes
(§11 Q-2).

### 4.3 P2 — communications classification

§7. D7. Deterministic post-model guard plus a per-family allow-list. Independent of
P0/P1; can ship in parallel.

### 4.4 P3 — the delivery-commitment resolver

§8. Contract §3.1. Independent, and the **only** phase that unlocks the
premature-filing branch. Explicitly **not** a dependency of P0–P2, because Case A
proves the shipment narrative has to work with no commitment at all.

### 4.5 P4 — evidence monitoring and event history

§9. D8. Depends on `tracking-app-delivery-signals.plan.md` phases 2–4 for a source.
Schema change (an event table). The largest phase and the last.

### 4.6 P5 — remediation of existing drafts

Only after P0–P1 are in prod: re-derive every **unsubmitted** non-receipt draft, flag
changed classifications for review, and regenerate. **Submitted history is never
rewritten**, and there is no bulk resubmission. The contract's §8 step 2 and §9
rollback rule both apply verbatim.

---

## 5. The in-transit state (contract §§1, 3, 4)

### 5.1 The sixth proof state

`DeliveryProofType` gains **`in_transit`**, and `categorizeEvidenceField` maps it to
**`supporting`**.

`supporting` is the precise choice, and it is chosen against the two neighbours:

- not `moderate` — moderate participates in strength, and carrier possession is not
  evidence of receipt. Nothing about an in-transit parcel should move a score.
- not `invalid` — invalid means "excluded from the system", and the whole defect is
  that a documented carrier chain is being excluded.

`supporting` is already defined as citable-but-never-scored (`canonicalEvidence.ts`,
`excludedFromStrength` / `supportingOnly` semantics), which is exactly the contract's
*"shipment context only"* row.

`resolveProofType` gains a tier between `label_created` and `delivered_unverified`:
**any carrier-sourced event that is not a delivery, a return, or a label** ⇒
`in_transit`. The discriminator must be **carrier possession**, not the mere
existence of a tracking number — the contract's §4 keeps *"label/fulfilled only, no
carrier acceptance"* as its own row, and D1 is precisely the collapse of that
distinction.

**What counts as carrier possession, and what today can prove it:**

| source | available now? | verdict |
|---|---|---|
| Shopify `fulfillment.displayStatus = IN_TRANSIT` / `OUT_FOR_DELIVERY` | **yes** — Case A's GOFO row already holds `IN_TRANSIT` | primary input for P0 |
| a carrier adapter event list | DHL only | used when present |
| a tracking-app (ParcelPanel) event list | no — plan P4 | used when it exists |
| merchant upload of a carrier screenshot | yes | `delivered_unverified` path already; unchanged |
| a tracking number alone | yes | **NOT possession** → stays `label_created` |

Case A is therefore expressible today, from Shopify's own per-shipment
`fulfillment_status` — no new integration. That is what makes P0 shippable this week.

### 5.2 What the fact may and may not say — and it differs by phase

**Rev 2 correction.** Rev 1 permitted *"the carrier has recorded movement up to {event
timestamp}"*. That claim requires carrier **events**, and §2 D8(3) had just established
there is no event history and no event table. A status is not a movement, and the
moment DisputeDesk read a status is not the moment a parcel moved. Two wordings,
therefore, one per phase — and P0 gets the narrower one.

**P0 — status only.** The value carries, per shipment: carrier as named (never
normalised away), tracking id, the **source-reported status** (`IN_TRANSIT` /
`OUT_FOR_DELIVERY`), the source id, and the **retrieval timestamp**. There is no
movement date because we hold none.

> Permitted: *the merchant's carrier record shows this shipment in transit with
> {carrier} under tracking {id}; that status was retrieved on {retrieval date}.*
>
> **Refused, explicitly including rev 1's own wording:** "has recorded movement up to
> {date}", any date presented as when the parcel last moved, any progress verb, and
> any implication that the retrieval date is an event date.

**P4 — events, once a source supplies them.** With the event table of §9.2 the last
**event timestamp** becomes a real field and the fuller claim unlocks — *"the latest
carrier event for this shipment is dated {event date}"* — with the contract's §7.8
sentence rule adopted verbatim: *"The latest available event is dated 22 September…"*,
never *"the parcel is progressing today"*. The two dates are then carried separately and
must never be printed as one (the contract's §7.3 distinction between "we fetched", "the
source updated" and "the parcel moved").

Kept deliberately absent in **both** phases, and enforced by the validator: delivery,
receipt, arrival at the cardholder's address, inference of the address from a facility
location, premature filing, any ETA presented as a commitment, and any present-tense
"is moving today".

One consequence to accept rather than engineer around: under P0 the specimen letter of
§5.4 cannot reproduce the contract's §7.9 hub-by-hub chronology, because those seven
GOFO events are not in our database (§12.3). It can state dispatch, the carrier, the
tracking id, the in-transit status and when we read it. That is less than the contract
drafted — and it is all that is true today.

### 5.3 The hash must move when a scan moves

Half of this is already done, and the half that is missing is the half Case A needs.

`computeEvidenceHash` hashes the fact's whole `value`
(`lib/defence/computeEvidenceHash.ts:36-46`), and the delivery fact's value carries
`proofType, carrier, trackingNumber, trackingUrl, deliveredAt, signedByName` **plus
`deliveryStatuses` and `returnedAt`** (`lib/defence/factClassifier.ts:495-518`). That
last pair is `tracking-app-delivery-signals.plan.md` §8.1.1(3), shipped in PR #737 —
so the hash **does** move on a status change today. Do not re-specify it.

Two gaps remain:

1. **`deliveryStatuses` is read from `carrierTracking`**
   (`factClassifier.ts:357-382`), which exists only where a carrier **adapter**
   reconciled the shipment. Case A has no adapter, so its hashed set is empty and the
   shipment contributes nothing to staleness — which is exactly why v1 and v2 share
   `evidence_hash` `9705ff94…` (Q4). Shopify's own per-shipment `fulfillment_status`
   must feed the hashed value for unadapted shipments, or the `in_transit` state will
   be invisible to staleness on the very parcels it exists for.
2. **No per-event field.** A new scan that leaves the status at `in_transit` still
   produces an identical hash. `lastEventAt` plus a `lastEventFingerprint` (source
   event id, else normalised timestamp + type + location) enter the hashed value in
   P4, alongside the event table of §9.2 — they have nothing to read before then.

### 5.4 Acceptance fixture

Two fixtures, matching §5.2's two phases, because a single one would smuggle P4's
wording into P0's acceptance.

**P0 fixture** — inputs are what prod actually holds for Case A: order + dispatch date,
carrier `GOFO`, tracking `YT2640221437435982`, `fulfillment_status = IN_TRANSIT`, a
retrieval timestamp, and the Sep 5–6 thread. The letter must (i) state dispatch and the
in-transit status with the **retrieval** date labelled as such, (ii) state the dispatch
delay without excusing it, (iii) make no receipt claim, (iv) make no no-return claim,
(v) leave the cardholder's reimbursement request uncontradicted, and (vi) **contain no
movement date**.

**P4 fixture** — the contract's §7.9 specimen in full, once an event source exists: the
seven supplied GOFO events in, the latest event stated with its own date, and the
retrieval date carried separately.

Each has a counterpart with the support thread removed — the letter must still be a
dated shipment narrative (contract §9, test 2).

---

## 6. Argument selection, strength and copy

### 6.1 The delivery-family rollup (D3)

```ts
// today
else if (hasStrongDelivery) overall = "moderate";
// proposed
else if (hasConfirmedDelivery) overall = "moderate";
```

where `hasConfirmedDelivery` is a `delivery` signal at **`moderate` or better** —
i.e. `delivered_confirmed` or `signature_confirmed`. A carrier delivery confirmation
tied to this order then carries the case to `moderate` on its own, which is what the
rung was written to do before PR-C1 removed its only trigger. `signature_confirmed`
plus any second signal still reaches `strong`. An `in_transit` fact is `supporting`
and cannot participate — §5.1.

**The stale comment is part of the fix.** It currently tells the next reader that
`delivered_confirmed → strong requires deliveredToVerifiedAddress`, a key that no
longer exists. A comment that describes a retired mechanism is how this survived
seven weeks.

Not proposed, and deliberately: no new `strong` for pickup collection. The contract's
§3 and §7.10 both keep *delivered status*, *destination match*, *signature/photo* and
*customer acknowledgement* as **distinct** facts, and we hold only the first.

**And pickup availability is not collection — this is the invariant, not a side
effect.** `DeliveredToPickup` means the parcel reached a pickup point and is waiting;
nobody has taken it. It must stay below `hasConfirmedDelivery` forever:

| state | `confirmedReceipt`? | proofType | category | reaches moderate? |
|---|---|---|---|---|
| `Delivered` + timestamp | yes | `delivered_confirmed` | moderate | **yes** |
| `CollectedAtPickup` + timestamp | yes | `delivered_confirmed` | moderate | **yes** |
| `DeliveredToPickup` | **no** | `delivered_unverified` | supporting | **no** |
| `Delivered` / `CollectedAtPickup`, no timestamp | no | `delivered_unverified` | supporting | no |
| in transit | n/a | `in_transit` | supporting | no |

`confirmedReceipt` (`fulfillmentSource.ts:247-256`) already draws this line, and the
merchant-facing copy already distinguishes it
(`titleAwaitingCollection` — *"At pickup point — awaiting customer collection"*). §10
test 8a pins it so that widening `confirmedReceipt` for some later reason cannot
silently promote a pending pickup into a receipt claim. Note this is *also* the honest
reading of the reported Case B question: a collected parcel is moderate evidence, an
*available* parcel is not evidence of receipt at all.

### 6.2 Hints and strength copy (D4, D5)

- `disputes.decisiveHint.delivery` is rewritten to name what actually moves a
  non-receipt case: a carrier delivery or collection confirmation, a delivery
  photo/signature where the carrier provides one, or a customer message
  acknowledging receipt. **Billing/IP comes out** — it is on the module's `avoid`
  list, and recommending it is advice to weaken the case.
- `weak.moderateOnly` gets ICU plural handling, or a one-label variant. "Delivery
  confirmation provide partial support" must not be renderable.
- `weak.deliveryInTransit` is re-keyed on **shipment state**, not on
  `strong = 0 && moderate = 0`, so the honest in-transit sentence survives the
  presence of an unrelated moderate fact.
- The cardholder-acknowledgement subtitle's "for fraud disputes" becomes
  family-resolved. One string per family, or one string with a family parameter — not
  a hardcoded family.
- All six locales in the same session (`[[feedback_translate_on_add]]`), Swedish per
  `[[feedback_swedish_translation_quality]]`.

### 6.3 Copy that overclaims identity (D6)

- `titleCollected` / `titleCollectedOn`: *"Collected by customer at pickup point"* →
  a form that states the carrier's record without naming who collected it.
- `factsCollected`: **"— ID required at collection" is deleted.** It is a statement
  about PostNord's general policy masquerading as a fact about this parcel. If a
  per-shipment identification artifact ever arrives from a carrier adapter, it earns
  `signature_confirmed` and says so there.

A vitest case asserts no delivery-line string asserts an actor or an identity check
unless the payload carries `signedByName`. That is the class closed, rather than two
strings edited.

### 6.4 Position selection (contract §4)

The scaffold exists: `StrategySubmodule.predicates` over `FactPredicate`s, resolved
by `lib/defence/strategies/registry.ts`. The contract's nine rows map onto it as:

| contract §4 row | today | after |
|---|---|---|
| delivered before dispute, matching goods | `item_not_received_delivery_proof_stack` | unchanged |
| **delivered after dispute, before submission** | **same strategy — the chronology is invisible** | new predicate `delivery_after_dispute_filing`; §6.6 requires both dates |
| in transit, commitment still ahead | not expressible | needs P3 (§8) |
| filed before the commitment, still undelivered after it | not expressible | needs P3 |
| in transit, commitment expired | not expressible | needs P3 |
| **in transit, commitment unknown** | `item_not_received_narrow_fallback` **with nothing to cite** | new predicate `shipment_in_carrier_possession` → cites the §5 fact |
| label only, no acceptance | same fallback, indistinguishable | distinguished by §5.1 |
| lost / returned / partial | `returned_to_sender` gate exists | unchanged |
| material evidence unavailable | `noSafeArgument` exists | unchanged |

Case B is row 2 and today renders as row 1: its chronology paragraph lists dispatch
and collection and **never states the 13 September filing date** (Q6), so the letter
cannot be read as the subsequent-delivery argument it actually is. Per the contract,
later delivery must never be presented as disproving the original complaint.

### 6.5 One plan, extended (contract §6)

`CaseArgumentPlan` is already *"the ONLY owner of argument disposition, inclusion,
disclosure and issuer-facing claim authority"* (`deriveArgumentPlan.ts:1-29`). It
gains: the selected position, the shipment state with its as-of time, the shipment
state **at dispute filing** (separately — contract §3), and the permitted/prohibited
claim classes. It does **not** gain a second freshness concept: `plan_input_hash`
plus `evidence_hash` already carry that, and `SnapshotFreshness` exists.

Nothing new is built to render it. `plan-projection-drift.plan.md` is making the
surfaces read the plan; this plan only puts the right things in it.

### 6.6 Writing rules at the cutoff (contract §7.8)

Adopted as specified. Two additions become validator rules rather than prompt text,
because prompt-only rules are not enforcement:

1. On the `item_not_received` family, a **no-return** argument is refused (P0c).
2. Where a delivery or collection event **post-dates the dispute filing**, the letter
   must carry both dates or be refused. A rebuilt letter that merely appends
   "delivered" to a stale transit narrative fails this (contract §7.9, final
   paragraph).

Also: `CollectedAtPickup` is an internal enum and Case B's letter prints it to the
bank verbatim — *"recorded a CollectedAtPickup status event"* (Q6). The existing
no-bare-codes rule (`[[feedback_no_bare_gateway_codes_merchant_copy]]`) is extended
to internal status enums in bank-facing prose.

---

## 7. Communications (contract §5, D7)

The contract's four dimensions against what exists:

| dimension | today | change |
|---|---|---|
| order-match confidence | `gorgias_matched_tickets` + match reports | none |
| factual claims | message text, sender, timestamp stored | none |
| relevance **and effect** | one `evidence_category` per message, family-blind | **this is the defect** |
| inclusion approval | `review_status` / `approved_excerpt` / `approved_content_hash` | none |

Three changes:

1. **A per-family category allow-list**, enforced deterministically after the model
   answers, in `enrichGorgiasCommsJob` — not only in the prompt. On
   `item_not_received`, **`contradiction` is not available**: the only customer
   statement that genuinely conflicts with a non-receipt claim is an acknowledgement
   of receipt, and that is already `delivery_recognition`. A model emission outside
   the allow-list is counted in `rejectedCount` — the mechanism already exists for
   bad ids and bad categories.
2. **The prompt's `contradiction` definition gains the non-example** the live failure
   produced: a customer restating or elaborating their own dispute reason — including
   how long they have waited — is **not** a contradiction.
3. **A reimbursement or compensation request is routed to
   `refund_history` with an explicit "requested, scope uncertain" marker**, and — per
   the contract §5 — it **blocks** any assertion that no refund was requested, whether
   or not the message is approved for inclusion. This is the pair to P0(c): the
   analyzer records the request, the validator refuses the contradicting sentence.

Re-running the analyzer on Case A must move that message off `contradiction`. Its
`review_status = proposed` means no approved content changes and no letter is
rewritten by this phase alone.

---

## 8. The delivery-commitment resolver (contract §3.1)

**Audit verdict: it does not exist, and the contract's own conclusion about Case A is
correct.**

- `minDeliveryDateTime`, `maxDeliveryDateTime`, `presentedName`, `brandedPromise`,
  `deliveryMethod`: **zero occurrences** across `lib/`, `app/` and `scripts/`.
  `FulfillmentOrder.deliveryMethod` is never queried.
- What exists is `Fulfillment.estimatedDeliveryAt`
  (`lib/shopify/queries/orders.ts:86`, collected at
  `fulfillmentSource.ts:322`, rendered at `evidenceLineItem.ts:1412-1518`). That is a
  **post-dispatch forecast attached to a fulfillment**, not an order-time promise. It
  is exactly what the contract warns must never be substituted for the original
  commitment — and today it is the only date we have.

So the date-based premature-filing branch **stays disabled**, as the contract says,
and P3 builds the resolver with the contract's acquisition order, its extraction
model, its relative-date rules and its nine-value result vocabulary
(`known_original_window` … `read_failed`) adopted as specified. Three points where
this repo's reality bears on it:

1. **Scope. Rev 2 correction: rev 1 was wrong here, and the question has now been
   answered live.** Rev 1 assumed `read_orders` covered `FulfillmentOrder.deliveryMethod`.
   The live probe (`scripts/shopify/probe-delivery-promise.mjs`, 2026-09-23, 12 orders
   across all three merchants with non-receipt disputes) got **`ACCESS_DENIED` for the
   `fulfillmentOrders` field on every store.** Reading the structured checkout promise
   (`minDeliveryDateTime` / `maxDeliveryDateTime` / `brandedPromise`) needs the
   fulfillment-order read scopes: `read_merchant_managed_fulfillment_orders`, plus
   `read_third_party_fulfillment_orders` for orders routed to a 3PL. That is a **scope
   expansion**. It means a TOML change, a re-consent from every merchant, and a change
   to the App Store listing. Whether these stores populate those fields at all stays an
   open question until the scope is granted on one store. See §11 Q-5.
2. **Provenance is the hard part, not retrieval.** A value fetched today is not
   evidence of what was promised at checkout. The resolver stores first-observation
   and subsequent versions with `observed_at` distinct from `promised_at`, and a
   first observation after the purchase is recorded as exactly that.
3. **Legacy orders stay `not_found` for the structured promise**, and the transit
   workflow continues. There is no backfill from **today's** storefront policy, ever.
   That rule does not rule out the **policy version that was in force on the order
   date**. §8.1 admits that version, but only when its provenance is proven: the live
   `updatedAt` must precede the order.

**Case A's resolver result, from the supplied evidence: `not_found`.** The 6 September
merchant message is a dispatch estimate ("ready to ship the following week"); the GOFO
events are physical history. Neither is an agreed arrival date. The merchant-facing
line is *"Original expected delivery: unknown"*, beside a separate carrier ETA if one
exists.

### 8.1 Delivery-date verification for every merchant

**Why this is its own section.** §0.4 shows that the answer to *"was this parcel late?"*
changes the verdict on a live case (Case B). The resolver above starts from the
structured checkout promise, and that is a source we cannot read today (§8 point 1).
Every merchant needs the same check, built from what we can read now. It must run before
the letter is written, not after.

#### 8.1.1 What we can read today (probed live 2026-09-23, all four installed merchants)

| source | what it proves | readable today? | provenance |
|---|---|---|---|
| `FulfillmentOrder.deliveryMethod.{min,max}DeliveryDateTime` | the promise shown at checkout, per order | **no: `ACCESS_DENIED`** (§8 pt 1) | the strongest source available, once the scope is granted |
| **Published shipping policy**: `Shop.shopPolicies` → `policy_snapshots` | the merchant's standing dispatch and delivery terms | **yes, all 4 merchants** | admissible for an order **only if** the live `updatedAt` ≤ the order date. Otherwise we cannot prove which text the buyer saw |
| **Published refund policy** | the merchant's **remedy for late delivery**, if any | yes | same rule. It can work **against** the merchant (Case B) |
| `ShippingLine.title` | the shipping option the buyer chose | yes | on all 4 merchants it carries **no** window ("Standard", "Postnord 0-3 kg", "Versicherter Expressversand"). A title with a window ("2–4 days") would be admissible; none exist today |
| `Fulfillment.createdAt` / `inTransitAt` | actual dispatch / first carrier scan | yes | physical history |
| `Fulfillment.deliveredAt` + `shipment_status` | actual delivery or collection | yes (matches our `delivered_at_tracking`) | physical history |
| `Fulfillment.estimatedDeliveryAt` | a **post-dispatch forecast** | yes, sometimes | **never** a promise (contract §3.1) |
| messages between merchant and buyer | an ad-hoc promise or delay notice | where a channel is connected | dated message. A dispatch estimate is not an arrival promise (§8, Case A) |

#### 8.1.2 Each merchant's delivery-terms profile

Extracted once per policy version, stored against `policy_snapshots.id`, and re-derived
when the version changes. From prod (Q17):

| merchant | promises **dispatch** | promises **delivery** | firmness of wording | remedy for late delivery in policy |
|---|---|---|---|---|
| cay-collective | none stated | **5–7 business days** from order + payment | *"typically"*: an estimate | full refund for arrival "after the estimated delivery window" (window undefined in that policy), **via a Cay case once the seller can't help** (works against the merchant) |
| blume-box | **1–3 business days** | none | *"will ship"*: a commitment | none (the refund policy is 233 characters) |
| 6a8848-dd | **0–3 days** | **7–15 Werktage**, incl. processing | *"beträgt"*: stated as fact | not yet extracted |
| surasvenne | **1–3 business days** processing | none found | *"usually"*: an estimate | not yet extracted |

A profile has five fields: dispatch window, delivery window, how days are counted
(business or calendar), firmness of wording (`commitment` or `estimate`), and the remedy
for late delivery. Extraction is deterministic first; the regex in Q17 finds every window
above. An LLM pass fills in only how days are counted and how firm the wording is. **The
merchant confirms its output once per policy version.** An unconfirmed profile may
inform the merchant UI, but it may not put a date into the bank letter.

#### 8.1.3 The per-case check

Runs at pack build, and again at the deadline refresh (§9.3). Inputs: the order date,
dispatch, first scan, delivery, the dispute's `initiated_at`, and the profile in force on
the order date. Outputs, stored on the case and shown on the Overview:

| output | values |
|---|---|
| `dispatch_vs_promise` | `on_time` · `late(n bd)` · `no_dispatch_promise` · `unknown` |
| `delivery_vs_promise` | `on_time` · `late(n bd)` · `pending, window open` · `pending, window passed` · `no_delivery_promise` · `unknown` |
| `dispute_timing` | `before_window_end` (premature) · `after_window, before_delivery` · `after_delivery` |
| `policy_remedy_triggered` | `true` when the merchant's published terms offer the cardholder a remedy for what happened, conditional or not (conditions stored alongside) |

#### 8.1.4 How to act on it

| check result | the letter | automation |
|---|---|---|
| delivered on time, dispute after delivery | receipt argument, **with** the on-time dates as a supporting fact | normal |
| dispute opened **before** the delivery window ended | the premature-filing argument becomes available (contract §3.1), **but only** with a confirmed profile whose wording is a `commitment` | normal |
| delivered **late**, and the policy gives no remedy for lateness | receipt argument, **with the lateness stated plainly** (§6.6). Never smoothed over | review, not auto |
| delivered late **and `policy_remedy_triggered`** | **no receipt rebuttal.** The merchant's own published terms grant the claim | **recommend conceding.** Never auto-file; the merchant decides |
| still in transit, window passed | in-transit narrative (§5), with the lateness stated | review |
| no promise of either kind, or profile `unknown` | as today: shipment narrative only, no timing claim either way | unchanged |

The row where the policy grants the remedy would have caught Case B. It is also the only
row that changes what we *recommend*, not just what we write, so it ships first, in P0
(§4.1).

#### 8.1.5 Onboarding and drift

- **At install, and whenever a merchant changes a policy:** re-snapshot the policies (the
  ingest already exists in `lib/policies/ingestShopifyPolicies.ts`), re-extract the
  profile, and ask the merchant to confirm it. A merchant with no shipping policy gets an
  explicit "no delivery promise on record", never a default window.
- **Weekly drift check:** compare the live `shopPolicies.updatedAt` with the newest
  snapshot (`scripts/sql/_stale_policy_fleet.sql` is the starting point). If a policy
  changed and we have no snapshot of the new version, we cannot prove the terms for
  orders placed since, so those orders fall to `unknown`.
- **If Q-5's scope is granted:** the structured checkout promise takes precedence over
  the policy for that order, and the policy is the fallback for orders without one.

#### 8.1.6 Tests

- **21.** Case B's exact dates + cay's profile → `delivery_vs_promise = late(18 bd)`,
  `policy_remedy_triggered = true`, the recommendation is to concede, and there is no
  receipt rebuttal.
- **22.** A policy whose live `updatedAt` is **after** the order date → the profile is
  not admissible for that order → `unknown`, and the letter makes no timing claim.
- **23.** Estimate wording (*"typically"*, *"usually"*) → the premature-filing argument is
  refused; lateness is still reported.
- **24.** `estimatedDeliveryAt` present, no policy window → never treated as the promise.
- **25.** Days counted two ways on one order: 6a8848-dd's *"0-3 Tagen"* (calendar days)
  and *"7-15 Werktage"* (business days) are each computed on their own basis.

---

## 9. Evolving evidence and the deadline (contract §7)

### 9.1 The provider contract is already settled — and it closes a branch

The contract's §7.2 asks which operation saves versus finalises. The answer is in the
code and has been since 2026-05-16: **every save files.**
`composeShopifyMutationPayload` sets `submitEvidence: true` unconditionally
(`lib/shopify/composeShopifyMutationPayload.ts:40`).

Therefore, of the contract's three submission modes, **"only final submission
supported" is the one we are in**. The "editable provider staging" column — stage a
baseline early, replace it as evidence improves — is **not available** without a
deliberate change to that contract, and nothing in this plan proposes one. Everything
about "stage early and replace safely" in §§7.2/7.5/7.6 is therefore out of scope
here, and the rule that remains is the one the deadline cron already implements: keep
the best validated version locally, file once, at the internal cutoff.

Provider **receipt reconciliation** — an ambiguous timeout is not a failed
submission — is `docs/plans/submission-confirmation-gap.plan.md` §§4-5, still open.
Consume it; do not re-specify it.

### 9.2 What monitoring needs before it can exist

1. **An event table.** One row per (shipment, canonical event), carrying source id,
   event timestamp, retrieval timestamp, type, location as given, raw snapshot
   reference, and a correction pointer. Corrections are retained, never overwritten.
   `shopify_fulfillment_trackings` keeps the collapsed current state and gains
   `last_event_at`, `last_successful_observation_at` and `source_observed_at` as
   distinct columns — the contract's §7.3 distinction between "we fetched", "the
   source updated" and "the parcel moved", which a single `last_carrier_lookup_at`
   cannot express.
2. **A source.** ParcelPanel, per `tracking-app-delivery-signals.plan.md` phases 2-4.
   Without it, Case A's GOFO parcel yields nothing beyond Shopify's own
   `fulfillment_status`, and a failure must be an explicit `unavailable` that blocks
   auto-filing **of any claim that depends on it** — that plan's §8 rule, scoped per
   claim by §9.8 rather than per failure.
3. **A trigger that is not a status change.** `refresh-open-disputes`' comparison
   moves from `delivery_status` to the evidence fingerprint of §5.3, so a new scan at
   an unchanged state enqueues a rebuild. Time-only triggers (a commitment expiring, a
   scan ageing past a checkpoint, a deadline moving) are first-class: the contract's
   §7.3 trigger class 2 can change the argument with no source change at all.

### 9.3 Cadence

The contract's §7.4 table is adopted as **tunable engineering defaults**, with one
change of emphasis: the proximity-to-cutoff escalation matters far more than the
absolute intervals, because today there is exactly one nightly pass at 02:30 UTC
regardless of whether a deadline is in nine days or nine hours. Render a new package
only on material change, explicit merchant request, or the mandatory final
checkpoint — never because a timer fired
(`[[project_llm_cap_defence_package_incident]]`, and LLM spend is real).

`last_rebuild_at` / `last_rebuild_outcome` / `last_rebuild_reason` are **null on both
live cases** (Q7) while both packages were demonstrably rebuilt — Case B's at
2026-09-21 21:34 UTC, which is not any cron's hour. So today the system cannot say
which path rebuilt a package or why. **Write those three columns on every rebuild
path** as part of P4; without them no cadence claim in this plan is measurable, and
the reported "we are not rebuilding" suspicion could not be settled from the database
either way.

### 9.4 Cutoffs — mostly already shipped

- The earliest enforceable cutoff, in UTC, with the rolling-window rule: shipped —
  `lib/cron/deadlineWindow.ts` (`deadline-cron-window-gap.plan.md`). Do not restate
  it; import it.
- `SUBMIT_WINDOW_MARGIN_MS` in the submit route is the contract's recovery reserve
  **B** under a different name. Reconcile the two vocabularies rather than adding a
  second reserve.
- The contract's ≥24 h readiness checkpoint does **not** exist and is the real gap
  here. Scope it against the 06:00 rebuild + 08:00 submit pair already in place.
- The "six hours if no margin exists" figure is kept **as a starting configuration,
  explicitly not a safety claim**, exactly as the contract states it.

### 9.5 Approval scope — one live hazard, and the evidence hash is not enough

Case B is `normalized_status = needs_review` **and** `review_state = approved` — the
flag that re-admits it to the deadline cron (§0.2). Its package v2's narrative was
generated 2026-09-21 21:37:20 UTC and the dispute row's `updated_at` is 21:40:57 UTC,
so on this occasion the approval most likely **followed** the rebuild by about three
minutes. "Most likely" is as far as the data goes: `updated_at` is not an approval
timestamp, and there is no `review_approved_at`. The contract's §7.6 rule — *"if
approval covered exact wording, a material rewrite requires renewed approval"* — is
currently unenforceable either way.

**Rev 2 correction: an evidence hash is the wrong anchor on its own.** Wording and
strategy can change materially with the evidence untouched — a different strategy
submodule wins, a prompt version ships, the plan's permitted-claim set narrows, a
validator rule removes a sentence. `evidence_hash` moves for none of those. Approval
must therefore pin **all three** identities:

| pinned | column | what it catches |
|---|---|---|
| the artifact the merchant read | `defence_packages.id` **+ `version`** | a regenerated package, byte-different, same evidence |
| the argument they approved | `plan_input_hash` **+ `plan_policy_version`** | a re-selected strategy, a narrowed claim set, a policy bump |
| the facts underneath | `evidence_hash` | new or corrected evidence |

plus `review_approved_at` and the approving actor. Approval is invalidated when **any**
of the three moves, and the merchant is asked again rather than having their earlier
click carried onto prose they never saw. Where the change is immaterial — a
content-identical rebuild, §9.3 — nothing moves and nothing is asked.

Two notes on scope. The contract's §7.6 also says a merchant who authorised *automatic
refresh and submission* keeps that authority; that standing scope is not what this
narrows — a review-mode approval of a specific letter is. And rev 1 called this "a small
schema change": with three identities plus an actor and a timestamp it is still small,
and it is still the one §9 item worth pulling into P1, because Case B is a live instance
of an approval whose coverage nobody can currently reconstruct.

### 9.6 Final-day matrix

Adopted as written. Two rows need §5 before they can be expressed: *"in transit;
window expired or unknown; recent actual scans"* and *"out for delivery with no
completed-delivery event"*. Until then both collapse into the fallback, which is how
Case A's letter came to argue from a return that never happened.

The contract's framing is adopted verbatim and is the single most important sentence
in its §7.7: **evidence weakness and technical invalidity are different.** A factual
transit response with no reversal basis is a legitimate filing under an existing
contest policy. A fabricated claim is not, and must block the artifact.

### 9.7 The required lifecycle, as stated — and who owns each rule

Reproduced from the reported requirement, unchanged, with the owner named so no rule
is left without one. Rules 1-4 are **not new work in this plan**; rule 5 is.

| # | Required behaviour | Owner |
|---|---|---|
| 1 | A material update — particularly confirmed delivery or collection — marks the existing package **stale** | exists for adapter-reconciled status changes (`deliveryStatuses` in the hash, §5.3); §5.3(1) extends it to unadapted shipments; §9.2(3) makes a new scan at an unchanged status count |
| 2 | The argument plan **and** the PDF are regenerated from the updated evidence | exists — supersession + version+1 on hash mismatch (`computeEvidenceHash` header) |
| 3 | **Immediately before submission**, the selected package is checked against the latest material facts | `tracking-app-delivery-signals.plan.md` §8.1 — specified, **not shipped**. Two invariants: a fresh lookup does not certify an old pack, and artifact agreement is decided by `evidence_hash` |
| 4 | A failed rebuild surfaces an **explicit blocker** instead of silently submitting the old package | partly — `failure_code` / `failure_reason` exist on `defence_packages`; the deadline path's fallback selection is `submission-confirmation-gap.plan.md` §§4-5 |
| 5 | Where delivery happened **after** the dispute opened, the rebuilt letter explains that chronology accurately | **§6.4 row 2 + §6.6 rule 2 — new here.** Case B is the live instance: collected 18 Sep, filed 13 Sep, and the letter states neither relationship |

The one thing to add to rule 3 that the reported version does not say, because it
cannot be seen from the UI: a "prepared" or "scheduled" label cannot establish that
the response is current, **and neither can `last_rebuild_at`, because nothing writes
it** (§9.3). Fix the observability in the same phase as the check, or the check's own
failures will be as invisible as the staleness it looks for.

### 9.8 Fallback eligibility — resolving the contradiction rev 1 shipped

**Rev 2 correction.** Rev 1 said two incompatible things: §9.2(2) that an `unavailable`
carrier read must **block** auto-filing, and tests 18-19 that older verified evidence or
a deterministic fallback **may** be filed after a refresh or build failure. Left as it
was, the generous reading wins in implementation, and a stale package becomes eligible
precisely because the rebuild that would have corrected it failed. That is the worst
possible ordering.

The resolution is that "blocked" and "fallback" were never about the same object.
**A source failure blocks claims that depend on that source. It does not block a letter
that makes no such claim.** So eligibility is decided per **claim**, not per failure:

| situation | eligible to file? | what may be in it |
|---|---|---|
| refresh failed; the selected artifact makes **no** claim depending on the unread source | **yes** | its independently verified facts, each with its own as-of date. No implication that a fresh check succeeded (test 18) |
| refresh failed; the artifact **does** claim what the unread source would have to support (e.g. delivery) | **no** | rebuild, or fall back to a narrower artifact that drops the claim |
| build failed; a prior artifact exists and **agrees** with current known facts by `evidence_hash` | **yes** | that artifact, unchanged |
| build failed; a prior artifact **disagrees** with a known fact (delivery, return, cancellation, correction) | **never** | nothing. A known contradiction blocks the artifact even as a fallback — the contract's §7.6 rule, and rev 1 already stated it at §9.6 |
| build failed; no prior artifact agrees | **no** | the deterministic factual fallback of §9.6, built from the current verified snapshot — not a resurrected old one |
| the source is `unavailable` **and** the case has no verified facts at all | **no** | `no_bank_eligible_facts`, as Case B's v1 already does (§0.3) |

Three rules follow, and they are the acceptance criteria for tests 18-19:

1. **A rebuild failure is never a licence.** Eligibility is judged against current known
   facts, never against "we tried". Failure narrows what may be claimed; it never widens
   it.
2. **Staleness is decided by artifact agreement, not by age.** `evidence_hash` is the
   test (the mechanism `tracking-app-delivery-signals.plan.md` §8.1.1 already owns) —
   which is exactly why §5.3(1) matters: an unadapted shipment contributes nothing to
   that hash today, so "agrees" is currently unfalsifiable for the very parcels this
   plan is about. **§5.3(1) is a prerequisite for §9.8, not a nice-to-have.**
3. **A blocked filing is loud.** An explicit blocker with its reason, surfaced to the
   merchant with time remaining (§9.4's ≥24 h readiness checkpoint) — never a silent
   skip, and never a silent substitution.

---

## 10. Tests

The contract's §9 list is adopted in full. These are the ones that pin **this**
repo's verified failures, and each must be shown to fail before the fix.

**P0**
1. `no_return_initiated` is the only candidate fact on an `item_not_received` case →
   it is not admitted, and the letter does not argue from the absence of a return.
2. Same fact set on `credit_not_processed` → **still admitted**, and (rev 2, §4.1d)
   **three sub-cases**: with applicable return-conditional terms the "no refund was
   owed" claim is licensed; with no such terms the fact is order context and that claim
   is refused; with evidence of an agreed refund the claim is refused outright.
3. Case A's exact fact set → the letter states dispatch, carrier, tracking and the
   in-transit status with a **retrieval** date, and **no movement date** (§5.4, P0
   fixture). Under the P4 fixture, with events present, the latest event date appears
   and the retrieval date is carried separately.
3a. Rev 1's own refused wording — *"has recorded movement up to {date}"* — is rejected
   by the validator on a P0 fact set (§5.2).
4. A stored customer message requesting reimbursement → any "no refund was requested"
   sentence is refused by the validator, whether or not the message is approved.
5. The same order with **no** support thread → still a dated shipment narrative.
6. Label created, no carrier event → `label_created`; carrier `IN_TRANSIT` →
   `in_transit`; delivered → `delivered_confirmed`. **Three distinct claims.**
7. A new scan with the state unchanged → `evidence_hash` moves (§5.3). Prerequisite
   case: an **unadapted** shipment whose Shopify `fulfillment_status` changes → the hash
   moves (§5.3(1)); today it does not.

**P1**
8. `delivered_confirmed` with no signature, no other signal → case is **not** `weak`.
8a. **`DeliveredToPickup` alone → case IS still `weak`** (§6.1). Pickup availability is
   not collection, and this test is the guard against a future widening of
   `confirmedReceipt` promoting a pending pickup into a receipt claim. Its pair:
   `CollectedAtPickup` **with** a timestamp → moderate; `CollectedAtPickup` **without**
   one → supporting, still weak.
9. `in_transit` alone → case **is** weak, and the in-transit explanation renders
   (not `weak.moderateOnly` over an unrelated fact).
10. One moderate label → the strength sentence is grammatical.
11. A `CollectedAtPickup` shipment with `signed_by_name = null` → no string asserts an
    actor or an identity check.
12. An INR case → no hint recommends billing/IP; no copy says "fraud disputes".

**P2**
13. Case A's customer message → not `contradiction`; a reimbursement request is
    recorded as such.
14. A genuine fraud-family contradiction → still classified `contradiction`.

**P3**
15. Structured window absent in the pinned API → fallback works, no guessing, no
    scope expansion.
16. Dispatch estimate, carrier ETA and original arrival window never collapse into
    one date. "Ships next week" does not enable a premature-filing claim.

**P4**
17. Delivery event post-dating the filing → both dates in the letter, no claim the
    original complaint was false. **Case B is the live fixture** (filed 13 Sep,
    dispatched 16 Sep, collected 18 Sep).
18. Carrier read fails near the cutoff → last verified evidence with its as-of date;
    no implication that a fresh check succeeded; no fabricated absence. **Rev 2: per
    §9.8, the artifact is eligible only if it makes no claim depending on the unread
    source** — an artifact asserting delivery behind a failed delivery read is refused.
19. Forced final refresh runs with no status change; a failed final build files the
    verified fallback within the deadline — **and, §9.8, never a prior artifact that
    disagrees with a known fact. A rebuild failure must not make a stale package
    eligible.** Paired negative: prior artifact claims delivery, a correction has since
    reversed it, build fails → nothing is filed; an explicit blocker is raised.
20. A material rebuild after approval → approval is invalidated, not carried (§9.5).
    **Three independent triggers, one test each: package version moves; `plan_input_hash`
    or `plan_policy_version` moves with the evidence untouched; `evidence_hash` moves.**
    Negative: a content-identical rebuild invalidates nothing.

**Release criteria** (contract §9, kept): every factual claim traceable to a source;
no no-return INR rebuttals anywhere in the book (Q12 = 0); no customer complaint
mislabelled as a contradiction by the tested inference; correct output with no
support inbox connected; and **no win-rate promise before submitted outcomes mature**.

---

## 11. Decisions needed

**Q-1 · Case A, before 2026-10-03 (blocking, §0).** Concede, suppress-and-forfeit, or
ship P0 and file a factual shipment response? Recommendation: **ship P0(a)+(b)+(c) and
rebuild**, then read the regenerated letter before deciding whether to file. USD 129
is the stake; the reusable fix is the return.

**Q-1b · Case B, before 2026-10-01 — two days earlier (blocking, §0.2).** Approved, and
`review_state = approved` puts it back in the deadline cron's selection, so it files on
1 October as written: with the no-return-implies-receipt sentence, the raw
`CollectedAtPickup` enum, and no mention that the inquiry preceded dispatch. Options:
P0(c) + §6.6 in time, a manual edit of the approved letter, or withdraw the approval and
re-approve a corrected one. **This is the nearer deadline and rev 1 called it safe.**
**Updated by §0.4:** the order arrived 18 business days after the only delivery window
cay publishes (a *typical* 5–7 business days). Cay's refund policy offers a full refund
for arrival "after the estimated delivery window" through a Cay case, once the seller
can't help. Recommendation: **lean towards conceding and withdrawing the approval**.
First, check the merchant's messages for (a) the buyer contacting the seller or opening a
Cay case, and (b) any agreement to the delay. (a) strengthens the case for conceding.
(b) would support filing, with the lateness stated plainly.

**Q-5 · Fulfillment-order read scopes (§8 pt 1, §8.1.1).** The only structured source of
the checkout delivery promise returns `ACCESS_DENIED` today. Adding
`read_merchant_managed_fulfillment_orders` (plus `read_third_party_fulfillment_orders`)
means every merchant has to re-consent. Request them now, or rely on the published
policies alone (§8.1) until that check shows how often a structured promise would have
changed the outcome?

**Q-2 · P1 changes filing behaviour.** Making `delivered_confirmed` carry a case to
`moderate` moves the **13** open non-receipt disputes that hold a *receipt-grade*
delivery state — 12 `Delivered` + 1 `CollectedAtPickup`, and explicitly **not** the one
`DeliveredToPickup` (§4.2, §6.1) — out of `hold_for_deadline` and into `auto_file`. They
will file **earlier**, not differently. Approve, or gate behind a flag for one cohort
first?

**Q-3 · Case A's two shipment legs.** `GOFO YT2640221437435982` (IN_TRANSIT) and
`USPS 260914OET4` (FULFILLED) sit on one order, and PR #758 established the second is
a shipping-app batch reference, not a parcel id. Does the letter cite one leg or both?
The contract's §7.10 requires the relationship be preserved and verified, never
inherited — so the default here is: cite the leg with carrier possession, name the
other only if the relationship is established.

**Q-4 · P3 sequencing.** The delivery-commitment resolver is the largest source of
*new* winnable arguments (premature filing) and the least urgent. Before or after P4?

---

## 12. Sources and limits

### 12.1 External sources — as cited by the contract, unverified here

The contract's §10 list is carried over unchanged: Visa's *Dispute Management
Guidelines for Visa Merchants* (June 2024, condition 13.1, pp. 37-38); Shopify's
chargeback-process and admin-chargeback help pages; the Admin GraphQL `DeliveryMethod`
object; and the two fulfilment/delivery-date help pages. **This audit did not re-fetch
or re-verify any of them.** Network and region applicability must be validated when
§6.4's network-specific rules are implemented — `[[reference_visa_dispute_management_guidelines]]`
is the preferred source for per-reason-code evidence requirements.

### 12.2 What was verified here, and how

Every figure in §§0-2 comes from `scripts/sql/non-receipt-delivery-evidence.sql`
against prod on 2026-09-22, and every code reference from `origin/develop` @
`0d383e16`. Letter text and the analyzer explanation are quoted verbatim from
`defence_packages.narrative_json` and
`gorgias_evidence_messages.relevance_explanation`.

### 12.3 What is NOT established

- **The GOFO tracking history itself.** The seven events are user-supplied excerpts.
  Our database holds `fulfillment_status = IN_TRANSIT` for that tracking number and
  nothing more — `carrier_normalized` is null and no lookup has ever run. The events
  must be captured with their source before anything cites them.
- **Whether the 111 `delivery_status = null` non-receipt disputes are in transit.**
  Null means "no delivery state held", which also covers never-shipped, dead-gateway
  and failed-read cases (`[[reference_null_payment_method_is_not_one_bug]]` is the
  same shape of trap). Q13 narrows it to fulfilled-with-tracking; that is the real
  P0 population and it has not been counted yet.
- **Which code path rebuilt either package.** §9.3.
- **Whether Case B's merchant approval predates its regeneration.** The timestamps
  suggest approval followed the rebuild by ~3 minutes, but `disputes.updated_at` is not
  an approval timestamp and no audit row records the approval. §9.5.
- **Any of §0's figures after 2026-09-23 01:27 UTC.** That is when they were last
  re-verified (§0.1). The 02:30 UTC nightly re-ingest runs between then and any later
  reading, so re-run Q15 before acting on a deadline claim rather than trusting this
  document's dates.
- **Any win-rate effect.** Nothing here is evidence that a transit narrative wins
  more cases. It is evidence that the current letter argues something indefensible.

### 12.4 Where this audit contradicts the source contract

1. **§7.2's "editable provider staging" branch is not available** — `submitEvidence:
   true` on every save. §9.1.
2. **§7.5's cutoff machinery is largely already built** — `lib/cron/deadlineWindow.ts`
   is on `master`. Import it; the plan should not re-derive a window rule.
3. **§7.1's "the user suspects updates happen only on status changes" is no longer a
   hypothesis** — it is `refresh-open-disputes/route.ts:91-113`, verified against Case
   A's own 2026-09-22 02:32 UTC no-op. §2 D8.
4. **§6's "if an existing case argument plan exists, extend it" resolves to yes** —
   `CaseArgumentPlan` exists and is already the single authority. §6.5.
5. **The contract does not contain D3** — that a carrier-confirmed delivery cannot
   lift a non-receipt case above `weak`, 0 of 287 shipments carrying the signature
   that is the only alternative. It is the largest measured defect in this area and it
   has nothing to do with parcels in transit.
