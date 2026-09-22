# Returned-parcel blindness: tracking-app delivery signals

Status: **PHASES 1-3 DELIVERED (rev 6, 2026-09-16). Phase 2 is unwired by design.
Phases 4 and the freshness work (§8.1) are NOT started and need a decision first —
see §0.**
Origin: dispute `4b81afe1-7f7b-4908-aa25-dad6c8df3922` (shop `6a8848-dd`, order #98141)

## 0. Where this stands — READ FIRST

### Shipped to production (`master`, 2026-09-16)

| what | PR | effect |
|---|---|---|
| Rolling deadline window | #736 | Deadlines before 08:00 UTC are reachable. Was silently unreachable for 321 prod disputes. |
| Consolidator identification (10 slugs) | #737 | YunExpress et al. now emit the unsupported-carrier demand signal instead of vanishing. **Fixes no case** — buys visibility. |
| Delivery status in `evidence_hash` | #737 | A `Delivered → Returned` change now moves the hash **by construction**, including on multi-shipment orders where `proofType` does not move. |
| These plan documents | #738 | — |

Promoted via #739 with per-change approval. No migrations.

### On `develop`, NOT in production

**Phase 2 — the ParcelPanel source (#740).** The mapper, the fetch layer with its
three-outcome contract, the measured pacing, and the `isTerminalEvidenceSource`
integration point. Fully tested against real payloads, including an end-to-end
assertion that the returned-to-sender gate fires on the real #98141 timeline.

**WIRED 2026-09-17.** `resolveShipments.ts`'s `unsupported_carrier` branch now asks
the tracking app before giving up, bounded at 3 lookups per order and honouring the
three-outcome contract.

An earlier revision of this section called the wiring *blocked* on §8.1. **That was
wrong, and worth recording as a correction:** reading a delivery signal and *filing*
on one are different risks. A `Returned` signal only ever makes automation stricter —
the returned-to-sender gate caps strength at `weak` and blocks auto-submit, so a
false positive costs a missed auto-submit, never a bad filing. §8.1 governs whether a
*stale* signal may be filed on, which is genuinely separate and still open. Treating
a sequencing choice as a dependency delayed the fix by a day, during which the
2026-09-17 alert arrived for a live case (#99277) the pipeline still could not see.

### What is NOT done, and what blocks each

1. **Submission-time freshness (§8.1).** Still open, still needs question 7's schema
   decision. It does NOT block anything already shipped — the wiring only ever ADDS
   knowledge; it removes no guard.
2. **Submission-time freshness (§8.1).** Both invariants specified, tests enumerated,
   insertion points identified. Not written.
3. **Phase 4 backfill (§11).** 70 open disputes on unidentified carriers. Pointless
   before (1).
4. **blume-box (§11).** 0% tracking-app coverage across 54,920 unidentifiable rows.
   **No phase here addresses it.** Needs real adapters or a paid aggregator.

### What this work did and did not achieve

**Did:** made the returned-parcel case detectable end-to-end, proved the existing
gate fires once fed, closed a silent scheduling defect affecting 321 disputes, and
made delivery-state drift invalidate a stale package by construction.

**Did not:** fix any dispute that was already open. `4b81afe1` (#98141, EUR 37.90)
was conceded on the evidence. A second dispute surfaced in the process —
`83bc28ad` (#98289, EUR 19.95) — and is a **different failure entirely**: see §0.1.

### 0.1 The second dispute, and what it reveals

Investigating the shared 2026-09-17 03:00 UTC deadline surfaced `83bc28ad` (#98289),
same shop, same carrier, similar amount. It is **not** a returned parcel:

| | #98141 | #98289 |
|---|---|---|
| reason | `PRODUCT_UNACCEPTABLE` | `PRODUCT_NOT_RECEIVED` |
| `status_num` | `2 = Ausnahme` | `2 = Unterwegs` |
| final event | 2026-09-07 `Zugestellt(Rücksendung an Absender)` | 2026-09-16 `im Ziel-Paketzentrum bearbeitet` |
| reality | returned to sender | **still in transit, 32 days, never arrived** |

Note both report `status_num: 2` under different names — one more reason the mapper
walks the event timeline rather than trusting that field (§7.1.1).

#98289 is unwinnable and correctly scored `weak`: for an INR chargeback the argument
is delivery proof, and none exists because the parcel never arrived. **Nothing in
this plan would have saved it.** Neither dispute was actioned further; both were left
per the user's decision.

**The larger finding is a prevention gap, not an evidence gap.** A parcel sat
undelivered for a month and nobody noticed until the cardholder complained. Detecting
stuck in-flight parcels — before they become chargebacks — is plausibly worth more
than winning the disputes they turn into, and is **out of scope here**. Worth its own
plan.

Rev 2 superseded rev 1: the urgent-case set shrank from three disputes to one (§2);
the returned-parcel gate turns out to already exist and already do the right thing
(§6); the cache rule in rev 1 was unsafe and is replaced (§10); a ParcelPanel failure
must be an explicit `unavailable` that blocks auto-filing, not a silent absence (§8);
the endpoint was empirically probed and **does throttle** (§9); and rev 1's
"bank-facing text must never mention the return" is withdrawn as wrong (§6.3).

**Rev 5** answers the fourth review, which granted conditional approval subject to one
proof:
- **The hash-coverage proof was demanded, and the doubt was justified.** Traced the
  inputs end to end: the delivery fact's hashed `value` carries `proofType, carrier,
  trackingNumber, trackingUrl, deliveredAt, signedByName` — **no delivery-status
  field**. `Returned` moves the hash only *indirectly*, via `proofType`. It works for
  #98141, but **fails on multi-shipment orders** where a delivered parcel holds the
  tier. §8.1.1 now specifies adding `deliveryStatus` to the hashed value explicitly,
  with tests 13 and 17 as **rollout blockers**.
- Blast radius of that hash change **measured**: prod has exactly 1 `final` package.
  Regeneration cost is nil; open question 9 resolved.
- **Superseded text removed.** §8.1.1 now carries the single authoritative eligibility
  table; §§8.1.2, 8.1.5 and 10 no longer contradict it; tests renumbered 1-17 and
  rewritten against the current rule.
- #98141: the existing pack **will not be filed** (decided by the user).

**Rev 4** answered the third review:
- **A fresh lookup does not certify an old pack.** Rev 3 checked only
  `last_carrier_lookup_at`, which would have let the worker file a contradictory PDF
  behind a freshly-refreshed shipment. Split into two invariants, with artifact
  agreement decided by the existing `evidence_hash` mechanism (§8.1.1). This also
  surfaces a real cost rev 3 hid: an invalidated package needs LLM regeneration.
- **`Returned`-is-final withdrawn** (§10.1) — it contradicted the latest-by-event-time
  rule and would have locked merchants out of parcels that later arrived.
- **The merchant-override contradiction resolved** (§8.1.6): artifact agreement binds
  everyone; observation staleness is overridable with explicit consent carried on the
  job. The "always enabled button" promise is withdrawn.
- The cron window gap is **split into its own plan** —
  `docs/plans/deadline-cron-window-gap.plan.md` — with 6 currently-open at-risk
  disputes identified, and the 319 figure explicitly reframed as exposure, not losses.

**Rev 3** answered the second review. Material changes:
- Shopify's **live** deadline was queried, not inferred (§2). The response window is
  still open; €37.90 is a real choice. But the cron can no longer reach this dispute.
- That exposed a **latent structural bug affecting 321 prod disputes**: any deadline
  between 00:00 and 08:00 UTC is selected by a cron run that fires *after* it expired
  (§2.2). Tracked separately from this plan's carrier work.
- **Build-time freshness is not enough.** A submission-time freshness check is
  specified with its exact insertion points, including the deadline cron (§8.1).
- "Strongest terminal state" is **withdrawn** and replaced with **latest valid state
  by event time**, with an explicit tie rule (§7.1) — a later delivery or correction
  must not lose to an earlier `Returned`.
- The 1-second pacing figure is **withdrawn as unfounded** (§9.1).

## 1. The incident

A YunExpress parcel was **returned to sender** on 2026-09-07 09:17. The customer
never received it. Nine hours later the cardholder opened a `PRODUCT_UNACCEPTABLE`
chargeback. DisputeDesk built a `moderate` / 44%-completeness pack arguing a generic
not-as-described defence, with `returned_to_sender: {triggered: false}`, and queued
it to auto-file on the deadline.

The tracking data was never missing. ParcelPanel — a tracking app the merchant
installed and pays for — had classified the parcel as `checkpoint_status: "exception"`
/ `Exception_008` since 2026-09-07 and still serves a 30-event timeline on request.
We never read it.

## 2. Urgent cases — VERIFIED 2026-09-16 14:0x UTC

Rev 1 said three disputes were "queued to auto-file". **That was wrong.** Live state:

| dispute | order | amount | due | normalized_status | submission_state | parcel reality |
|---|---|---|---|---|---|---|
| `4b81afe1` | #98141 | EUR 37.90 | **2026-09-17 03:00** | needs_review | `not_saved` | **Returned** 09-07 (`status 2`) |
| `7dc93bdd` | #100094 | EUR 26.96 | 2026-09-22 | submitted_to_bank | `submitted_confirmed` (09-15 08:20) | **Delivered** 09-09 (`status 4`) |
| `c08855d1` | #100094 | EUR 32.90 | 2026-09-22 | submitted_to_bank | `submitted_confirmed` (09-15 07:48) | **Delivered** 09-09 (`status 4`) |

The two #100094 cases were already filed on 2026-09-15, and their parcel
(`YT2624300706784028`) was genuinely **delivered** on 2026-09-09 11:45 — 27
checkpoints ending `Delivered_001`. Those filings were correct. They share the
carrier, not the defect. **No action on them.**

Only `4b81afe1` is affected. Verified facts:

- `evidence_saved_to_shopify_at` = NULL, `submitted_at` = NULL — nothing filed yet.
- Jobs table: the only row for this dispute or its pack is a `build_pack` that
  `succeeded` 2026-09-07. **No queued `save_to_shopify` job.** The sole path to
  filing is the deadline cron.
### 2.0 Shopify's LIVE deadline — queried 2026-09-16 17:23 UTC

Rev 2 reasoned about `due_at` from our own DB. The review correctly asked whether a
response is still possible at all. Queried Shopify Admin REST directly
(`shopify_payments/disputes/14456389966.json`, via the shop's offline token):

```
status                 needs_response
reason                 product_unacceptable
evidence_due_by        2026-09-17T05:00:00+02:00   (= 03:00:00 UTC)
evidence_sent_on       NULL
finalized_on           NULL
amount                 37.90 EUR
```

And `dispute_evidences.json`: `submitted_by_merchant_on = NULL`, evidence row last
touched 2026-09-07.

**Conclusions, now evidence-backed rather than inferred:**

1. **The window is open.** Shopify says `needs_response`, nothing sent, nothing
   finalized. As of 17:23 UTC there are ~9.6 hours left.
2. **Our `due_at` matches Shopify exactly** (03:00 UTC). No drift.
3. **€37.90 was a genuine live choice** at the time of writing — filing something
   correct was still possible manually before 03:00 UTC. **Now decided: not filed**
   (§2.4).
4. **But the cron can no longer reach it** — see §2.2. Nothing would have filed
   automatically. The practical default, absent a manual action, was already
   "no response filed".

### 2.2 A latent structural bug this exposed — SPLIT OUT to its own plan

Replaying the cron's own window arithmetic (`route.ts:122-126`) against both
candidate runs:

| run (UTC) | window | due in window? | due already past at run? |
|---|---|---|---|
| 2026-09-16 08:00 | [09-16 00:00 .. 09-17 00:00) | **no** | no |
| 2026-09-17 08:00 | [09-17 00:00 .. 09-18 00:00) | **yes** | **yes — by 5 h** |

So the Sep 16 run could not see it, and the Sep 17 run *will* select it and attempt
to file **five hours after expiry**. The comment at `route.ts:119-121` ("due today or
before tomorrow's 08:00 UTC") describes an intent the code does not implement: the
window is a calendar day, not a rolling 24 h from the run.

This is not specific to YunExpress. Any deadline between 00:00 and 08:00 UTC is
structurally unreachable. Measured in prod:

| due hour UTC | disputes | never filed |
|---|---|---|
| 00–02 | 5 | 0 |
| **03** | **321** | **319** |
| 04–07 | 37 | 35 |

03:00 UTC is the second most common deadline hour in the whole book (after 23:00,
n=600). **Scope honestly:** of those 321, 201 were `won` and only 71 `lost`, so most
are inquiries Shopify resolved without us — the realised damage is far smaller than
319 suggests. But the mechanism is real and silent, and a high-value chargeback
landing on an 03:00 deadline would be forfeited by default.

**This is a separate defect from the carrier blindness, and it now has its own plan:
`docs/plans/deadline-cron-window-gap.plan.md`.** That document supersedes this
section; it adds the identical defect in the 06:00 **rebuild** cron (so an
early-morning deadline gets neither a rebuild nor a submit), the proposed rolling-
window fix, and the **6 currently-open at-risk disputes (EUR 281.47)**.

Two corrections to the framing above, carried into that plan:

- **"319 never filed" is exposure, not losses.** Of the 321: 201 `won`, 71 `lost`,
  6 open. Most are inquiries Shopify resolved without merchant evidence. The
  counterfactual "we would have won these" is unsupported and must not be claimed.
- **One of the two disputes due tonight is unrelated to this plan.** `83bc28ad`
  (#98289, EUR 19.95, due 2026-09-17 03:00) is `review_state = NULL` with no
  returned-parcel involvement — an ordinary dispute that will simply never be filed.
  It has **not** been investigated and may be perfectly filable. That is the cleanest
  evidence the two defects are independent.

Fix the cron gap regardless of what is decided about `4b81afe1` or Phases 1-4.

### 2.1 Proposed production action — FOR APPROVAL, NOT YET EXECUTED

Single write, via the existing product API rather than raw SQL so the audit trail
and `needs_attention` clearing happen the normal way:

```
POST /api/disputes/4b81afe1-7f7b-4908-aa25-dad6c8df3922/review
{ "action": "concede" }
```

Exact consequences, read from code:

- `review_state` NULL→`conceded`; `needs_attention` cleared
  (`app/api/disputes/[id]/review/route.ts:88-96`).
- Deadline cron hits `if (d.review_state === "conceded") { summary.scanned--; continue; }`
  at `defence-package-deadline-submit/route.ts:204` — returns **before** the pack
  lookup and before any submit path. No evidence is sent.
- `isTerminalReviewDecision` → true, so it leaves the actionable queues and reads
  "Not defended" in history (`lib/disputes/reviewState.ts:72`).
- An audit event `review_conceded` is written (route.ts:121).
- **Billing is NOT refunded** — the pack credit was consumed at build, an explicit
  2026-07-23 decision (`reviewState.ts:19-22`).
- **Reversible**: `{ "action": "clear" }` sets `review_state` back to NULL.

Cost: forfeits EUR 37.90. Rationale: the parcel came back, so the current pack's
not-as-described argument is contradicted by the merchant's own tracking.

### 2.3 Recommendation, revised in light of §2.0 and §2.2

Rev 2 framed concede as "stop the cron before it files". **That framing is now wrong:
§2.2 proves the cron will not reach this dispute before expiry.** The outcome without
any action is already no-response. So conceding does not *prevent* a bad filing here —
it records the decision honestly and clears the dispute from the actionable queues.

That makes this a lower-stakes call than rev 2 implied, and the honest options are:

- **Concede** (recommended). Records the true position, costs the €37.90 that is
  already effectively lost, and is reversible. Low value, but accurate.
- **Do nothing.** Same financial outcome. Leaves the dispute sitting in queues as if
  actionable, and leaves the misleading `approved` state implying we intended to file.
- **Contest manually before 03:00 UTC.** Only defensible with a *correct* argument.
  The current pack argues not-as-described and is contradicted by the tracking, so
  filing it as-is would be worse than not filing. A correct returned-parcel argument
  needs the merchant's `parcel-outcome` answer (why it came back) — which we do not
  have and cannot obtain in 9 hours without asking them.

**DECIDED (2026-09-16, by the user): the existing pack will not be filed.** Executed
as `{ "action": "concede" }` on `4b81afe1` — the one state that both prevents filing
and leaves the record matching reality. See §2.4 for the execution record.

### 2.4 Execution record — DONE 2026-09-16 17:58 UTC

Applied to prod (guard confirmed `aokhplydttxtebvbeuzc`):

```sql
update disputes set review_state='conceded', needs_attention=false, updated_at=now()
 where id='4b81afe1-…' and evidence_saved_to_shopify_at is null and submitted_at is null;
```

Result: `review_state=conceded`, `needs_attention=false`, `submission_state=not_saved`,
`due_at` unchanged. An audit event `review_conceded` was inserted
(`3e5f506c-3101-496d-a6f5-d462fc49a657`) recording the reason, the decision source and
this plan, since the write went through SQL rather than the API route.

**Verified the block, two ways.** Replaying the cron's own selection query
(`route.ts:158-165`) for the 2026-09-17 08:00 UTC run now returns **zero rows** — a
`conceded` dispute fails the `review_state = 'approved'` clause, so it is not even
selected, and the per-dispute check at `route.ts:204` is a second line of defence it
never reaches.

Reversible with `review_state = NULL` (the API's `clear` action) if the merchant wants
to contest before 03:00 UTC. Note the EUR 37.90 was already effectively lost — the
cron could not have filed it either way (§2.2).

## 3. Measured blast radius (prod, 2026-09-16)

Carrier identification, measured by replaying the `KNOWN_CARRIERS` regexes from
`lib/carriers/registry.ts` over all 508,858 tracking rows:

| slug | rows | % |
|---|---|---|
| UNIDENTIFIED | 199,661 | 39.2 |
| ups | 133,979 | 26.3 |
| dhl | 116,736 | 22.9 |
| usps | 54,774 | 10.8 |
| fedex | 2,485 | 0.5 |
| postnord | 1,127 | 0.2 |
| dpd / colissimo / postnl | 96 | 0.0 |

Top unidentified: `YunExpress` (104,262), `Other` (28,822), `UPS2` (19,931),
`(null/empty)` (16,609), `Canada Post` (5,414), `SUNYOU` (4,082), `Intelcom`
(3,916), `Stallion Express` (3,726), `ICS` (2,093), `APS` (1,880).

**Open disputes on unidentified carriers: 70** (66 `6a8848-dd`, 3 blume-box,
1 cay-collective); 39 due within 7 days.

Tracking-app coverage:

| shop | ParcelPanel | 17track | no URL | total |
|---|---|---|---|---|
| 6a8848-dd | 131,725 | 3,308 | 8,587 | 144,691 |
| blume-box | 0 | 0 | 8,409 | 361,508 |
| cay-collective | 0 | 48 | 38 | 2,659 |

Of `6a8848-dd`'s 144,686 unidentifiable rows, **93.3% carry a tracking-app URL**.
blume-box: **0%**.

### 3.1 A measurement trap

`carrier_normalized` is **not** an identification flag. It is written only by
`lib/carriers/lookupCache.ts:126` after a *successful adapter lookup*. Only 65 rows
in prod have it set, all DHL. Querying `carrier_normalized IS NULL` reports 99.99%
unidentified and is **wrong**. Identification is computed inside `detectCarrier` and
never persisted. Use the regex replay.

## 4. Root cause

**4.1 YunExpress is not in `KNOWN_CARRIERS`** (`registry.ts:29-46`) → `detectCarrier`
returns `unknown_carrier` → `resolveShipments.ts:164` logs and `continue`s. Silent.

**4.2 Registration alone fixes nothing.** Registered, the outcome becomes
`unsupported_carrier` → `resolveShipments.ts:173` sends a demand-signal email and
**also `continue`s**. `ADAPTERS` holds only `dhl`. Both paths end without a signal.
Adding carrier names buys observability, not correctness.

**4.3 The tracking-app reader exists and is starved.** `lib/shopify/trackingApps.ts`
already supports a `parcelpanel` namespace (line 94) with `Exception`/`AttemptFail`
in its vocabulary (line 42). `existingSignalsFor` (`fulfillmentSource.ts:144`) then
discards all but one status:

```ts
if (tracking.deliveryStatus === "Delivered") { ...push signal... }
```

**4.4 And the metafields are empty — VERIFIED.** Probed #98141, #102313, #99518,
#102423 on `6a8848-dd` via live Admin GraphQL: each carries exactly one order-level
metafield, `aftersell_public.post_purchase_status`. ParcelPanel writes **none**.
Also `Fulfillment` has no `metafields` field in API 2026-01 (`undefinedField`), so
the fulfillment half of `readTrackingForFulfillment` can never return anything.

So fixing 4.3 alone also fixes nothing. The reader is not mis-filtered, it is unfed.
The only source holding this data today is ParcelPanel's HTTP endpoint.

## 5. Phase 1 — registration (0.5 day)

Add to `KNOWN_CARRIERS` + the `CarrierSlug` union: `yunexpress`, `sunyou`,
`cne_express`, `4px`, `yanwen`, `cainiao`, `canada_post`, `intelcom`,
`stallion_express`, `purolator`.

Out of scope: `Other`, `(null/empty)`, and `UPS2`/`FEDEX2`/`FEDEXAPI` (fulfillment-
service artefacts). `UPS2` may belong in the `ups` regex — verify tracking-number
format first.

Changes no decision, only observability. No flag.

## 6. Phase 3 (moved up) — the gate ALREADY EXISTS

Rev 1 proposed building a `parcel_returned` gate. **It is already built**:
`lib/automation/returnedToSender.ts`, created for cay-collective #13195 — a DHL
Freight parcel returned 2026-07-06, scored MODERATE, drafting an argument that no
refund was owed. Structurally the same bug as #98141.

It already does what the review asked for:

- **distinct from fatal-loss** — its header argues explicitly why ("fatal-loss means
  there is no factual basis to defend… that is too strong here, and saying it would
  be its own kind of dishonesty");
- **caps `overall` at `"weak"`**;
- **blocks auto-submit and the deadline filing** (`autoSubmitGuards.ts:149`);
- **conjunct on unrefunded**, so a refunded return falls to the refund gates;
- ordering: coverage > fatal-loss > this > ordinary scoring.

### 6.1 The one missing link

The gate consumes `returnedToSender: boolean`, defined by `hasReturnedToSenderShipment`
(`lib/packs/contradictionGate.ts:162`), which reads `proofType === "returned_to_sender"`
or per-fulfillment `carrierTracking.deliveryStatus === "Returned"`.

`carrierTracking` is populated at `fulfillmentSource.ts:311` **only when `carrierWon`**,
and `carrierWon` is:

```ts
const carrierWon = !!state.current && state.current.source.startsWith("carrier_api");
```

**A signal with `source: "tracking_app_parcelpanel"` would reconcile correctly and
still not populate `carrierTracking` — the gate would stay dark.** This is the
precise integration point and rev 1 missed it. Phase 2 must either emit a source
prefix that satisfies this test or widen the test deliberately. Widening is
preferred, with a named predicate (`isTerminalEvidenceSource`) covering
`carrier_api*` and vetted tracking-app sources, so provenance stays visible in
`trackingSource` and nothing is disguised as a carrier POD.

### 6.2 Verify, do not assume

The gate's downstream behaviour is asserted from reading, not from a run. Phase 3
work is therefore: wire the input, then **confirm on a rebuild of #98141** that
`returned_to_sender.triggered` becomes true, `overall` drops to `weak`, auto-submit
blocks, and the `no_return_initiated` contradiction suppression fires
(`contradictionGate.ts:137-141`) — that last one matters, because the current pack
asserts `no_return_initiated: present` while the parcel was coming back.

### 6.3 Withdrawn: "never bank-facing"

Rev 1 said bank-facing text must never mention the return. **That was wrong**, and
the existing module is more careful than rev 1 was. The correct rule is the one the
module already implies: the response must be **accurate and supported by evidence**.

A returned parcel is not automatically fatal. Klarna's own merchant documentation
(cited in the module header) says a parcel refused or left uncollected and sent back
"is not a valid use of the right of withdrawal… nor is it considered a valid return"
and asks merchants to say exactly that. There IS an argument; it is narrow and
depends on *why* the parcel came back — which only the merchant knows, which is what
`app/api/packs/[packId]/parcel-outcome` asks.

So: bank-facing copy may state the return **when the merchant has supplied the
reason and the evidence supports it**. What it must not do is assert delivery, or
assert a return reason we inferred rather than were told. The existing
`messageToken` stays merchant-facing; any bank-facing sentence must come from the
merchant's `parcel-outcome` answer, not from the carrier read alone. This mirrors
the 3DS rule: never auto-write an inferred fact into bank-rebuttal text.

## 7. Phase 2 — the ParcelPanel signal source (3-4 days) — THE ACTUAL FIX

New `lib/carriers/trackingApps/parcelPanelSource.ts`, a peer of the carrier adapters.

Request (verified working 2026-09-16):

```
GET https://<shop-domain>/apps/parcelpanel/api/v2/tracking-info
    ?track_number=<tn>&order=&email=&shop=<shop-domain>&lang=en&country=<cc>
Headers: browser-shaped User-Agent, Accept, Referer + Origin on <shop-domain>
```

Note `shop` takes the **custom domain** (`meinmaison.de`), not the myshopify domain.
The path is the Shopify app proxy; `pp-proxy.parcelwill.com/api/` direct returns 403.

### 7.1 Status mapping

Map from `trackinfo[].checkpoint_status` + `substatus`, walking chronologically:

| observed | → | note |
|---|---|---|
| `exception` / `Exception_008` + `Rücksendung`/`Rückgabe an Absender` | `Returned` | the #98141 case |
| `delivered` / `Delivered_001` | `Delivered` | |
| collection at servicepoint | `CollectedAtPickup` | distinct from `Delivered` |
| `undelivered` / `FailedAttempt_*` | `DeliveredToPickup` **only** with a pickup location; else no signal | |
| `transit`, `blank`, `info_received`, `pickup`, `InTransit_*`, `OutForDelivery_*` | no signal | in-transit is never a negative |

Two traps found in the real data:

1. **`substatus` is often empty** (91 of 349 sampled events). Never key solely on it;
   fall back to `checkpoint_status`, and treat an unrecognised pair as *no signal*.
2. **Identical timestamps with different statuses.** #98141 has `undelivered/FailedAttempt_001`
   and `exception/Exception_008` both at `2026-08-31 11:17:41`. `reconcileDeliveryState`
   breaks ties by preferring `carrier_api` sources, which does not disambiguate two
   signals from the *same* source. The source must therefore emit **one** signal per
   shipment.

### 7.1.1 Selection rule — LATEST VALID STATE BY EVENT TIME

Rev 2 said "the strongest terminal state in the timeline". **Withdrawn — that was
wrong**, and the review is right about why: a parcel can be `Returned` at T1 and then
corrected, redelivered, or collected at T2. Ranking by severity would pin it at
`Returned` forever and ignore the later truth. That is the same no-downgrade error
this plan exists to fix, pointed the other way.

The rule is **latest valid terminal state by event time**:

1. Walk `trackinfo[]` chronologically by `date_carbon`; keep only events that map to
   a `CarrierDeliveryStatus` per the table above. Unmapped events are skipped
   entirely — they never mask a later or earlier mapped event.
2. The signal is the **mapped event with the greatest `date_carbon`**.
3. **Tie rule** (equal `date_carbon`, different mapped statuses) — deterministic,
   applied only to break an exact timestamp tie, never to override a later event:
   1. `Returned` beats `DeliveredToPickup` and `AttemptFail`-derived states. This is
      the #98141 pair: at 11:17:41 the carrier says both "delivery failed" and
      "returning to sender" — the same physical fact, and the return is the more
      complete description of it.
   2. `CollectedAtPickup` beats `DeliveredToPickup` (collection supersedes arrival).
   3. `Delivered` beats `DeliveredToPickup`.
   4. `Delivered` vs `Returned` at the *identical* timestamp is contradictory and
      must **not** be silently resolved: emit no signal and record a
      `tracking_app_conflict` so it surfaces rather than guessing. (Not observed in
      any sampled payload; defensive.)
4. `date_carbon` is a naive local-time string (`"2026-09-07 09:17:41"`) with **no
   timezone**. Parse it as the shop's timezone, not UTC, or ordering near midnight
   will be wrong. This is an **unverified assumption** — the shop is DE and the
   carrier events are German, but ParcelPanel's normalisation rules are undocumented.
   Phase 2 must confirm against a known event before relying on sub-day ordering.

Because step 2 takes the latest mapped event rather than the most severe, a
redelivery after a return produces `Delivered` — which is the correct answer, and the
behaviour rev 2 would have got wrong.

`status_num.status` (2 = Ausnahme, 4 = Geliefert) is a useful cross-check but is
**not** the mapping input: it collapses the timeline and cannot express
delivered-then-returned. Use it only to assert agreement, and log disagreement.

### 7.2 Result contract — three outcomes, never two

Per the review: a failure must not collapse into "no signal".

```ts
type TrackingAppResult =
  | { outcome: "signal"; signal: DeliverySignal }
  | { outcome: "no_terminal_state" }   // fetched OK, parcel still moving
  | { outcome: "unavailable"; reason: "http_403" | "http_5xx" | "timeout"
                                    | "shape_mismatch" | "not_found" };
```

`no_terminal_state` is a *fact* (we looked, it is in transit). `unavailable` is an
*absence of knowledge*. They must never be conflated — see §8.

### 7.3 Persistence

`shopify_fulfillment_trackings` already has the needed columns:
`shipment_status`, `terminal_at`, `tracking_source`, `last_carrier_lookup_at`,
`last_carrier_lookup_result`, `return_reason`. Write `tracking_source =
'tracking_app_parcelpanel'`. **No migration required** — verified against the live
schema. `carrier_normalized`/`carrier_adapter` stay NULL (no adapter ran), which
keeps §3.1's distinction intact.

## 8. Failure must block filing, not pass silently

Rev 1 let a lookup failure fall through to "no signal", leaving the pack eligible to
auto-file. That reproduces the original bug with extra steps.

Rule: **`unavailable` on a shipment with no other terminal signal makes the pack
ineligible for automatic filing.** It parks for review with a merchant-facing reason
("we could not confirm this parcel's delivery status"). It does **not** cap strength
and does **not** assert non-delivery — absence of knowledge is not evidence.

Precedence, unchanged from the existing gates: coverage > fatal-loss >
returned_to_sender > **unavailable-block** > ordinary scoring. The unavailable-block
sits below the factual gates because they know more than it does.

Two carve-outs, both requiring evidence:

- If another source already supplies a terminal signal for that shipment (native
  Shopify, or a real carrier adapter), `unavailable` is informational only — we are
  not blind, just missing a second opinion.
- `not_found` for a shipment whose tracking number the merchant never populated is
  the existing `no_tracking` case, not a block.

This is a deliberate tightening: it will park some packs that would previously have
filed. That is the correct direction — the failure mode being fixed is *filing a
contradicted pack*, and the cost of the opposite error is a merchant clicking submit.

## 8.1 Submission-time freshness — the check that actually matters

The review is right that rev 2 was insufficient here, and the reasoning is worth
stating exactly: **§10's refresh policy is a build-time property.** A pack built on
day 1 and filed on day 9 carries day-1 delivery facts. "Refresh within 48 h of the
deadline" narrows the gap but does not close it — the refresh and the filing are
still two separate events, and a parcel can return in between. #98141's own timeline
is the proof: `DeliveredToPickup` on 08-31, `Returned` on 09-07, seven days apart.

So freshness must be asserted **at the moment of submission**, not only at build.

### 8.1.1 The invariant — TWO parts, not one

The review caught the hole in rev 3, and it is the most important correction in this
document: **a fresh lookup does not make an old pack accurate.** Checking
`last_carrier_lookup_at` alone would certify that we *looked* recently while the
worker files a PDF built from what we saw a week ago. Freshness of the *observation*
and correctness of the *artifact* are different properties, and rev 3 conflated them.

Both must hold:

> **(I) Observation freshness.** Every shipment's delivery state was confirmed within
> `FRESHNESS_MAX_AGE` of the filing attempt.
>
> **(II) Artifact agreement.** The package about to be filed was built from delivery
> facts that still match the current ones. If the refreshed state differs from what
> the package encodes, the package is **stale** and must not be filed — regardless of
> how fresh the lookup is.

(II) is the load-bearing half. (I) without (II) is exactly the failure the review
describes.

#### How (II) is decided — reuse `evidence_hash`, but PROVE it covers delivery status

The mechanism exists: `lib/defence/computeEvidenceHash.ts:60` hashes
`{reasonCode, facts, manual}`, and `lib/defence/enqueue.ts:173` feeds it
`classification.approved`. `enqueue.ts:312` already compares against the latest
`final` package's `evidence_hash` and marks drifted rows `stale`.

**The review asked whether delivery status is actually in those inputs. It is not —
not directly.** Traced 2026-09-16:

`projectFact` (`computeEvidenceHash.ts:36-47`) hashes `category, strength,
bank_eligible, internal_only, include_in_bank_narrative, submission_risk, value,
source`. For a delivery fact, `value` is built by `extractValue`'s
`delivery_proof`/`shipping_tracking` branch (`factClassifier.ts:418-463`) and contains:

```
proofType, carrier, trackingNumber, trackingUrl, deliveredAt, signedByName
```

**There is no `deliveryStatus` field.** The `CarrierDeliveryStatus` (`Delivered` /
`Returned` / …) never enters the hash under its own name.

##### Why the hash nonetheless moves for #98141 — and where it does not

`Returned` reaches the hash **indirectly**, through `proofType`, computed by
`resolveProofType` (`fulfillmentSource.ts:373-419`). A reconciled `Returned` sets
`sawReturned`, is explicitly barred from raising the tier, and — when no other
shipment reaches a positive tier — yields `proofType: "returned_to_sender"` instead of
`"label_created"`. `proofType` **is** in `value`, so the hash changes.

For #98141 specifically the transition is
`delivered_unverified` → `returned_to_sender`, plus `deliveredAt` moving to null. The
hash moves. The backstop works.

**But the coverage is incidental, not designed, and it has a real hole:** on a
**multi-shipment** order where one parcel returns and another was delivered with a
timestamp, `bestTier` stays at 2 or 3 from the delivered parcel and `proofType`
remains `delivered_confirmed`. `sawReturned` is discarded. If nothing else in `value`
moved, **the hash would not change and the stale package would file** — exactly the
failure the review predicted, just one scenario deeper.

##### Required, before rollout

1. **Test 13 (§13) is a rollout blocker.** It must assert the hash actually moves on a
   `Delivered → Returned` transition — not that it ought to.
2. **Test 17 pins the multi-shipment hole** and must fail before the fix below.
3. **Add delivery status to the hashed value explicitly.** Do not rely on `proofType`
   as a proxy. Extend the `delivery_proof`/`shipping_tracking` branch of `extractValue`
   to emit a per-shipment `deliveryStatus` (and `returnedAt` when present) so the
   status is hashed under its own name, independent of tier arithmetic.

   **Blast radius — measured, and it is near zero.** The concern was that changing the
   hash inputs would mark every existing `final` package `stale` and trigger mass
   regeneration. Prod `defence_packages` by status (2026-09-16):

   | status | rows |
   |---|---|
   | stale | 281 |
   | failed | 154 |
   | draft | 129 |
   | submitted | 106 |
   | skipped | 60 |
   | superseded | 11 |
   | **final** | **1** (created 2026-05-17, on a closed dispute) |

   The stale-detection path compares against the latest **`final`** row
   (`enqueue.ts:~290`), and there is exactly one in the entire book, on a dispute that
   is already decided. Packages evidently move `draft → submitted` in practice.

   So option (a) — ship it and absorb the regeneration — costs essentially nothing,
   and hash versioning is unnecessary complexity. **Open question 9 is resolved.**
   Re-measure immediately before shipping in case the distribution has moved.

Only after (3) is the claim "a `Delivered`→`Returned` transition changes the hash"
true **by construction** rather than by a fortunate coupling.

##### Then the submission-time check is

1. Refresh delivery state (§8.1.2b).
2. Rebuild the pack's delivery facts from the refreshed state.
3. Recompute `evidence_hash`.
4. If it differs from the package's stored `evidence_hash`, the package is **stale**:
   do not file, regenerate first.

#### The cost this exposes, stated plainly

A stale package becomes a **draft**, and a draft needs regeneration — an LLM call —
before it can be filed. At the deadline that is a real constraint, not a formality:

- Regeneration takes time and costs credits, on a path that runs unattended.
- If regeneration fails or is quota-blocked, there is **no fileable package**, and the
  correct behaviour is to park and notify — never to fall back to the superseded one.
  (`[[project_llm_cap_defence_package_incident]]`: cap-failed packages never
  self-heal.)
- The deadline-rebuild cron at 06:00 UTC exists precisely to do this work ahead of
  time (`defence-package-deadline-rebuild/route.ts`). The freshness check should be
  understood as a **backstop for when that rebuild did not happen or did not help**,
  not as the primary rebuild mechanism.

This materially raises Phase 2's cost and is the strongest argument for doing the
refresh in the 06:00 rebuild window rather than at 08:00 submit time.

#### Scope — the single authoritative rule

This table is the **one** statement of filing eligibility. Where any earlier section
disagrees, this governs.

| condition | automatic filing | merchant filing |
|---|---|---|
| (II) hash disagrees | **refuse** | **refuse** |
| (I) lookup stale, hash agrees | **refuse**, enqueue refresh | **allow** with explicit `allow_stale_observation` consent |
| refresh returned `unavailable`, hash agrees | **refuse**, park (§8) | **allow** with the same consent |
| both hold | file | file |

No delivery state is exempt from re-verification under (I) — including `Returned`
(§10.1). `Returned` blocks filing through the returned-to-sender gate, which is a
separate mechanism from freshness.

The worker cannot infer who enqueued a job (§8.1.5), so the merchant column is
reachable only via the explicit consent marker described in §8.1.6.

### 8.1.2 Exact insertion points — all three

**(a) `lib/jobs/handlers/saveToShopifyJob.ts` §3b, alongside `assessPackageCandidateSafety`
(line 321).** This is the one that matters most: it is the single choke point every
automatic filing passes through, regardless of who enqueued the job.
`assessPackageCandidateSafety` reads only `facts_json` / `narrative_json`
(`lib/defence/packageSafety.ts:347-365`) — it is a pure content check with **no
notion of time**, so it cannot detect staleness and must not be extended to try.

Add a sibling, not a modification:

```ts
const verdict = await assessDeliveryCurrency({
  shopId: pack.shop_id,
  disputeId: pack.dispute_id,
  packageEvidenceHash: dpkg.evidence_hash,   // invariant (II)
  maxAgeMs: FRESHNESS_MAX_AGE_MS,            // invariant (I)
  allowStaleObservation: job.allowStaleObservation === true,
});
// verdict.outcome: "ok" | "hash_disagrees" | "observation_stale" | "unavailable"
if (verdict.outcome === "hash_disagrees") {
  // audit `save_to_shopify_blocked_stale_package`; mark stale; request
  // regeneration; NEVER fall back to a superseded final row. Refuse even
  // when allowStaleObservation is set — consent does not cover (II).
}
if (verdict.outcome !== "ok" && !verdict.consented) {
  // audit `save_to_shopify_blocked_stale_delivery`; enqueue refresh; park.
}
```

Both invariants are checked here, and they behave differently: (II) is absolute,
(I) is overridable by the explicit consent marker. See the §8.1.1 scope table.

Non-retriable in the same sense as the safety gate: retrying does not make data
fresher — only a re-lookup does. Enqueue a refresh and park rather than failing.

**(b) `app/api/cron/defence-package-deadline-submit/route.ts`, before the submit
decision (~line 255, where `evidenceDueAt` is assembled).** The review explicitly
asked for the deadline cron, and it needs its own check rather than relying on (a),
because it is the path that files *without a human ever looking*. Preferably it
**refreshes first**: for each selected dispute, re-verify delivery state, then decide.
If the refresh returns `unavailable`, §8 applies — park, do not file.

This is also where the ordering matters: the cron must refresh **before**
`decideSubmission`, so a parcel that returned since the build changes the decision
rather than being discovered after the fact.

**(c) `lib/automation/finalizeAndEnqueueSave.ts` (line ~132 area).** The
auto-pilot path that finalises and enqueues in one motion. Enqueueing a save with
known-stale delivery data should not be possible; check before enqueue so the
failure surfaces at decision time rather than inside the worker.

Note (a) is the backstop that makes (b) and (c) belt-and-braces: even if a future
path forgets, the job handler refuses. Test 9 (§13) asserts exactly that.

### 8.1.5 The `trigger` discriminator does not exist — VERIFIED

§8.1.2(a) was drafted assuming `saveToShopifyJob` knows whether it was enqueued
automatically or by a merchant. **It does not.** The worker's own comment
(`saveToShopifyJob.ts:195-199`) is explicit:

> *"The `deadline` trigger, deliberately: this worker is downstream of BOTH triggers,
> and the job it is running may have been enqueued by the deadline cron."*

It hardcodes `trigger: "deadline"` precisely because it cannot tell. The `jobs` table
(`id, shop_id, job_type, entity_id, status, priority, run_at, attempts, max_attempts,
locked_at, locked_by, last_error, created_at, updated_at, dedupe_key`) carries **no
enqueuer field** — verified against the live schema.

Consequences for the design:

1. The clean `freshness.trigger === "automatic"` conditional in §8.1.2(a) **cannot be
   written today**. Either the enqueuer is recorded (a new `jobs` column or a
   `dedupe_key` convention — a real schema change, contradicting §7.3's "no migration
   required", which remains true only for the carrier work), or the gate cannot
   distinguish the two at the worker.
2. **The adopted design** (see §8.1.6 for why an unconditional gate was rejected):
   carry an explicit `allow_stale_observation` consent marker on the job. It is set
   only by the merchant-initiated UI path, only after the merchant confirms, and it
   waives **invariant (I) only** — never (II).
3. That shifts weight onto §8.1.2(b) and (c), which **do** know their own context,
   and makes the worker a pure backstop.

An earlier draft proposed an unconditional worker gate with no marker, on the theory
that the merchant path would always refresh before enqueueing. **Rejected**: a
merchant whose refresh fails would press an enabled button and be blocked anyway
(§8.1.6). The consent marker is narrower than recording full enqueuer identity, and
is an explicit act rather than an inference — but it **does** require a schema change,
so §7.3's "no migration required" covers the carrier work only.

### 8.1.6 Contradiction resolved: the merchant path under an unconditional gate

Rev 3 said the worker blocks *every* stale save (§8.1.5 option 2) **and** that the
manual submit button stays enabled so a merchant can file on day-old data (§8.1.3).
The review is right that these cannot both hold: a merchant whose refresh **fails**
would press an enabled button and hit the worker's block anyway — a promise the
system cannot keep, and the worst kind, because it fails after the click.

The resolution follows from separating the two invariants in §8.1.1:

- **(II) artifact agreement is absolute, for everyone.** No path — automatic or
  merchant — may file a package whose `evidence_hash` disagrees with current delivery
  facts. A merchant cannot consent to filing a self-contradictory document; the harm
  (a bank reading our own evidence against us) is not theirs alone to accept, and they
  have no way to see the inconsistency.
- **(I) observation freshness is a default, and a merchant may override it.** "We last
  checked 30 hours ago" is a risk a merchant can knowingly take.

So the worker gate is **not** uniformly unconditional. It splits:

| condition | automatic | merchant |
|---|---|---|
| hash disagrees (II) | refuse | **refuse** |
| lookup stale, hash agrees (I) | refuse, enqueue refresh | **allow** |
| refresh returned `unavailable`, hash agrees | refuse, park (§8) | **allow** |

Since §8.1.5 established the worker cannot tell who enqueued the job, the merchant
override must be carried **on the job**, not inferred: the UI path sets an explicit
`allow_stale_observation` marker when the merchant confirms, and the worker honours
only that. That is a narrower change than recording the full enqueuer identity, and it
is an explicit act of consent rather than a guess about provenance. Whether it rides
on `dedupe_key` or a new column is an implementation choice for Phase 2 — but it does
mean **§7.3's "no migration required" holds only for the carrier work**, not for this.

#### What the merchant actually sees

- **Hash disagreement**: the button is **disabled**, with "this response is out of
  date — the parcel's delivery status changed after it was prepared" and a
  regenerate action. Never a button that fails on click.
- **Stale observation only**: the button stays **enabled**, showing the
  last-confirmed timestamp, with a confirm step that sets the override.
- **Refresh failing repeatedly**: the §8 review park, with the honest reason, and the
  override still available.


### 8.1.4 Interaction with §2.2

For a dispute whose deadline the cron cannot reach at all (§2.2), none of this fires,
because no filing is attempted. Freshness checking does not substitute for fixing the
window bug — they are independent defects and both need fixing.

## 9. Endpoint reliability — EMPIRICALLY PROBED 2026-09-16

Not assumptions; measured.

- **Shape: stable.** 12 randomly-sampled ParcelPanel tracking numbers, all
  `code: 200`, all with `data.tracking[0].{status_num, trackinfo[]}`. 0 mismatches.
- **Latency:** 711–1314 ms (median ~800 ms).
- **IT DOES THROTTLE.** After 12 sequential requests, subsequent calls — including
  one for a number that had just succeeded — returned **403 `{"message":"Access denied."}`**.
  After a ~60 s pause the same request returned 200. So the 403 is a transient
  throttle that recovers, **not** a permanent block.
- **A nonexistent tracking number also returns 403**, not 404. **`403` is therefore
  ambiguous — throttle or unknown parcel — and can never be read as "no return".**
  This single finding is why §8 exists.
- **Auth:** no token. Gated on `Origin`/`Referer` matching the shop domain, via the
  Shopify app proxy. Direct `pp-proxy.parcelwill.com/api/` is 403 regardless.

Operational requirements that follow:

1. **Rate limiting is mandatory**, but the budget is **unknown**. Rev 2 proposed
   "≥1 s between calls" — **withdrawn as unfounded**: the review is right that 12
   successful probes establish nothing about what interval avoids throttling. What we
   actually know is narrow: 12 rapid sequential calls (~800 ms apart, no deliberate
   pacing) tripped a 403, and a ~60 s pause cleared it. We do not know the window,
   the quota, whether it is per-IP or per-shop, or whether Shopify's app proxy or
   ParcelPanel imposes it.

   Phase 2 therefore starts with a **characterisation step**, not a guessed constant:
   probe increasing intervals against a small fixed set until a sustainable rate is
   found, then set the production pacing to a conservative fraction of it. Until that
   number exists, treat throughput as unknown and design the backfill (§11) to be
   resumable and interruptible rather than time-boxed. Adaptive backoff on 403 is
   required regardless of what the characterisation finds.
2. **Never interpret 403 as a fact.** Always `unavailable`.
3. **Canary**: a scheduled check against a pinned tracking number, asserting shape
   and that a known-`Returned` parcel still maps to `Returned`. Alert on drift.
4. **If the endpoint changes or is closed off**: the source degrades to
   `unavailable`, which by §8 parks affected packs for review rather than filing
   them blind. Degradation is safe by construction. Fall back to §11.

**Unverified assumption:** every probe used `6a8848-dd` / `meinmaison.de`. Whether
the proxy path and param names hold for other ParcelPanel merchants is **untested** —
we have no second ParcelPanel shop. Phase 2 must therefore treat shop-level
configuration as discovered-per-shop and fail to `unavailable`, not assume.

## 10. Cache and refresh — REPLACES rev 1's rule

Rev 1 said "terminal states never re-fetch". **That is unsafe and is withdrawn.**

`isTerminalCacheHit` (`lookupCache.ts:80`) treats *any* terminal status as
never-refetch. Under rev 1's rule a parcel marked `Delivered`, then returned a week
later, would be frozen at `Delivered` forever — the exact class of error this plan
exists to fix, and #98141's own timeline proves the sequence is real (delivered-to-
pickup 08-31, returned 09-07).

Replacement rule, scoped to tracking-app signals:

| cached state | refresh policy |
|---|---|
| `Returned` | **refresh like any other terminal state while the dispute is open** — see §10.1. Rev 3's "never re-fetch" is withdrawn. |
| `Delivered`, `CollectedAtPickup`, `DeliveredToPickup` | **refresh while the dispute is open**, at most once per 24 h, and **always once within 48 h before `due_at`** |
| `no_terminal_state` | refresh per existing non-terminal policy |
| `unavailable` | retry with backoff; never cached as a fact |

### 10.1 Contradiction resolved: `Returned` is not final

Rev 3 said two incompatible things, and the review is right to call it: §7.1.1 says a
later `Delivered` supersedes an earlier `Returned` (latest-by-event-time), while the
cache table said `Returned` is never re-fetched. If we never look again, we can never
see the later event, and the event-order rule becomes unreachable in practice.

**Resolution: no delivery state is final while the dispute is open.** The refresh
policy is uniform across `Returned`, `Delivered`, `CollectedAtPickup` and
`DeliveredToPickup` — once per 24 h, and always once inside the 48 h before `due_at`.

Rationale for dropping the special case: a "return" can be corrected. Carriers
mis-scan; a parcel marked returning can be intercepted, redelivered, or collected;
ParcelPanel can revise a classification. Treating `Returned` as immutable was the same
no-downgrade reflex that §7.1.1 already rejected, and keeping it would have made the
returned-to-sender gate impossible to clear even when the parcel later arrived —
locking a merchant out of a winnable case.

The asymmetry worth keeping is not in *refreshing* but in *acting*: `Returned` blocks
automatic filing (via the existing gate), and clearing that block requires a later
mapped event, not merely the absence of one. Absence still proves nothing.

Cost note: this increases lookups, since returned shipments no longer short-circuit.
Given §9.1's unknown throttle budget, the 24 h floor and the open-dispute scope are
what keep it bounded. If characterisation shows the budget is tighter than expected,
the lever to pull is the refresh interval — not reinstating a false finality.

Rationale: **every** delivery state is provisional while the dispute is open. A parcel
can be delivered-to-pickup, uncollected, then returned; a return can be intercepted,
redelivered, or collected. The deadline-adjacent refresh ensures the pack we file
reflects the parcel's state at filing time, not at build time.

**Note this does not touch `isTerminalCacheHit` for carrier-API rows**, which keeps
its existing semantics; the new policy is additive and tracking-app-scoped, to avoid
changing DHL behaviour as a side effect. Whether the carrier-API rule has the same
latent bug is a **separate question worth asking** — flagged, not fixed here
(open question 6).

Tests 4 and 15 (§13) pin the sequences explicitly.

## 11. Phase 4 — backfill, and what is NOT covered

70 open disputes on unidentified carriers need re-evaluation after Phase 2. Rebuild
the 66 on `6a8848-dd` (93.3% ParcelPanel coverage) ahead of their deadlines, paced
per §9.1. Per `[[feedback_canary_before_bulk]]`: run 2–3, read the results, then batch.

**blume-box is not addressed by any phase here**: 0% tracking-app coverage across
54,920 unidentifiable rows (`Other`, `UPS2`, `Canada Post`, `Intelcom`,
`Stallion Express`). It needs real adapters or a paid aggregator. Size separately.
Do not let Phase 2's success imply blume-box is covered.

## 12. Rejected: a direct YunExpress adapter

Preferred on principle — it generalises across merchants regardless of tracking app.
Rejected for now: `services.yuntrack.com/Track/Query` sits behind an Aliyun WAF
returning 405 to GET and POST with browser headers. No public API without a
commercial agreement. Revisit if volume justifies buying access, or if the
ParcelPanel endpoint proves unstable.

## 13. Verification

Gates: `npm test`, `npx tsc --noEmit`, `npm run build`.

New tests, each pinning a real payload as a fixture (the `threeDs.test.ts` discipline):

1. **Mapping** — #98141's real 30-event payload → exactly one `Returned` signal at
   `2026-09-07 09:17:41`.
2. **Same-timestamp tie** — the 08-31 11:17:41 `FailedAttempt` + `Exception_008` pair
   yields `Returned`, not `DeliveredToPickup`.
3. **Empty substatus** — events with `substatus: ""` fall back to `checkpoint_status`
   and never produce a spurious terminal signal.
4. **Delivered-then-returned refresh (§10)** — cached `Delivered` at T0; parcel
   returns at T+7d; a refresh inside the deadline window re-fetches and reconciles to
   `Returned`. **Asserts the rev-1 cache rule would have failed here.**
5. **403 is not a fact (§8, §9)** — a 403 yields `unavailable`, the pack becomes
   ineligible for auto-filing, strength is NOT capped, and no non-delivery language
   appears anywhere.
6. **`carrierWon` integration (§6.1)** — a `tracking_app_parcelpanel` signal
   populates `carrierTracking.deliveryStatus` and trips
   `hasReturnedToSenderShipment`. This is the test that would have caught rev 1's
   miss.
7. **Gate end-to-end (§6.2)** — with the signal present, `returned_to_sender.triggered`
   is true, `overall` is `weak`, auto-submit blocks, and `no_return_initiated` is
   suppressed as a contradiction.
8. **Regression** — a shop with no tracking app behaves exactly as today; DHL
   carrier-API caching is unchanged.
9. **Latest-by-event-time, not most-severe (§7.1.1)** — a synthetic timeline with
   `Returned` at T1 and `Delivered` at T2 > T1 yields **`Delivered`**. Asserts the
   rev-2 "strongest state" rule would have got this wrong.
10. **Tie rule (§7.1.1 step 3)** — the real 08-31 11:17:41 `FailedAttempt` +
    `Exception_008` pair yields `Returned`; a synthetic `Delivered` + `Returned` at
    one identical timestamp yields **no signal** plus a recorded conflict.
11. **Worker enforces both invariants (§8.1.2a, §8.1.1 scope table)** — the backstop.
    Four cases, matching the table row for row: hash disagrees → refuse (with and
    without consent); observation stale + hash agrees → refuse without consent, allow
    with; `unavailable` + hash agrees → same; both hold → files. Must pass even if the
    cron and finalize paths are bypassed.
12. **Deadline cron refreshes before deciding (§8.1.2b)** — pin the #98141 sequence:
    pack built at T0 with `DeliveredToPickup`; parcel returns at T0+7d; cron runs at
    T0+9d; assert it re-fetches **before** `decideSubmission`, reconciles to
    `Returned`, and does not file. End-to-end proof that build-time refresh alone was
    insufficient.
13. **ROLLOUT BLOCKER — delivery status is genuinely in the hash inputs (§8.1.1-II).**
    The proof the review requires. Build a package while tracking says `Delivered`;
    let the parcel return; refresh so `last_carrier_lookup_at` is seconds old. Assert:
    invariant (I) **passes**, the recomputed `evidence_hash` **differs** from the
    stored hash, the package is marked stale, and nothing is filed. Assert the hash
    difference directly — not merely that filing was blocked, which could pass for the
    wrong reason. A variant asserts the worker never falls back to a superseded
    `final` row when regeneration is unavailable.
14. **Hash agreement is load-bearing, not vacuous** — same scenario, refreshed state
    *unchanged*: hash matches and the package files normally. Guards against a gate
    that blocks everything and is therefore never exercised.
15. **`Returned` is refreshed, not frozen (§10.1)** — a shipment cached as `Returned`
    is re-fetched next cycle; a later `Delivered` supersedes it and the
    returned-to-sender gate clears. Asserts rev 3's "never re-fetch" would have made
    §7.1.1 unreachable.
16. **Merchant consent waives (I) but never (II) (§8.1.6)** — with
    `allow_stale_observation` set: a stale-but-agreeing package files; a
    hash-disagreeing package is **still refused**.
17. **ROLLOUT BLOCKER — the multi-shipment hash hole (§8.1.1).** Two shipments: one
    `Delivered` with a timestamp, one that later returns. `resolveProofType` keeps
    `delivered_confirmed` because the delivered parcel holds the tier, so `proofType`
    does **not** move. **This test must FAIL before the §8.1.1(3) fix and pass after**,
    proving the hash covers delivery status under its own name rather than by
    incidental coupling through `proofType`.

Docs: `docs/technical.md` updated in the same commit (repo rule), covering the new
source, the three-outcome contract, and the refresh policy.

## 14. Verified vs assumed

**Verified against prod or live endpoints (2026-09-16):**
- All three disputes' live state, submission state, and job rows.
- #100094's parcel was delivered, not returned — rev 1's urgency claim was wrong.
- No queued `save_to_shopify` job for `4b81afe1`.
- `conceded` semantics, read from `route.ts:204` and `reviewState.ts`.
- Carrier-mix and tracking-app numbers (§3), via regex replay.
- ParcelPanel writes no metafields (4 orders, live Admin GraphQL).
- `Fulfillment.metafields` does not exist in API 2026-01.
- Endpoint shape across 12 orders; latency; throttling behaviour; 403 ambiguity;
  403 recovery after ~60 s.
- `returnedToSender.ts`, `autoSubmitGuards.ts:149`, `contradictionGate.ts:162`,
  `fulfillmentSource.ts:252` all exist and read as described.
- No migration needed — columns exist.
- **(rev 3)** Shopify's live deadline, via Admin REST: `needs_response`,
  `evidence_due_by` 2026-09-17 03:00 UTC, `evidence_sent_on` NULL. Window open.
- **(rev 3)** The cron window arithmetic, replayed: the Sep 17 08:00 run selects this
  dispute 5 h after expiry; the Sep 16 run could not see it.
- **(rev 3)** 321 prod disputes have an 03:00 UTC deadline, 319 never filed; 201 of
  the 321 nonetheless `won` (mostly Shopify-resolved inquiries).
- **(rev 3)** `assessPackageCandidateSafety` is a pure content check over
  `facts_json`/`narrative_json` with no time dimension — verified by reading
  `packageSafety.ts:347-365`.
- **(rev 5) The hash inputs, traced end to end.** `computeEvidenceHash.ts:60` hashes
  `{reasonCode, facts, manual}`; `projectFact` (lines 36-47) includes `value`;
  `enqueue.ts:173` supplies `classification.approved`. The delivery fact's `value`
  (`factClassifier.ts:418-463`) contains `proofType, carrier, trackingNumber,
  trackingUrl, deliveredAt, signedByName` and **no delivery-status field**.
- **(rev 5)** `Returned` reaches the hash only **indirectly**, via `proofType` from
  `resolveProofType` (`fulfillmentSource.ts:373-419`). For a single-shipment order
  like #98141 the transition `delivered_unverified → returned_to_sender` does move the
  hash — so the backstop works for this case, by coupling rather than by design.
- **(rev 5)** The multi-shipment hole is real: `sawReturned` is discarded whenever any
  other shipment holds `bestTier` at 2 or 3, so `proofType` — and therefore the hash —
  need not move when one parcel of several returns.

**Assumed, still to prove:**
- That the gate chain actually fires end-to-end once fed (read, never executed) —
  test 7 proves it.
- That widening `carrierWon` has no unintended effect on DHL paths — test 8.
- That the proxy path/params generalise to other ParcelPanel merchants — **untestable
  today**, no second ParcelPanel shop.
- That 17track (3,308 rows on `6a8848-dd`, 48 on cay) can be read the same way —
  not probed at all.
- Throttle limits are characterised only as "12 rapid requests trips it, ~60 s
  recovers". The actual budget is unknown, and **no safe request interval has been
  established** — §9.1's characterisation step must produce one.
- Whether the carrier-API branch of `isTerminalCacheHit` has the same
  delivered-then-returned bug — suspected, not investigated.
- **(rev 3)** `date_carbon`'s timezone. Parsed as shop-local in §7.1.1, but
  ParcelPanel's normalisation is undocumented and unconfirmed. Affects ordering of
  same-day events near midnight.
- **(rev 3)** `FRESHNESS_MAX_AGE = 24 h` is a proposal, not a measured value. It
  trades parked packs against stale filings and should be reviewed once §9.1 gives a
  real throughput number — a max-age shorter than the time needed to refresh the book
  would park everything.
- **(rev 3)** ~~Whether `saveToShopifyJob` can distinguish automatic from merchant
  triggers today.~~ **Now verified — and the answer is NO.** See §8.1.5; the design
  in §8.1.2(a) had to change because of it.

## 15. Open questions

**Resolved during implementation (2026-09-16):**

- ~~0. The 00:00–08:00 UTC deadline gap needs its own plan.~~ **DONE** —
  `deadline-cron-window-gap.plan.md`, fixed and shipped to prod (#736 → #739).
- ~~1. Concede `4b81afe1`?~~ **Conceded** by the user; execution record at §2.4.
  `83bc28ad` (#98289) was investigated and left alone — see §0.1.
- ~~9. How to add `deliveryStatus` to the hashed value without mass regeneration.~~
  **Moot** — prod holds exactly 1 `final` package (May 2026, closed dispute).
  Shipped plainly; no hash versioning.
- ~~The throttle budget is unknown / no safe interval established.~~ **Measured**
  2026-09-16: 40 requests at 2s throttle at #29; 40 at 4s are clean.
  `MIN_REQUEST_INTERVAL_MS = 5s`, below the boundary with margin. §9.1's
  characterisation step is complete.

**Still open — (7) blocks all remaining work:**

7. **§8.1.5 — how does the worker learn a merchant consented to stale observation?**
   The `allow_stale_observation` marker needs either a new `jobs` column or a
   `dedupe_key` convention. **A schema decision, and the gate to everything else:**
   without it §8.1 cannot be written, and without §8.1 Phase 2 stays unwired.
1. §2.3 — concede `4b81afe1`? (Recommended, but for record-accuracy rather than
   money: §2.2 shows nothing will file it either way. Awaiting approval; nothing
   executed. ~9 h of window left at time of writing.)
2. §6.3 — agreed that bank-facing copy may state the return when the merchant has
   supplied the reason via `parcel-outcome`, rather than never?
3. §8 — is parking packs on `unavailable` acceptable, knowing it will park some that
   would previously have filed?
4. §9 — is the undocumented, throttling, Origin-gated endpoint an acceptable
   dependency given fail-closed handling and the canary?
5. §11 — does blume-box's 54,920-row tail justify a paid aggregator?
6. §10 — should the carrier-API cache rule be audited for the same bug now, or
   tracked separately?
8. §8.1.1 — is `FRESHNESS_MAX_AGE = 24 h` the right trade? Now answerable: §9.1
   measured ~5 s/request per shop domain, so refreshing 70 open disputes costs
   minutes, not hours. 24 h is comfortable. Confirm when §8.1 is written.

(Questions 7 and 9 are listed above under the resolved/blocking split; 0 and 1 are
resolved there too.)

## 16. If someone picks this up later

Read §0 first, then §8.1.1 (the two invariants) and §6.1 (the integration point that
nearly got missed). The three things most likely to be re-derived painfully:

1. **`carrier_normalized` is not an identification flag** (§3.1). Querying it reports
   99.99% unidentified and is wrong.
2. **A fresh lookup does not certify an old pack** (§8.1.1). Observation freshness and
   artifact agreement are different properties; checking only the first lets the
   worker file a contradictory PDF behind a freshly-refreshed shipment.
3. **403 from ParcelPanel is ambiguous** (§9) — throttle or unknown parcel, the status
   code cannot tell them apart. It can never be read as "no return".

And the shape of the whole problem: the returned-to-sender gate, the reconciliation
rules and the `Returned` vocabulary were all **already built** before this work
started. The defect was never missing logic — it was that nothing ever handed them a
signal for a carrier without an adapter.
