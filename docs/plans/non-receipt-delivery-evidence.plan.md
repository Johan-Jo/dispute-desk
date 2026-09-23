# Non-receipt disputes — in transit, delivered, and what the letter may claim

**Status:** PLAN ONLY (**v5, 2026-09-23**). Not started. **Contains two time-boxed live
exposures — §0. Read that first.**

> **Rev 5: final corrections** (re-verified against `develop` @ `0d383e16` and prod).
> **(1)** A verified carrier-recorded final delivery, including completed collection,
> can be `strong` without a signature, under five explicit conditions (a *qualified
> final delivery*, §6.1.1). It can carry an INR package to `strong` (§6.1.3). Case B's
> PostNord sequence is the regression fixture, with its association verified against
> Shopify's own events (§6.1.2). The one automation consequence, `strong → auto_file`, is
> measured (1 open case) and held behind a temporary ladder branch pending §11 Q-7 (§6.1.4).
> **(2)** Shipment-state claims are validated against the shipment each sentence names,
> not against all facts (§4.1(b), test 3e). **(3)** `computeEvidenceHash` sorted by
> positional ids, so fulfilment order moved the hash. Fixed by stable emission order and
> a record-key hash sort (§4.1(f), test 6b). **(4)** The minimal verified response
> contract is reproduced here, with desired vs shipped behaviour, owner, prerequisites
> and release order (§9.9). **(5)** The operator scheduling write is split into confirmed
> evidence and inference. The 12 → 11 relationship is explained, and any reconstruction
> is a labelled `review_state_reconstructed` row, never a synthetic approval (§9.5).

> **Rev 4: code-verified corrections** (review against `develop` @ `0d383e16`, unchanged
> since; every finding re-checked in code before editing).
> **(1)** `supporting` is not bank-citable: the classifier grants both bank flags only to
> strong/moderate facts, so P0 adds one narrow exception, `isCitableShipmentContext`,
> and the four real gates G1–G4 are named (§0, §4.1(b)). **(2)** `moderate` holds for the
> deadline; the "13 cases will auto-file earlier" claim and its decision are withdrawn
> (§4.2, §11). **(3)** The refund-request guard gets an internal constraint derived from
> stored messages, including unapproved ones, that never reaches the generator or the
> PDF (§4.1(c)). **(4)** Per-shipment facts keyed by the model's existing `instanceKey`
> (§4.1(f)). **(5)** `approved` is scheduling authority, not document approval, and
> Case B's flag came from an unlogged operator `UPDATE`, not a merchant click (§0.2,
> §9.5). **(6)** No collector-identity claims from a collection status (§6.3).
> **(7)** Observation time excluded from the hash via the caller's drop set, plus
> validator and plan-policy version bumps (§5.3, §4.1(g)).

> **Rev 3: we are the merchant's counsel.** The maintainer corrected the plan's posture:
> DisputeDesk defends the merchant in every case, uses every argument that helps, and
> never volunteers what helps the cardholder. Rev 2 recommended conceding Case B because
> Cay Collective's own refund policy offers a refund for late arrival, and it asked
> letters to state dispatch delays and filing dates. All of that is reversed. The new
> **Stance** section governs the whole plan. §8.1's delivery-date check now sorts
> material into cite and bury, and never recommends giving up. Case B files on its
> carrier-confirmed collection, with two harmful sentences removed and Cay's policies kept
> out. The one line kept: every sentence is true. Omission, not misstatement.

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
**Evidence SQL:** `scripts/sql/non-receipt-delivery-evidence.sql` (Q1–Q19). Q15 is the
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

## Stance: we are the merchant's counsel (maintainer directive, 2026-09-23; governs every section below)

**This stance governs every dispute type, not only non-receipt.** Its product-wide
home, with the fatal-loss and returned-to-sender revisit, is
`docs/plans/merchant-counsel-stance.plan.md` and CLAUDE.md. The copy below is how it
applies here.

DisputeDesk defends the merchant. The plan is built the way a good lawyer builds a brief:

1. **Always defend.** No path in this plan recommends conceding, withdrawing an approval,
   or declining to file because the facts or the merchant's own policies lean the other
   way. The system always files the strongest defence available. The only outcome worse
   than a weak defence is a silent forfeit (§0.3).
2. **Use every argument that helps; volunteer nothing that hurts.** Material that helps
   the cardholder never enters the bank-facing artifact: not the facts, the narrative,
   the PDF, nor any appendix. That covers a delivery window the shipment missed, a
   dispatch delay, a refund-for-lateness clause, a dispute opened before dispatch, and
   a customer message that restates the complaint. The check in §8.1 exists to **sort
   material into helpful and harmful**, never to tell the merchant to give up.
3. **Every sentence we write is true.** Omission is the tool; misstatement is not. We
   never say "delivered on time", "shipped promptly" or "no refund was requested" unless
   it is so. This is advocacy, not modesty: the issuer holds the carrier record and the
   cardholder's statement, and one provably false sentence loses the whole response.
4. **Never argue against ourselves.** A sentence that concedes the cardholder's premise
   is removed even when it is true. "No return was initiated" on a claim that nothing
   arrived is one of these (D2): it tells the bank the parcel never came.
5. **The merchant sees what we withheld.** A merchant-only note in the UI, in the same
   pattern as the fatal-loss message, which is never sent to the bank, lists what was
   left out and why. The client knows the weak spots; the other side does not.

This extends two standing rules: `[[feedback_bank_optimized_rebuttal]]` (never expose
weaknesses) and `[[feedback_bank_non_disclosure_two_layers]]` (payload redaction plus a
prompt rule). Where the source contract asks for disclosure that helps the cardholder
(dispatch delays "stated without excusing", both dates required), this stance wins; the
conflict is recorded in §12.4.

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

**Action before 2026-10-03 (see §11, Q-1): ship P0 (§4.1) and rebuild**, so the letter
argues from what helps: the order was dispatched and handed to GOFO under tracking
`YT2640221437435982`, which records it in transit. Suppressing `no_return_initiated` on
its own is not an option, and the reason is **bank eligibility**, not the argument
plan's primary-fact rule. Rev 2 got this wrong. `noSafeArgumentReason()`
(`lib/argument/plan/deriveArgumentPlan.ts:127-136`) returns `null` as soon as **any**
fact is included, so the plan never requires a primary fact. The four gates that
actually stand between Case A and a document are all in `buildDefencePackageJob.ts`:

| # | gate | line | Case A without `no_return_initiated` |
|---|---|---|---|
| G1 | `classification.eligible`: at least one approved fact passes `isBankIncludedFact` | `:362` (via `factClassifier.ts:997`) | **fails.** Its delivery facts are `supporting`, and the classifier sets `bankEligible` / `includeInBankNarrative` only for `strong` / `moderate` (`factClassifier.ts:899-911`) |
| G2 | fatal-loss | `:459` | passes |
| G3 | `planHasSafeArgument(plan)` | `:467` | passes if anything is included |
| G4 | `bankIncludedFacts(selectPlanFacts(plan).includedFacts)` non-empty | `:488-495` | fails for the same reason as G1 |

So P0(b)'s new in-transit fact has to be **bank-citable** as well as present. Being
`supporting` is not enough. §4.1(b) specifies the narrow change.

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
(`app/api/cron/defence-package-deadline-submit/route.ts:144-170`), re-admitting the
dispute to the cron's selection (`review_state.eq.approved` in the `.or(...)` filter).
Case B carries that flag.

**How it got the flag. Rev 2 was wrong about this.** It was not a merchant click.
`review_state` has exactly one application writer, `POST /api/disputes/:id/review`
(`app/api/disputes/[id]/review/route.ts`), which records `review_approved` with the actor
and `{from, to}` for every call. Case B has no such event. §9.5 separates what is
confirmed from what is inferred. In short: Case B's row carries the identical
`updated_at` (`2026-09-21 21:40:57.580902 UTC`) as 10 other disputes across **two
shops**. That can only come from one statement, not from per-dispute, per-shop route
calls. The local, untracked `scripts/sql/_schedule_approve.sql` names exactly those
11 disputes plus a twelfth, and it was saved five seconds earlier. The script bypasses
the route, so it bypasses the audit write. Fleet-wide, 17 disputes are `approved`: 6 via
the route, with events, and 11 from this statement. The twelfth disputed row has since
left `approved` through the route (§9.5). The logging mechanism works; this write never
went through it.

So Case B **will file on 2026-10-01 08:00 UTC**, two days before Case A, and its
scheduled letter contains (Q6, verbatim):

> *"The merchant notes that no return of the goods has been initiated and the carrier
> has not recorded any return transit event, **which is consistent with the goods
> having been received**."*

That is D2 again — the absence of a return recruited as corroboration of receipt on a
non-receipt claim — this time inside a letter scheduled for filing. Plus the raw enum
*"recorded a `CollectedAtPickup` status event"* (§6.6), printed to the bank as if it
were English.

Case B's **core is right and it files**. PostNord records the shipment as collected at
the pickup point on 18 September, and a carrier-recorded collection is the strongest
fact this case holds. The letter states it as exactly that: a carrier record of
collection. It says nothing about **who** collected. The collection status carries no
signature or identification, which is why `collectedByCustomer` was retired
(`fulfillmentSource.ts`, PR-C1, 2026-08-07). Two sentences hurt the letter, and both
come out through the P0 rebuild before 1 October: the no-return-implies-receipt clause
(P0c) and the raw enum (§6.6). Nothing is added. In particular the letter does **not**
mention that the dispute was opened before dispatch; that fact helps only the
cardholder (Stance §2).

### 0.3 What rev 1's option 2 would actually do — now observed, not predicted

Rev 1 guessed that suppressing `no_return_initiated` would leave Case A with no safe
argument. Case B's own **v1** proves it: built 2026-09-13 12:44 UTC, before dispatch,
with no delivery and no no-return fact, it ended as
`defence_package_skipped` / **`failureCode: no_bank_eligible_facts`** (Q9). That is gate
G1 (`buildDefencePackageJob.ts:362`): no approved fact was bank-included, so no document
was written. P0(b) must land with P0(a), and P0(b)'s fact must be bank-citable: remove
the bad fact without adding a citable true one, and the outcome is a silent forfeit,
observed.

### 0.4 Re-check 2026-09-23 ~09:55 UTC, and each case's dates against the merchant's terms

Q15 re-run **after** the 02:32 UTC re-ingest: nothing moved. Case A's
`delivery_status` is still null, `submission_state = not_saved`; Case B is still
`approved`, `not_saved`, due 1 October. Both §0 exposures stand.

Then the question rev 1 never asked: **what did the merchant promise, and did the
shipment keep it?** Asked as an advocate: **which dates and terms help the merchant, and
which must stay out of the letter?** Below is every open non-receipt case still awaiting
a response, measured against the shipping policy **in force on the order date**. The
sources are Q17, Q18 and a live `Shop.shopPolicies.updatedAt` check: every stored
shipping policy is still the published version, and each one predates every one of these
orders. Days are business days, Mon–Fri.

| case | merchant's published term | order → dispatch | order → delivery | dispute opened | **use** | **keep out of the letter** |
|---|---|---|---|---|---|---|
| **B** cay #14784 | *"typically … 5–7 business days"* | 23 bd | 25 bd | 20 bd, before dispatch | carrier-confirmed **collection** on 18 Sep, tracking, carrier | the delivery window, the order→dispatch interval, the dispute-before-dispatch date, the refund policy |
| **A** blume #360980 | *"Orders will ship within 1-3 business days"* (dispatch only) | 17 bd | in transit | 20 bd | dispatch, carrier, tracking, carrier possession | the dispatch promise and the delay against it |
| blume #352543 | same | 0 bd | 2 bd | 56 bd | **everything**: shipped the same day and delivered in 2 bd, 8 weeks before the dispute. The on-time dates are an argument; cite the policy | nothing |
| 6a8848-dd #101259 (two dispute rows, one order) | *"innerhalb von 0-3 Tagen verschickt … Lieferzeit 7-15 Werktage"* | 1 bd | 9 bd | 12 bd, after delivery | delivery within the published window; cite the policy | nothing |
| 6a8848-dd #98250 | same | 5 bd (over 0–3 days) | 9 bd | 27 bd | delivery **within the 7–15 bd window**; cite that clause | the 0–3-day dispatch clause and the 5-day dispatch |

**Case B: the policies we must keep out.** Read live from Shopify on 2026-09-23, both in
force since 2026-07-06 (the order was placed 2026-08-16):

> **Refund policy**, under *"The seller wasn't able to help me"*: *"If the seller isn't
> able to help you, your next step is to request help from Cay Collective by opening a
> case by email. You'll receive a full refund if your order never arrives, **arrives after
> the estimated delivery window**, arrives damaged, or isn't as described."*
>
> **Shipping policy:** *"Delivery times vary depending on the seller and the product, but
> orders are typically delivered within 5–7 business days after the order has been placed
> and payment has been received."*

The parcel arrived well after the only window Cay publishes, and Cay's refund terms offer
a refund for late arrival through a Cay case. That is the cardholder's best argument, so
it is **ours to withhold**. Neither policy enters Case B's facts, narrative or PDF. Today
it doesn't: the package holds no policy fact and `policyArgument` is empty (verified on
v2). The job is to make that **structural**, so that a rebuild, a completeness hint
("add your shipping policy") or a merchant upload cannot put the clause in front of the
bank. That is P0(e).

Case B's defence is the carrier's record of collection: *"PostNord records the shipment as
collected at the pickup point on 18 September"*, with carrier and tracking number. That
is true, verifiable from tracking, and it answers "not received" with a carrier record.
It does **not** say who collected: the status carries no signature or identification
(§0.2, D6). Nothing claims that the parcel arrived on time or before the dispute.

**Case A:** blume promises dispatch, not delivery, and the dispatch promise was missed.
So the policy is left out and the letter argues possession: dispatched, handed to GOFO,
tracking, in transit. It gives no dates relative to the order.

**The same check produces arguments as well as exclusions.** For blume #352543 and
6a8848-dd #101259 the published window is a **weapon**: the goods arrived inside what the
merchant promised, long before the dispute. Rev 1 never cited policy windows on
non-receipt cases in either direction. §8.1 makes it cite them when they help and bury
them when they don't.

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

**Fix:** a sixth state, `in_transit`, categorised `supporting`, so it is never scored as
delivery. **Categorising it `supporting` does not by itself make it citable.** The
classifier grants `bankEligible` and `includeInBankNarrative` only to `strong` /
`moderate` facts (`factClassifier.ts:899-911`), and every bank surface filters through
`isBankIncludedFact` (`bankInclusion.ts:41`). A supporting in-transit fact would be
dropped at gates G1 and G4 (§0). §4.1(b) adds the one narrow citability exception it
needs; §5.

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
strong evidence"* — is actually detecting, and **rev 5 accepts it (maintainer
direction, 2026-09-23)**. A verified, carrier-recorded final delivery, including a
completed collection, is eligible for a `strong` delivery signal **without a
signature**, under explicit qualifying conditions. What stays forbidden is what the
record does not show: who collected, an identity check, or a verified address.

**Fix:** a qualified-final-delivery signal, a rollup that can carry an INR package to
`strong` on it, the stale comment, and an automation guard so that the scoring change
cannot quietly move filing dates. §6.1.

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

Seven items, (a)–(g), one PR, no new data sources: every input already exists in the database.

**(a) Claim-family-aware admission.** `ALWAYS_ADMISSIBLE_RULES` gains a
`deniedForFamilies: readonly FamilyKey[]` field; `no_return_initiated` carries
`["item_not_received"]`. `alwaysAdmissibleCategories()` takes the resolved family and
drops denied rules. The existing `hasReturnedToSenderShipment` carve-out is untouched.

Why a field and not an early return: the admission test in that module's header is
per-claim-type in its wording and per-key in its implementation, and this is the
second time that gap has produced a live defect. The field makes the question
answerable for every future member. A vitest case asserts, for each rule × each
family, that the rule's own rationale sentence is family-scoped.

**(b) The in-transit fact becomes citable, and only that fact.** §5 defines the state.
This item is the citability change without which (a) alone turns Case A into a skip at
gate G1 (§0).

*The narrow change.* In `classifyFacts` (`lib/defence/factClassifier.ts:899-911`) the two
flags stay `cat === "strong" || cat === "moderate"`. **One** named exception is added
beside them, `isCitableShipmentContext(fieldKey, value)`, and it grants `bankEligible` and
`includeInBankNarrative` to a `supporting` fact only when **all** of these hold:
- `fieldKey` ∈ {`shipping_tracking`, `delivery_proof`};
- the fact's **own shipment** (§4.1(f)) has `proofType === "in_transit"`;
- that shipment has a named carrier and a tracking identifier that passes **both**
  existing checks in `lib/carriers/trackingLinkUrl.ts`: the generic `isPlausibleIdentifier`
  (`:426`) and the carrier-specific known-bad-shape list (`NOT_A_USPS_IDENTIFIER` /
  `couldBeUspsIdentifier`, `:309-320`). The generic check alone is not enough, because
  `260914OET4` (10 alphanumerics) passes it. Only the USPS shape list (PR #758) rejects
  it. The two are exposed as one exported predicate, `isParcelIdentifier(carrier,
  number)`, so the classifier and the link builder cannot disagree;
- the fact is not internal-only and not a submission risk (the existing conjuncts,
  unchanged).

`strength` stays `supporting`. Strength scoring reads the category
(`categorizeEvidenceField`, `canonicalEvidence.ts`), never the bank flags, so a citable
in-transit fact still contributes nothing to case strength. Every other `supporting`
fact stays non-citable; this is not a general "supporting may be cited" rule. A
`label_created` shipment fails the second conjunct and stays non-citable, so a printed
label can never produce a carrier-possession sentence.

*The claim it licenses* is enforced at the validator, not trusted to the prompt. The
`item_not_received` family's `guardedBankPhrases` gains carrier-possession patterns ("in
transit", "in the carrier's possession", "handed to {carrier}", "accepted by the
carrier") with `requires: "shipment_in_carrier_possession"`, the §6.4 predicate. The
predicate evaluates true only over a fact that passed `isCitableShipmentContext`.
`runPhraseAndGuardChecks` already applies guarded phrases at every layer (thesis, LLM,
fallback), so a label-only case cannot acquire the sentence by any path.

*Shipment claims are checked against their own shipment (rev 5).* A case-wide guard is
not enough. `runPhraseAndGuardChecks` evaluates each guard's predicate over **all**
approved facts (`predicate.evaluate(approvedFacts)`, `validateNarrative.ts`, guarded-phrase
loop), so one valid GOFO transit fact would license a transit sentence about the USPS
batch reference. Shipment-state phrases (in transit, delivered, collected, out for
delivery, handed to the carrier) are therefore checked **per sentence, against the
shipment the sentence names**:
1. A new `shipmentScoped: true` flag on those guarded entries. For a scoped entry, the
   validator splits the prose into sentences, and in each sentence that matches the
   pattern it resolves which shipment is meant: any tracking number of a shipment fact
   (exact match), or the carrier name of a shipment fact (`value.carrier`,
   case-insensitive).
2. The predicate is evaluated over **only the facts with that `instanceKey`**
   (§4.1(f)). A sentence naming USPS is checked against the USPS fact alone.
3. A matching sentence that names **no** shipment passes only when the case has exactly
   one shipment, or when **every** shipment satisfies the predicate. Otherwise it is
   refused as ambiguous. A sentence naming two shipments must satisfy the predicate for
   each of them.
4. The same resolution applies to delivery phrases guarded by the QFD / delivery
   predicates (§6.1), so a delivered parcel's record can never be attached to its sibling.

Non-shipment guarded phrases (card terms, channel assertions) keep today's case-wide
evaluation, unchanged.

*Acceptance, end to end* (§10 test 3b). Fixture: Case A's inputs with
`no_return_initiated` excluded by (a), and the GOFO shipment `IN_TRANSIT`. It must pass
G1 (`buildDefencePackageJob.ts:362`), G3 (`:467`) and G4 (`:488-495`), then
`validateNarrative` (`:590`), `validatePackageDocument` (`:935`), and the deadline
selector's eligibility, and end as a fileable draft that cites the carrier, the tracking
number and the in-transit status. Its pair: the same fixture with the shipment at
`label_created` must produce no carrier-possession sentence anywhere. It then falls to
the minimal verified response (§9.9; until PR #767 phase C ships, today's skip), never to a
fabricated transit claim.

**(c) Two new validator rules.** `lib/defence/validateNarrative.ts` must reject, on
the `item_not_received` family:
- any argument from the **absence of a return** (paraphrase-tolerant, per the
  contract's §6: "must detect paraphrases, not just banned exact phrases");
- any assertion that **no refund, reimbursement or compensation was requested**, when
  the internal constraint below says one was.

*Where the second rule gets its knowledge.* It cannot come from the pack. Two filters
already keep such messages out, correctly: `gorgiasCommSource.ts` loads only
`review_status in ('approved','manual')` (`:114-119`), and `isIncludableMessage` drops
`refund_history` / `cancellation_history` (`BANK_EXCLUDED_EVIDENCE_CATEGORIES`,
`:196-199`). Case A shows why the rule cannot depend on either the approval or the
category: its reimbursement request `cf7b6536` is `review_status = proposed` and
classified `contradiction`, not `refund_history`. So P0 adds an **internal constraint**,
derived beside the pack, never inside it:

| | specification |
|---|---|
| **input** | `InternalNarrativeConstraints`, a new optional field on `ValidateNarrativeInput` (`validateNarrative.ts:179`) and on `RunPhraseAndGuardChecksInput` (`:195`). Shape: `{ refundOrCompensationRequested: { messageIds: string[]; firstSentAt: string } \| null }`. **Ids and one date, no text.** |
| **derivation** | a new pure function `deriveInternalNarrativeConstraints(rows)` in `lib/integrations/gorgias/`, fed by a loader that reads `gorgias_evidence_messages` joined to `gorgias_matched_tickets` for the dispute, with **no** `review_status` filter except `rejected`. Order-match and provenance are kept: only tickets with `match_status = 'confirmed_match'`, or `proposed_match` at `confidence = 'high'`; only `sender_type = 'customer'`; `content_hash` recorded per message id. The test is on the stored `message_text`: a deterministic, multilingual request pattern (reimburse / refund / money back / compensation, in the six active locales), **or** an analyzer category of `refund_history`. It never depends on P2's reclassification |
| **call site** | `buildDefencePackageJob.ts`, once, beside `classifyFacts` (`:327`). Passed to every validator consumer, and to **nothing else**: not to the narrative writer, the projection, the PDF composer, or `facts_json` |
| **consumers** | `validateNarrative` (`:590`, and the retry at `:701`), and `runPhraseAndGuardChecks` for the thesis and fallback layers. Plus `validatePackageDocument` (`documentValidation.ts:103`, canonical route) and `validateComposedDocument` (`validateNarrative.ts:490`, legacy route), so the rendered PDF blocks are checked too |
| **persistence** | the derived constraint (ids + date) is written to the package's internal validation record for audit. Message text is never copied anywhere new |

The generator never sees the message, so it cannot quote it. It is also never told to
deny a refund request. If it volunteers the denial, the validator refuses it, and the
section is suppressed or regenerated through the existing retry path.

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

**(e) The harmful-material filter (§8.1.4).** A policy fact, a policy excerpt or a
date interval enters the bank artifact only if the §8.1 check classes it as **helpful**
for this case. On a non-receipt case where delivery or dispatch missed the published
window, the shipping policy, the refund policy's lateness clause and every
order→dispatch/delivery interval are excluded. They are kept out of `facts_json`, the
narrative prompt, the PDF and any appendix. The exclusion is enforced **twice**, per
`[[feedback_bank_non_disclosure_two_layers]]`: the fact is dropped before composition,
and the validator refuses any sentence that cites the window or the interval. Excluded
material is listed in a merchant-only note (Stance §5). The completeness engine must not
then prompt the merchant to "add your shipping policy" on that case; that hint would
invite them to put the clause back. In P0 this ships as a guard. The full profile and its
confirmation flow follow in P3.

**(f) Shipment identity survives the fact projection.** P0's per-shipment facts are only
safe if carrier, tracking number, status and dates stay attached to **their own**
shipment. Two projections flatten them today:
- `classifyFacts` builds one delivery fact per field. `firstTrackingEntry`
  (`factClassifier.ts:309-324`) takes the first tracking row with a number and combines
  it with the **section-wide** `proofType` and `deliveredAt` (`:495-512`). On Case A the
  first row is USPS `260914OET4` (the batch reference), and the section tier comes from
  the other parcel.
- `planForCase` maps every record of a field to the **first** classified fact for that
  field (`planForCase.ts:144-157`, "First fact wins").

The model already keys records per shipment: `recordId = ${fieldKey}#${instanceKey}`,
with `instanceKey` = `fulfillmentId`, else the first tracking number
(`lib/evidence/model/derive.ts:200-209`). So the fix reuses that key rather than
inventing one:
1. For `delivery_proof` / `shipping_tracking`, `classifyFacts` emits **one fact per
   fulfillment** in the section's `fulfillments[]`. Each fact's value carries that
   fulfillment's own carrier, tracking number, status, per-shipment `proofType`,
   `deliveredAt` and in-transit status, plus `instanceKey`, computed by the **same**
   `instanceKey()` (exported from `derive.ts`, not re-spelled). The order-level
   `coverage` that `collectFulfillmentEvidence` already writes from
   `resolveDeliveryCoverage` (`fulfillmentSource.ts:524-548`, `:572`) is copied onto each
   fact unchanged. Coverage is not recomputed, and no partial-delivery tracking is
   rebuilt.
2. `planForCase` joins on `recordId` first (`${fieldKey}#${value.instanceKey}`) and falls
   back to the `fieldKey` join only for facts that carry no `instanceKey` (every
   non-shipment field, unchanged).
3. `deliveryStatusesOf` stays on each fact, so `evidence_hash` still moves on any
   shipment's status change. **Order independence is not free, and rev 4 was wrong to
   say it was.** `deliveryStatusesOf` sorts statuses *within* one fact, but
   `computeEvidenceHash` orders facts by `fact.id` (`.sort((a, b) =>
   a.id.localeCompare(b.id))`), and `fact.id` is positional (`f${factIndex++}`). Reverse
   `fulfillments[]` and the per-shipment facts get swapped ids, the projected list
   reorders, and the hash moves with nothing having changed. Two changes close it:
   - **Stable emission order.** `classifyFacts` emits a field's per-shipment facts
     sorted by `instanceKey`, so the positional ids come out the same whatever the
     array order. Positional ids stay, because narrative citations reference them.
   - **Stable hash order.** `computeEvidenceHash` sorts by a record key, not by `id`:
     `${value.fieldKey}#${value.instanceKey ?? ""}`, with the canonical JSON of the
     projected fact as the tie-break. The projection already excludes `id`, so the hash
     then depends on content alone. Sorting all facts this way is a one-time hash
     rotation, folded into the rotation §5.3 already plans for.
4. Which shipment is **cited** is decided per fact by (b)'s conjuncts, never by position.
   A batch reference is never the cited parcel, wherever it sits in the array.

Fixtures (§10 tests 6a–6c): the batch reference **before** GOFO, and the **reverse**
order, must cite the same GOFO shipment with the same tracking number and the same
status. And one parcel `Delivered` plus one `IN_TRANSIT` must yield two facts, each
with its own dates, and no sentence may attribute the delivery to the in-transit
parcel or the reverse. Order-level definitive delivery language stays reserved for
`coverage = complete`, as `DeliveryCoverage`'s own contract already says.

**(g) Hashing and versions.** §5.3 carries the hash rules. Release steps for P0, in the
same PR: bump `VALIDATOR_VERSION` 4 → 5 (`validateNarrative.ts:112`; the (c) rules and
guarded phrases change what the validator refuses), and `PLAN_POLICY_VERSION` 1 → 2
(`planForCase.ts:64`; (a) changes admission and (f) changes the join). The bump does not
rebuild anything by itself. It removes the `idempotent_match` short-circuit
(`lib/defence/enqueue.ts:275-284` requires `validator_version === VALIDATOR_VERSION`), so
the **next** enqueue for a draft marks it `stale` and builds a fresh version even when
`evidence_hash` is unchanged (`:287-314`, `validatorVersionMoved`). Cases A and B are then
rebuilt by enqueueing them through the existing build path after the deploy. That is a
system rebuild, not an edit of any letter.

**Rebuild, then read.** Rebuild both cases and read the letters before their deadlines.
Case B's is **two days earlier** (§0.2). The maintainer has ruled out a manual edit
(§11 Q-1b), so P0 is the only route. Rebuilding does **not** require re-approval. Case
B's `approved` state is a dispute-level **scheduling** authority (§9.5), not approval
of a specific document, so the rebuilt package files under it on 1 October.

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

**What the re-rating does to automation: nothing.** Rev 1 and rev 2 claimed that
`weak → moderate` moves these cases from `hold_for_deadline` to `auto_file` and makes
them file earlier. That is false. `deriveCaseAutomationDecision` returns
`hold_for_deadline` for `moderate` (`lib/automation/decision/deriveCaseAutomationDecision.ts:305-306`),
and only `strong` reaches `auto_file` (`:309`). The single exception is the separately
defined credit-covered branch (`creditCovers`, `:239-241`). `decisionLadder.test.ts:345`
pins it: *"moderate holds for the deadline rather than filing early"*. The 13 cases file
on their deadlines exactly as they do today. What changes is the strength the merchant
sees and the `strength_insufficient` reason code. The `weak → moderate` step needs no
automation-policy change and no feature flag.

**Rev 5: `strong` is different.** P1 now also lets a qualified final delivery carry an
INR case to `strong` (§6.1.3), and `strong` does reach `auto_file` (`:309`). Measured: 1
open auto-mode case would file earlier today (§6.1.4). So P1 ships a named, temporary
ladder branch that keeps QFD-only `strong` cases on `hold_for_deadline`. That is not a
policy change: it holds today's timing in place until §11 Q-7 decides it separately.

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

`supporting` gives the **never-scored** half of the contract's *"shipment context only"*
row (`canonicalEvidence.ts`, `excludedFromStrength` / `supportingOnly` semantics). It
does **not** give the citable half. Rev 2 said it did, and that was wrong: the classifier
makes only `strong` / `moderate` facts bank-eligible (`factClassifier.ts:899-911`).
Citability for this one state comes from §4.1(b)'s `isCitableShipmentContext`
exception, and from nothing broader.

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
`OUT_FOR_DELIVERY`), the source id, and the **retrieval timestamp** under the reserved
key `carrierStatusObservedAt` (§5.3: never hashed). There is no movement date because we hold none.

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

**Observation metadata must not move the hash (P0).** §5.2 puts a retrieval timestamp
into the in-transit fact's value, and `computeEvidenceHash` hashes the whole value. Its
drop set, `VOLATILE_TIMESTAMP_KEYS` (`lib/hashing/canonicalJson.ts:27-36`), names only
created/updated/uploaded/generated keys. So as specified, an unchanged re-read would
rotate the hash on every read and mark every in-transit draft stale for nothing. The
fix reuses the mechanism:
- The retrieval time is carried under one reserved key name,
  **`carrierStatusObservedAt`**, and only that name. The generic `observedAt` is **not**
  usable: `lib/liabilityShift/sessions/ingest.ts:91` already writes
  `consentSignals.observedAt`, and the drop applies at every depth, so it would silently
  remove session evidence from the hash. A vitest pins the name as unused by every other
  fact-value builder.
- `computeEvidenceHash` passes `dropKeys: EVIDENCE_HASH_DROP_KEYS`, defined **in
  `computeEvidenceHash.ts`** as `VOLATILE_TIMESTAMP_KEYS ∪ {"carrierStatusObservedAt"}`. The file's
  own header (`:19-22`) says this drop set is the caller's policy, so the shared
  canonicaliser and the post-outcome snapshot hasher, which deliberately drop nothing
  (`DROP_NOTHING`), are untouched.
- What stays hashed, so real change is detected: the per-shipment **status** (gap 1),
  carrier, tracking number, `deliveredAt`, `returnedAt`, and in P4 `lastEventAt` /
  `lastEventFingerprint`. A correction on the carrier's side changes one of those
  and moves the hash; an unchanged re-read changes only `carrierStatusObservedAt` and does not.
- Tests: an unchanged re-read with a new `carrierStatusObservedAt` → identical hash;
  `IN_TRANSIT → DELIVERED` → new hash; a status reversed by correction → new hash; the
  same two shipments in reversed `fulfillments[]` order → identical hash.

**One-time rotation to plan for.** §4.1(f) changes the delivery fact from one per field
to one per shipment. That changes `value` for every package with a delivery fact, so
every such draft reads as stale on its next enqueue. Per
`[[reference_stale_hash_is_not_a_rebuild]]` a rotation alone spends nothing: only an
enqueue rebuilds. Count the affected open drafts before release and let them rebuild
through their normal triggers, not in a bulk sweep.

### 5.4 Acceptance fixture

Two fixtures, matching §5.2's two phases, because a single one would smuggle P4's
wording into P0's acceptance.

**P0 fixture** — inputs are what prod actually holds for Case A: order + dispatch date,
carrier `GOFO`, tracking `YT2640221437435982`, `fulfillment_status = IN_TRANSIT`, a
retrieval timestamp, and the Sep 5–6 thread. The letter must (i) state dispatch and the
in-transit status with the **retrieval** date labelled as such, (ii) **not mention the
dispatch delay, the dispatch promise, or the Sep 5–6 thread** (Stance §2; the thread
restates the complaint), (iii) make no receipt claim, (iv) make no no-return claim,
(v) make no statement about refund requests either way, and (vi) **contain no movement
date**.

**P4 fixture** — the contract's §7.9 specimen in full, once an event source exists: the
seven supplied GOFO events in, the latest event stated with its own date, and the
retrieval date carried separately.

Each has a counterpart with the support thread removed — the letter must still be a
dated shipment narrative (contract §9, test 2).

---

## 6. Argument selection, strength and copy

### 6.1 Delivery strength: the signal, the package, and the filing date (D3)

**Rev 5 reverses the rule from revs 1–4** that an unsigned delivery or collection is
always `moderate`. The maintainer's direction (2026-09-23), after reviewing PostNord's
own tracking for Case B: *verified carrier-confirmed final delivery, including completed
collection, should be eligible for strong delivery evidence without requiring a
signature.* Three decisions are specified separately, because they are different
decisions.

#### 6.1.1 The delivery **signal**: when an unsigned delivery is `strong`

A shipment yields a **qualified final delivery** (QFD) when **all five** conditions
hold. Otherwise it keeps today's categories.

| # | condition | how it is decided (existing code where it exists) |
|---|---|---|
| 1 | **Trustworthy carrier provenance** | the final-delivery event comes from the carrier, not the merchant. That means a carrier adapter (`tracking_source = carrier_api_*`), a tracking-app event feed, or a Shopify fulfillment event whose `message` carries the **carrier's own event text** (Case B: *"Försändelsen har levererats."*). A `shopify_native` `DELIVERED` with **no** carrier event text is excluded, because Shopify's "mark as delivered" is merchant-settable and our data cannot tell the two apart (344,165 `shopify_native` delivered rows with no adapter). Before implementation, a probe of one manually marked fulfillment must confirm that such events carry no carrier message. Until then this condition fails closed |
| 2 | **An event timestamp** | the carrier event's own `happenedAt` / `deliveredAt`, never a retrieval time (`carrierStatusObservedAt` never qualifies, §5.3) |
| 3 | **Correct shipment and order association** | the event belongs to the fulfillment whose `instanceKey` the fact carries (§4.1(f)), on the disputed order, under a tracking identifier that passes `isParcelIdentifier` (§4.1(b)) |
| 4 | **Coverage of the disputed goods** | `coverage = complete` from `resolveDeliveryCoverage` (`fulfillmentSource.ts:524-548`). `partial` never qualifies. `unknown` (line items unavailable) qualifies only on a single-fulfillment order |
| 5 | **No unresolved contradictory delivery record** | no other record of the same goods says `Returned`, `NOT_DELIVERED` or lost, or gives a later non-delivery status. No carrier correction reverses the delivery, and no second source reports a different outcome for the same shipment. Any of these fails the condition until a newer record resolves it (§6.1.3) |

A QFD maps to a new `DeliveryProofType` member, **`delivered_final_verified`** →
`strong`, alongside the existing `signature_confirmed` → `strong`. The distinctions
are kept and stated as an invariant:

| carrier state | proofType | signal |
|---|---|---|
| label created, no carrier acceptance | `label_created` | invalid |
| accepted / in transit / out for delivery | `in_transit` | supporting (citable per §4.1(b)) |
| **available for collection** (`DeliveredToPickup`, Shopify `READY_FOR_PICKUP`) | `delivered_unverified` | supporting, **never** receipt |
| delivered or collected, carrier-sourced, but a QFD condition fails | `delivered_confirmed` | moderate |
| **delivered or collected, all five QFD conditions hold** | **`delivered_final_verified`** | **strong** |
| signature / POD artifact | `signature_confirmed` | strong |

**What a QFD licenses, and what it does not.** It licenses the carrier's record:
*"PostNord records the shipment as delivered on 18 September"*, or *"…as collected at
the pickup point on 18 September"*. It does **not** license a statement of who
received it, an identity check, or a verified address. `collectedByCustomer`,
`deliveredToVerifiedAddress` and any ID claim stay retired (`fulfillmentSource.ts`,
PR-C1) unless independent support exists (§6.3). "Strong" is an internal assessment of
the evidence, not a promise of the outcome.

#### 6.1.2 The regression fixture: Case B's PostNord sequence

The association was verified on 2026-09-23 against Shopify's own fulfillment record for
#14784 (`f0036694-fe57-41a0-9cf0-1e9dc94c0232`): one fulfillment
(`gid://shopify/Fulfillment/7553450410250`), PostNord SE `00573132901924649740`, one line
item, quantity 1, fully covered.

| Shopify event (UTC) | carrier text on the event | screenshot (shown in UTC−3) | expected state |
|---|---|---|---|
| `LABEL_PURCHASED` 2026-09-16 08:25:46 | — | — | `label_created` |
| `IN_TRANSIT` 2026-09-16 08:34:05 | *"Försändelsen har lämnats av avsändaren."* | — | `in_transit` |
| `READY_FOR_PICKUP` 2026-09-17 09:24:18 | *"Avisering skickad via APP. – Sista hämtningsdag: 2026-09-24"* | 17 Sep 06:23 *"…levererats till ett serviceställe"* / *"Paketet kan hämtas i ett paketskåp hos ombudet"* | **available for collection: not final delivery** |
| `DELIVERED` 2026-09-18 16:23:00 | *"Försändelsen har levererats."* | 18 Sep 13:23 *"Försändelsen har levererats."* | **QFD → `delivered_final_verified`** |

The screenshot times are the same events shifted three hours earlier, which fits a
browser in UTC−3. The ICA service-point name persisting as the location on the
18 September row does **not** mean the parcel is still waiting: the event text records
completed delivery. The fixture pins both directions. The 17 September state alone must
**not** reach QFD, and the 18 September event must. The screenshot itself is not case
evidence. The fixture and the letter use Shopify's stored events, which carry the
provenance and the association. A screenshot would need its own source record before
it could be cited.

#### 6.1.3 The **package**: when a QFD carries an INR case to `strong`

Today the rollup (`caseStrength.ts:755-769`) rates one strong delivery signal only
`moderate` overall (`else if (hasStrongDelivery) overall = "moderate"`) and needs
`strongCount >= 2` for `strong`. For the item-not-received family it becomes:

| package holds | overall |
|---|---|
| a QFD (or `signature_confirmed`) covering the disputed goods, with no conflict (below) | **`strong`**, on its own |
| a carrier-sourced delivery that fails a QFD condition (`delivered_confirmed`) | **`moderate`**, on its own (rev 2's `hasConfirmedDelivery` rung, kept) |
| only `in_transit`, availability for collection, or `label_created` | `weak` |

**How conflicting evidence moves it:**
- A contradictory delivery record on the disputed goods (QFD condition 5) removes the
  QFD. The shipment falls to `delivered_confirmed` at most, and the case to `moderate`
  at most, until a newer record resolves it.
- Partial coverage: `moderate` at most, whatever the signal.
- A returned-to-sender shipment for the disputed goods: the existing gate
  (`returnedToSender.ts`) governs, and a QFD on another parcel does not override it.
- Lateness against the merchant's published window (§8.1) is **not** a contradiction.
  It changes what the letter cites, never the delivery signal.
- A customer message restating non-receipt is **not** a contradiction (D7). A customer
  message **acknowledging** receipt adds a signal and never subtracts one.

The stale `deliveredToVerifiedAddress` comment is rewritten to describe this rule.

#### 6.1.4 The **filing date**: the one real automation consequence, held back on purpose

The `weak → moderate` step changes nothing about timing (§4.2), because `moderate` holds
for the deadline. **`strong` does not**: `deriveCaseAutomationDecision` returns
`auto_file` for `strong` (`:309`). So this scoring revision **would** move filing dates
for auto-mode cases, and it must not do that silently.

Measured on prod on 2026-09-23 (Q19): open, unsaved non-receipt disputes with a
receipt-grade delivery, one shipment, and no contradictory record.

| dispute | shop | rule mode | today | if rated `strong` under the current ladder |
|---|---|---|---|---|
| #352543 | blume-box | **auto** | `hold_for_deadline`, due 3 Oct | **`auto_file`: files at its next decision point, before 3 Oct** |
| #14784 | cay-collective | review | parked, scheduled (`approved`) | unchanged: review mode parks; files 1 Oct by scheduling |
| #100806 | 6a8848-dd | review | conceded | unchanged: never filed |
| #98250 | 6a8848-dd | review | parked | unchanged |
| #101259 (two dispute rows) | 6a8848-dd | review | parked | unchanged |

**One case** changes timing today, and the effect grows with every auto-mode shop. So P1
ships the scoring **together with** a named, temporary branch in the ladder, in the same
style as the existing `creditCovers` branch (`:239-241`, `:305-306`): *a delivery-family
case whose only route to `strong` is a QFD returns `hold_for_deadline`*. The merchant
sees the `strong` rating, and filing timing does not change. The branch is removed only
by §11 Q-7, a separate decision, taken with the then-current affected set printed
(`[[feedback_irreversible_scope_confirm]]`). The existing `decisionLadder.test.ts:345`
behaviour is kept, and a new test pins the temporary branch.

**The availability-is-not-collection invariant is kept.** `confirmedReceipt`
(`fulfillmentSource.ts:247-256`) admits only `Delivered` / `CollectedAtPickup` with a
timestamp. `DeliveredToPickup` / `READY_FOR_PICKUP` never reaches `delivered_confirmed`,
let alone a QFD, and §10 tests 8a and 8b pin both. Rev 2's P1 count of **13**
(12 `Delivered` + 1 `CollectedAtPickup`, any status) remains the scoring blast radius.
Q19's **6** are the subset still open and unsaved, where timing could matter.

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

The same rule binds **bank-facing** text, not only merchant copy. The permitted form is
the carrier's record: *"PostNord records the shipment as collected at the pickup point
on 18 September."* Refused, by the validator on the `item_not_received` family: "collected
by the cardholder", "collected by the customer", "collected by the recipient", "the
cardholder has / now has the goods", "received by the cardholder", and any identity or
ID-check claim. The only exception is an explicit signature/POD artifact, and even then
the letter may say *"signed for by {signedByName}"*. A recorded signer name is the
carrier's record of a name, not proof that the name is the cardholder's, so it never
becomes "the cardholder signed" or "identity verified".

A vitest case asserts that no delivery-line string, in merchant copy or bank prose,
names an actor or an identity check. That closes the class rather than editing two
strings.

### 6.4 Position selection (contract §4)

The scaffold exists: `StrategySubmodule.predicates` over `FactPredicate`s, resolved
by `lib/defence/strategies/registry.ts`. The contract's nine rows map onto it as:

| contract §4 row | today | after |
|---|---|---|
| delivered before dispute, matching goods | `item_not_received_delivery_proof_stack` | unchanged |
| **delivered after dispute, before submission** | same strategy | new predicate `delivery_after_dispute_filing`: argue from the **carrier's record of delivery or collection**, with its date. Do not cite the filing date, and do not name who received it (§6.3) |
| in transit, commitment still ahead | not expressible | needs P3 (§8) |
| filed before the commitment, still undelivered after it | not expressible | needs P3 |
| in transit, commitment expired | not expressible | needs P3 |
| **in transit, commitment unknown** | `item_not_received_narrow_fallback` **with nothing to cite** | new predicate `shipment_in_carrier_possession` → cites the §5 fact |
| label only, no acceptance | same fallback, indistinguishable | distinguished by §5.1 |
| lost / returned / partial | `returned_to_sender` gate exists | unchanged |
| material evidence unavailable | `noSafeArgument` exists | unchanged |

Case B is row 2, and its chronology already does the right thing: it lists dispatch and
collection and **does not state the 13 September filing date** (Q6). Keep it that way.
The argument for row 2 is the carrier's record: *"PostNord records the shipment as
collected at the pickup point on 18 September."* It never says who collected (§6.3).
The letter never claims that delivery happened before the dispute (that would be false,
Stance §3). It never volunteers that it happened after (that would be harmful, Stance
§2). The issuer knows the filing date; we do not remind them.

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
   must not state or imply that delivery preceded the dispute (false), and it does not
   cite the filing date (harmful). A rebuilt letter that merely appends "delivered" to a
   stale transit narrative fails this. The delivery must be the lead argument, not an
   afterthought to a transit story (contract §7.9, final paragraph, adapted per §12.4
   item 6).
3. **Timing claims only when they help, and only when true.** "Delivered within the
   merchant's published delivery window" is cited when §8.1 says so. No sentence
   characterises timing otherwise ("promptly", "without delay", "as expected"), and a
   missed window or dispatch interval is never stated (P0e).

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
   `refund_history` with an explicit "requested, scope uncertain" marker.** This
   improves the classification. It is **not** what blocks the denial: that block ships in
   P0, through the internal constraint of §4.1(c), which reads the stored text itself
   and works on today's data (Case A's request is still `proposed` / `contradiction`).
   Once P2 lands, `refund_history` becomes one more input to that same constraint, not a
   replacement for it.

4. **Messages that help the cardholder never enter the bank artifact.** A message that
   restates the complaint, complains of delay, or asks for compensation is classified
   (so the validator knows it exists and refuses any sentence that contradicts it), and
   **excluded** from the letter and the PDF. Only messages that help the merchant are
   quoted: an acknowledgement of receipt, an agreement to wait, an admission that
   undercuts the claim. This matches Stance §2 and the existing Gorgias rule that
   refund/cancellation history is hard-blocked from bank packs
   (`[[project_gorgias_bank_category_exclusion]]`).

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
the order date. Outputs are stored on the case. They are **internal**: they steer
argument selection and the harmful-material filter, and they are shown to the merchant
only in the merchant-only note, never to the bank.

| output | values |
|---|---|
| `dispatch_vs_promise` | `on_time` · `late(n bd)` · `no_dispatch_promise` · `unknown` |
| `delivery_vs_promise` | `on_time` · `late(n bd)` · `pending, window open` · `pending, window passed` · `no_delivery_promise` · `unknown` |
| `dispute_timing` | `before_window_end` (premature) · `after_window, before_delivery` · `after_delivery` |
| `harmful_terms` | the policy clauses that would help the cardholder on these dates (e.g. cay's refund-for-late-arrival clause), each with its conditions |

#### 8.1.4 How to act on it: every row files

The check never decides *whether* to defend. It decides **what to cite and what to
bury**.

| check result | cite | keep out |
|---|---|---|
| delivered on time, dispute after delivery | delivery **and** the published window it met; the policy is evidence | nothing |
| dispute opened **before** the delivery window ended | **premature filing**: the cardholder disputed before the merchant's own delivery window had closed (contract §3.1). Needs a confirmed profile; estimate wording ("typically") is cited as the merchant's *stated expectation*, never as a guarantee | nothing |
| delivered late | the delivery or collection itself, as a present fact, with tracking and carrier | the window, the policy, every order→delivery interval, the dispute date relative to delivery |
| delivered late **and** `harmful_terms` present | same as above | same as above, **plus** the refund or remedy clause. It is also excluded structurally from any future rebuild of this case |
| in transit, window open | carrier possession, **and** that the window has not closed | nothing |
| in transit, window passed | carrier possession | the window and every interval |
| dispatch late, delivery within window | the delivery-window clause only | the dispatch clause and the dispatch interval |
| no promise of either kind, or profile `unknown` | shipment narrative, no timing claim | nothing to exclude |

Automation is unchanged by this check. A late case is not demoted to review because it
was late; it files on the normal path with the harmful material removed.

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

- **21.** Case B's exact dates + cay's profile → the letter **files** and cites the
  18 September collection, tracking and carrier. It contains no delivery window, no
  policy text, no order→dispatch or order→delivery interval, and no dispute-filing date.
  The merchant-only note lists the withheld clause.
- **21a.** Same case, and the merchant uploads the shipping policy manually → the policy
  still does not reach the bank artifact, and the note says why.
- **21b.** blume #352543's dates → the letter **cites** the 1–3-day dispatch promise and
  the same-day dispatch (helpful material is used, not just harmful material dropped).
- **22.** A policy whose live `updatedAt` is **after** the order date → the profile is
  not admissible for that order → `unknown`, and the letter makes no timing claim.
- **23.** Estimate wording (*"typically"*, *"usually"*) on a premature dispute → cited as
  the merchant's stated expectation, never as a guarantee or commitment.
- **23a.** Validator: a sentence citing a window the shipment missed is refused, even if
  the model writes it unprompted.
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

### 9.5 Approval scope — two different authorities, and one unlogged write

**Rev 3 correction.** Rev 2 described Case B's flag as a merchant's approval of its
letter, and proposed invalidating approvals when the package moves. Both readings were
wrong. The code has a different authority, and Case B's flag did not come from it.

**What `approved` means today: scheduling authority, not document approval.**
`POST /api/disputes/:id/review` (`app/api/disputes/[id]/review/route.ts:15-37`) documents
`approve` as *"scheduling, not submitting now"*. It sets the dispute-level
`review_state = 'approved'`, clears `needs_attention`, and the 08:00 UTC deadline cron
then files **whatever package is current and valid at that time** for the dispute. It
pins no package id, version or hash, and it was never presented to the merchant as
approval of wording. It is audited: every call logs `review_approved` (or
`review_held` / `review_conceded` / `review_cleared`) with `actorType`, `actorId` and
`{action, from, to}` (`:120-137`).

**Why Case B has no audit event: confirmed evidence, then inference.**

*Confirmed* (read from prod and the working tree, 2026-09-23):
1. Eleven disputes across two shops have `review_state = 'approved'` and the identical
   `updated_at` `2026-09-21 21:40:57.580902+00`, Case B among them. Route calls are
   per dispute and per shop, each in its own transaction, so they cannot share a
   microsecond. This was one statement.
2. None of those 11 has any `review_approved` event.
3. `scripts/sql/_schedule_approve.sql` (local, untracked) is an `UPDATE` that sets
   `review_state = 'approved'`, `needs_attention = false`, `review_due_at = null` and
   `updated_at = now()` for **12** named ids: those 11 plus `e533d123` (#100806). Its
   file time is 21:40:52 UTC.
4. #100806's own route events: `review_cleared` at 2026-09-22 09:10:34 logged
   **`from: "approved"`**, then `review_conceded` 10 s later. So it was `approved` before
   that, with no `review_approved` event either. That accounts for 12 → 11: the
   statement changed 12 rows, and one of them has since left `approved` through the
   route, which overwrote its `updated_at`.

*Inferred, not proven:* that this file is the statement that ran (strongly supported by
the identical id set and the 5 s gap, but nothing records execution); how it was run.

*Unknown:* who ran or instructed it; each row's `review_state` **before** 21:40:57 (no
record exists); whether each merchant asked for it. **Nothing suggests a merchant
clicked approve for any of the 12.**

So the absence is specific to that write, not a gap in the logging mechanism. Two fixes,
**specified here and not executed by this plan-only revision** (no production audit
writes):
1. **Reconstructed-history rows, never a synthetic approval.** One row per affected
   dispute (all **12**, including #100806, whose later route events should be read
   against it). It uses a distinct `event_type`, `review_state_reconstructed`, not
   `review_approved`, so no reader, report or UI can mistake it for a click. Fields:
   `actor_type = 'script'` (the write came from outside every application path, which
   is confirmed by elimination) and `actor_id = NULL`. The payload is
   `{reconstructed: true, recorded_at: <now>, effective_at: "2026-09-21T21:40:57.580902Z",
   from: "unknown", to: "approved", actor: "unknown", merchant_action: false,
   probable_source: "scripts/sql/_schedule_approve.sql", evidence: [the four confirmed
   points above], inference: "file matches the id set; execution unrecorded"}`. The
   `EventType` union gains the new type. Prod's `audit_events_actor_type_check` already
   admits `script` (verified 2026-09-23). The rows are written only when the maintainer
   chooses to run the reconstruction, as its own reviewed step.
2. **Ops scheduling goes through the route** (or a script that calls `logAuditEvent`
   with `actor_type = 'script'`), never a bare `UPDATE`. `_schedule_approve.sql` is
   retired in favour of that path.

**What §7.6 of the contract asks for is a second, optional authority.** *"If approval
covered exact wording, a material rewrite requires renewed approval."* No approval in
this system has ever covered exact wording, so the rule has nothing to act on today. If
the product adds it (§11 Q-6), it is a **new** record, `document_approval`, separate from
`review_state`:

| pinned | column | what it catches |
|---|---|---|
| the artifact the merchant read | `defence_packages.id` **+ `version`** | a regenerated package, byte-different, same evidence |
| the argument they approved | `plan_input_hash` **+ `plan_policy_version`** | a re-selected strategy, a narrowed claim set, a policy bump |
| the facts underneath | `evidence_hash` | new or corrected evidence |

plus `approved_at` and the approving actor. An evidence hash alone is the wrong anchor:
wording and strategy can change materially with the evidence untouched, and
`evidence_hash` moves for none of those.

**Migration and invalidation, stated explicitly:**
- **No migration of existing rows.** The 17 current `approved` disputes (6 by the route,
  11 by the operator write) are scheduling authorities. They are **not** converted into
  document approvals, because no document was ever pinned and inventing a pin would claim
  an approval nobody gave.
- **Nothing is unscheduled automatically.** A rebuild, a hash change or a policy bump
  never clears `review_state = 'approved'`. Scheduling authority covers the current
  valid package by construction, which is what the route promised when it was clicked.
- **Invalidation applies only to a `document_approval`.** When any of its three pins
  moves, the document approval lapses. The merchant is told, and the dispute falls back
  to its scheduling authority, if any. It does **not** fall to silence: under the
  Stance, a lapsed wording approval never becomes a skipped filing.
- A content-identical rebuild (§9.3) moves no pin and invalidates nothing.

**P0's rebuild instructions follow from this.** Rebuilding Cases A and B (§4.1(g)) needs
no re-approval: A is auto mode (no approval involved) and B holds scheduling authority,
which covers the rebuilt package. The rebuild is a system re-enqueue, not a manual letter
edit (§11 Q-1b).

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
| build failed; a prior artifact **disagrees** with a known fact (delivery, return, cancellation, correction) | **that artifact: never** | the minimal verified response instead (below). A known contradiction blocks the artifact even as a fallback — the contract's §7.6 rule, and rev 1 already stated it at §9.6 |
| build failed; no prior artifact agrees | **no prior artifact** | the deterministic factual fallback of §9.6, built from the current verified snapshot — not a resurrected old one |
| the source is `unavailable` **and** the case has no verified facts at all | **yes, minimally** | the minimal verified response (§9.9). Rev 2 ended this row at `no_bank_eligible_facts`; decision D-1 (2026-09-23) makes the minimal verified response the floor for every dispute, so silence is no longer an outcome |

"Not eligible" in this table refuses **an artifact**, never the filing. Under D-1 every
row ends in something filed. What varies is which artifact, and the rules below decide
it.

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

### 9.9 The minimal verified response — the contract this plan consumes

§4.1(b), §9.8 and test 19 depend on a "minimal verified response". Rev 4 pointed at
`merchant-counsel-stance.plan.md` §4.3, which lives on PR #767 (branch
`docs/merchant-counsel-stance`, **open, not merged**) and not on this PR's branch. So the
contract is reproduced here, where it can be reviewed with the plan that depends on it.

**Desired policy vs shipped behaviour. They differ today, and this plan must not blur
them.**

| | today, in code | desired (decision D-1, 2026-09-23) |
|---|---|---|
| no bank-included fact (gate G1) | `markSkipped(no_bank_eligible_facts)`: **no document** (`buildDefencePackageJob.ts:362`, `:1484`) | a minimal verified response is built and filed |
| plan has no safe argument (G3) or no bank-included plan fact (G4) | skipped, no document (`:467`, `:494`) | same: minimal response |
| fatal-loss (G2) | skipped (`:459`), auto mode blocks | minimal response; fatal-loss becomes a merchant-only risk signal (PR #767 §3.1) |
| chargeback we don't answer | Shopify files its own scrape (`[[project_shopify_files_anyway_reframes_guards]]`) | ours replaces it (D-1) |
| inquiry we don't answer | lost by default (PR #767 §2.1: 5 + 6 non-receipt inquiries lost unanswered) | ours is filed |

**The contract (what a minimal verified response is):**
1. Deterministic. No LLM. It is built by the existing fallback composition path (the
   deterministic fallback of §9.6), not by a new renderer.
2. It contains only facts that are true, sourced and bank-citable **for this case**:
   the order record, the helpful authorisation facts, and any dispatch / carrier facts
   that pass §4.1(b) and §6.1. Each fact carries its own as-of date.
3. It never contains a claim whose source was unread or failed (§9.8), a prior artifact
   that disagrees with a known fact, or anything the harmful-material filter excludes
   (§4.1(e)).
4. It passes the same validators as any package (`validateNarrative`,
   `validatePackageDocument`, the shipment-scoped guards of §4.1(b)).
5. It is recorded as `package_kind = minimal_verified`, so outcomes can be measured
   separately and the merchant is told a minimal response was filed.

**Owner, prerequisites and release order.**
- **Owner:** PR #767's phase C (`merchant-counsel-stance.plan.md` §6). No engineer is
  assigned yet; like this plan's own header, the owner field reads *unassigned* until
  the maintainer assigns one.
- **Prerequisites:** PR #767 merged to `develop`; §4.1(b)'s citability exception and
  §4.1(f)'s per-shipment facts (so the minimal response can cite a shipment correctly);
  §9.8's eligibility rules.
- **Release order:** (1) this plan's P0 ships **without** relying on the minimal
  response; (2) PR #767 phase C ships the minimal response; (3) only then do tests 3c
  and 19's "file the minimal response" expectations become **release gates**. Until step
  (2), those tests assert today's behaviour (a skip, recorded loudly to the merchant) and
  are marked as pending the new contract.
- **Consequence for the live cases:** Cases A and B do **not** depend on it. Case A's P0
  path is the citable in-transit fact (§4.1(b)), and Case B has a carrier-recorded
  delivery.


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
3b. **End to end (§4.1(b)).** Case A's inputs, `no_return_initiated` excluded by (a),
   GOFO `IN_TRANSIT` → passes G1, G3 and G4 (`buildDefencePackageJob.ts:362`, `:467`,
   `:488-495`), `validateNarrative`, `validatePackageDocument` and the deadline
   selector's eligibility, and ends as a fileable draft citing carrier, tracking and
   in-transit status. Case strength is unchanged: the fact stays `supporting`.
3c. Same fixture, shipment at `label_created` → the fact is not bank-citable, and no
   carrier-possession phrase survives any layer (guarded by
   `shipment_in_carrier_possession`).
3d. A `supporting` fact of any other field → still not bank-eligible. The exception is
   not general.
3e. **Shipment-scoped guard, negative (§4.1(b), rev 5).** GOFO `YT2640221437435982` is
   `IN_TRANSIT` and citable; USPS `260914OET4` is label-only or a batch reference. A
   narrative sentence *"USPS shipment 260914OET4 is in transit"* → **refused**, although
   another shipment satisfies `shipment_in_carrier_possession`. The same sentence naming
   GOFO → passes. A transit sentence naming no shipment, on this two-shipment order →
   refused as ambiguous.
4. **Internal refund-request constraint (§4.1(c)).** A stored **customer** message
   requesting reimbursement, `review_status = proposed`, category `contradiction`, on a
   `confirmed_match` ticket → any sentence denying a refund request is refused at the
   narrative, thesis, fallback and document layers. Pairs: the same message on a
   `rejected_match` ticket, or on a `proposed_match` ticket below `high` confidence →
   no constraint; the same text sent by the merchant → no constraint. In every case the
   message text appears in **none** of: the narrative-writer input, `facts_json`, or the
   PDF blocks.
5. The same order with **no** support thread → still a dated shipment narrative.
6. Label created, no carrier event → `label_created`; carrier `IN_TRANSIT` →
   `in_transit`; delivered → `delivered_confirmed`. **Three distinct claims.**
6a. **Shipment identity (§4.1(f)).** `fulfillments[]` = [USPS `260914OET4` FULFILLED,
   GOFO `YT2640221437435982` IN_TRANSIT] → two facts, and the cited shipment is GOFO,
   with its own number and status.
6b. The same two **reversed** → the same cited shipment, the same facts per
   `instanceKey`, the **same positional fact ids** (stable emission order), and the
   **same `evidence_hash`** (record-key sort in `computeEvidenceHash`, §4.1(f) item 3).
   The test fails on today's code, which sorts by positional `fact.id`, and must be shown
   failing first.
6c. One parcel `Delivered` (with `deliveredAt`) + one `IN_TRANSIT` → two facts, each with
   its own dates. No sentence attributes the delivery to the in-transit parcel or the
   reverse, and order-level delivery language appears only when `coverage = complete`.
6d. `planForCase` maps each shipment record to **its own** fact by `recordId`, not to the
   first fact of the field.
7. **Hashing (§5.3).** An unchanged re-read with a new `carrierStatusObservedAt` → the
   **same** `evidence_hash`. An **unadapted** shipment whose Shopify `fulfillment_status`
   changes → the hash moves (§5.3(1)); today it does not. A status reversed by a
   correction → the hash moves. In P4, a new scan with the state unchanged → the hash
   moves via `lastEventFingerprint`.
7a. `VALIDATOR_VERSION` 5 and `PLAN_POLICY_VERSION` 2 → a draft built under 4 / 1 is
   marked stale on its next enqueue even with an unchanged `evidence_hash`
   (`enqueue.ts:275-314`).

**P1**
8. `delivered_confirmed` (a carrier-sourced delivery failing some QFD condition), no
   signature, no other signal → case is `moderate`, **not** `weak`.
8a. **`DeliveredToPickup` / `READY_FOR_PICKUP` alone → case IS still `weak`** (§6.1).
   Pickup availability is not collection, and this test guards against a future widening
   of `confirmedReceipt` promoting a pending pickup into a receipt claim. Its pair:
   `CollectedAtPickup` **without** a timestamp → supporting, still weak.
8b. **PostNord regression fixture (§6.1.2), Case B's exact Shopify events.** Truncated
   after `READY_FOR_PICKUP` 2026-09-17 09:24:18Z → **no** QFD, case `weak`. With
   `DELIVERED` 2026-09-18 16:23:00Z (*"Försändelsen har levererats."*) → QFD,
   `delivered_final_verified`, signal `strong`, case **`strong`**. The service-point name
   persisting as the location does not block it. In both states the letter names no
   collector and asserts no identity check.
8c. **QFD conditions, one negative each.** No carrier event text on a `shopify_native`
   `DELIVERED` (merchant-settable) → `delivered_confirmed`, `moderate`. No event
   timestamp → not QFD. Tracking identifier fails `isParcelIdentifier` or belongs to
   another fulfillment → not QFD. `coverage = partial` → `moderate` at most. A second
   record on the same goods says `Returned` / `NOT_DELIVERED`, or a correction reverses
   the delivery → QFD removed, `moderate` at most, until a newer record resolves it.
8d. **Not contradictions.** Delivery later than the merchant's published window, or a
   customer message restating non-receipt → the QFD and `strong` stand.
8e. **Filing timing is unchanged (§6.1.4).** An auto-mode INR case whose only route to
   `strong` is a QFD → `hold_for_deadline` (the temporary named branch), not
   `auto_file`. `decisionLadder.test.ts:345` (`moderate` holds) still passes. A case
   reaching `strong` by any pre-existing route keeps today's `auto_file`.
9. `in_transit` alone → case **is** weak, and the in-transit explanation renders
   (not `weak.moderateOnly` over an unrelated fact).
10. One moderate label → the strength sentence is grammatical.
11. A `CollectedAtPickup` shipment with `signed_by_name = null` → no string, in merchant
    copy **or bank prose**, asserts an actor or an identity check. "Collected by the
    cardholder / customer / recipient" and "the cardholder has the goods" are refused;
    "PostNord records the shipment as collected at the pickup point on {date}" passes.
    With a signer name present, "signed for by {name}" passes, and "the cardholder
    signed" / "identity verified" are still refused.
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
17. Delivery event post-dating the filing → the delivery leads the letter; the filing
    date is **not** cited; nothing states or implies that delivery preceded the dispute.
    **Case B is the live fixture** (filed 13 Sep, dispatched 16 Sep, collected 18 Sep).
18. Carrier read fails near the cutoff → last verified evidence with its as-of date;
    no implication that a fresh check succeeded; no fabricated absence. **Rev 2: per
    §9.8, the artifact is eligible only if it makes no claim depending on the unread
    source** — an artifact asserting delivery behind a failed delivery read is refused.
19. Forced final refresh runs with no status change; a failed final build files the
    verified fallback within the deadline — **and, §9.8, never a prior artifact that
    disagrees with a known fact. A rebuild failure must not make a stale package
    eligible.** Paired negative: prior artifact claims delivery, a correction has since
    reversed it, build fails → the stale artifact is **refused**, the minimal verified
    response (§9.9, decision D-1) is filed in its
    place, and the merchant sees an explicit blocker note.
20. **Only a `document_approval` is invalidated (§9.5, if Q-6 builds it).** Three
    independent triggers, one test each: package version moves; `plan_input_hash` or
    `plan_policy_version` moves with the evidence untouched; `evidence_hash` moves. On
    lapse the dispute falls back to its scheduling authority and still files. Negative: a
    content-identical rebuild invalidates nothing.
20a. **Scheduling authority is never cleared by a rebuild.** `review_state = 'approved'`
    survives every rebuild, hash change and version bump, and the deadline cron files the
    current valid package.
20b. Every write of `review_state` produces exactly one `review_*` audit row with the
    actor and `{from, to}`, including script-driven scheduling (`actor_type = 'script'`).
20c. **Reconstructed history is labelled as such (§9.5).** A `review_state_reconstructed`
    row carries `reconstructed: true`, `merchant_action: false`, `from: "unknown"`,
    `actor: "unknown"` and `actor_id = NULL`, and is never counted, rendered or reported
    as a `review_approved` click (merchant timeline, admin views, post-outcome analysis).

**Release criteria** (contract §9, adapted per §12.4 item 6): every factual claim true and traceable to a source; no fact that helps the cardholder in any bank artifact (the §8.1 harmful-material filter, both layers);
no no-return INR rebuttals anywhere in the book (Q12 = 0); no customer complaint
mislabelled as a contradiction by the tested inference; correct output with no
support inbox connected; and **no win-rate promise before submitted outcomes mature**.

---

## 11. Decisions

### Decided

**Q-1b · Case B, before 2026-10-01 (§0.2). Decided (maintainer, 2026-09-23): no manual
edit; P0 only.** It files on 1 October under its existing scheduling authority (§9.5),
and it should: the carrier-recorded collection is its defence. P0's rebuild removes the
no-return-implies-receipt clause and replaces the raw `CollectedAtPickup` enum with the
carrier's record: *"PostNord records the shipment as collected at the pickup point on
18 September"*. Nothing about who collected (§6.3). Nothing is added. Cay's delivery
window and refund clause stay out (§0.4); they are already absent, and P0(e) keeps them
out. Hard schedule: **P0 (at least (a), (c), (f), (g) and the §6.6 enum rule) on `master`,
and Case B re-enqueued, before 2026-10-01 08:00 UTC.** If P0 misses that, Case B files as
written today, with its correct core and the two harmful sentences.

**Q-3 · Case A's two shipment legs. Resolved by design in §4.1(f).** The cited shipment
is chosen per fact by §4.1(b)'s conjuncts, never by position. `USPS 260914OET4` fails the
carrier-specific identifier check (PR #758 batch reference) and is `FULFILLED`, not in
transit, so it is never cited as a parcel. `GOFO YT2640221437435982` is cited. The two
are not presented as related, because nothing in the data establishes the relationship
(contract §7.10).

**Former Q-2 · withdrawn: its premise was false (§4.2).** P1's `weak → moderate`
re-rating does not change filing behaviour. `moderate` holds for the deadline
(`deriveCaseAutomationDecision.ts:305-306`, pinned by `decisionLadder.test.ts:345`). No
approval, cohort gate or flag is needed.

### Open

**Q-1 · Case A, before 2026-10-03 (§0).** P0 in full ((a)–(g)), then re-enqueue and read
the letter before 3 October. The only open question is route: does P0 reach `master` by
the normal develop → master promotion in time, or does it need a subset promotion
(`[[reference_subset_prod_promotion]]`)? Case B's 1 October deadline sets the real
date, so this resolves with Q-1b's schedule.

**Q-4 · P3 sequencing.** The delivery-commitment resolver is the largest source of
*new* winnable arguments (premature filing) and the least urgent. Before or after P4?

**Q-5 · Fulfillment-order read scopes (§8 pt 1, §8.1.1).** The only structured source of
the checkout delivery promise returns `ACCESS_DENIED` today. Adding
`read_merchant_managed_fulfillment_orders` (plus `read_third_party_fulfillment_orders`)
means every merchant has to re-consent. Request them now, or rely on the published
policies alone (§8.1) until that check shows how often a structured promise would have
changed the outcome?

**Q-7 · Let QFD-only `strong` cases auto-file (§6.1.4).** P1 rates them `strong` but
holds their filing date through a temporary ladder branch. Removing the branch means
auto-mode INR cases with a qualified final delivery file at their next decision point
instead of on the deadline. Measured 2026-09-23 (Q19): **1** open case would move
(blume-box #352543, due 3 Oct); every review-mode case is unaffected. Remove the branch,
keep it, or remove it per shop? To be decided with the then-current set printed.

**Q-6 · Document-specific approval (§9.5).** Build the optional exact-document approval
now (P1), or defer until a merchant asks to approve wording rather than schedule
filing? Existing scheduling approvals are unaffected either way.

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
- **Who instructed the 2026-09-21 operator scheduling write** (§0.2, §9.5). The write
  itself is established: one `UPDATE` at 21:40:57 UTC from `scripts/sql/_schedule_approve.sql`.
  Whether each of its 12 disputes was individually agreed with the merchants is not
  recorded anywhere we can read.
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
6. **Disclosure that helps the cardholder is overridden by the Stance.** The contract
   asks for a dispatch delay to be "stated without excusing it" (§7.9 specimen), for
   both the filing date and the delivery date to appear whenever delivery post-dates
   the dispute (§7.8), and for the letter never to present later delivery as answering
   the complaint. The maintainer's directive of 2026-09-23 is that we are the merchant's
   counsel. Harmful facts are omitted, never stated. Later delivery is argued from the
   carrier's record of delivery or collection, with its date, and never names who
   received it (§6.3). The contract's one rule that
   survives intact is **no false statement**, which the Stance keeps as rule 3.
