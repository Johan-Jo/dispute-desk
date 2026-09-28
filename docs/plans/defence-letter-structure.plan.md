# Defence letter structure — one frame, a playbook per claim

**Status:** rev 2, 2026-09-28 — revised after the critic review (§10). For maintainer review.
**Owner:** defence letters (`lib/defence/counsel/`).
**Writer:** counsel v2 only. The template writer (`generateNarrative`) is retired permanently (maintainer, 2026-09-28) — see §7.

---

## 0. Why this plan exists

The maintainer rejected the not-as-described letter for Mein Maison #101111 (2026-09-28):

> "Starting with the executive summary, why are you mixing in German and product details? There's nothing to do with it, nor in the transaction overview. Also the order got only two points. What happened there? You lost the complete sequence. … What about delivery? What about opening the chargeback?"

And, the same day: *"Please permanently deactivate the older writer, should not happen again"* and *"Do not mix German into the dispute letter as we use English there."*

The record for #101111 held the whole story. The letter used two rows of it:

| Date (2026) | Event | In the letter? |
|---|---|---|
| 6 Sep | Order placed and paid (PayPal wallet, via Shopify Payments) | yes — the only two timeline rows |
| 7 Sep | Shipped, one tracked parcel | **no** |
| 18 Sep | Carrier recorded delivery | **no** |
| 26 Sep | Dispute opened (a PayPal *inquiry*), 8 days after delivery | **no** |
| — | No return in the store's returns system | one sentence |
| — | Listing with photos; refund policy published | yes — but the prose restated German product specs |

## 1. Diagnosis — root causes (verified against the code)

1. **The wrong writer wrote it, and would have for almost every dispute.** Counsel v2 runs only when `counselEnabled(moduleKey)` (`lib/defence/counsel/run.ts:40`: `inr_product_not_received` only) AND the payment is a card AND no bank claim was captured (`buildDefencePackageJob.ts`, the `counselEnabled(…) && !isNonCardPayment && !bankClaim?.text` gate). PayPal and Klarna are in `NON_CARD_FAMILIES` (`lib/disputes/paymentContext.ts`). On prod today, of 60 open disputes, **50 are PayPal or Klarna** and only **2** have a counsel letter (both Blume, card).
2. **I removed delivery from not-as-described letters on a misreading.** Not-as-described PR 1b hid fulfilment, delivery and the timeline's arrival rows after the maintainer asked "why even touch upon delivery?". That meant *don't lead with delivery as if non-receipt were claimed*. Delivery is still part of the sequence: it starts the return window and dates the dispute. The switch is in six places: `familyOmitsArrival` (`lib/defence/chronology.ts:71`), `sectionVisibility.ts:59-61`, `pdf/DefencePackageDocument.tsx:653`, `DefencePackageHtmlView.tsx:503`, `narrativeWriter.ts:826`, plus `chronology.test.ts:98` and `docs/technical.md` § not-as-described.
3. **The dispute's opening enters the timeline only as Shopify's own "opened a chargeback" event** (`chronology.ts:215-226`). An inquiry — like #101111 — has no such event, so the row was never there.
4. **The listing was pasted into the prose.** The writer received the German title and description and restated them. Specs answer nothing: the analyst has no claim text to compare them with (Shopify does not expose it).
5. **The frame ignored the phase.** #101111 is a PayPal inquiry; the letter said "chargeback" and asked for a "reversal of the chargeback".
6. **A batch ran before one letter was approved.** Now a standing rule: ONE letter, approved, then the batch.

## 2. What the networks say a response must contain

**Visa — Dispute Management Guidelines for Visa Merchants (June 2024), Condition 13.3, "How should I respond?"** (pp. 40–41, primary source):
- "The merchandise or services received by the customer were as described. Provide specific information or documentation … to refute the cardholder's claims. … It is recommended that you address each point that the cardholder has made."
- "Returned merchandise was not received … Advise that you have not received the returned merchandise and the cardholder never attempted to return … However, double check your incoming shipping records to verify prior to response."

**Visa — same guide, p. 9:** "Evidence must be legible (good scan copy) and in English or accompanied by an English translation."

**Visa — return-before-dispute rule for 13.3, effective 19 Oct 2024:** reported by secondary sources (Chargebacks911, Chargeflow). **Unverified against the Visa Core Rules** — to be checked before any letter relies on it. Even if true, "no return in the store's system" does not disprove an *attempt* to return, so no letter may claim the cardholder never tried.

**Mastercard 4853:** one code for many sub-types; the response must match the sub-type. For not-as-described: the description and images as advertised, delivery confirmation, communications (Chargeflow and Chargeback Gurus summaries of the Mastercard Chargeback Guide; primary guide not yet read).

**PayPal — Significantly Not As Described (SNAD):** excluded from Seller Protection; won on the archived listing, photos and the communication record (PayPal help: "How do I respond to 'Item Not Received' and 'Significantly Not As Described' disputes?"). **PayPal is not a card network:** no Visa/Mastercard codes, no "issuer", no "chargeback" unless the dispute is one.

**What we cannot do:** "address each point the cardholder has made" from the Shopify API — it does not expose the claim text. We can when the merchant has supplied the claim (`bankClaim.ts`), which today *excludes* the dispute from counsel (§6).

## 3. What our other letters show (prod, last 5 days)

| Writer | Letters | Pattern |
|---|---|---|
| template | 11 of 12 | "The available evidence supports…" hedge in 4; carrier name and tracking number inside the summary in 6 (breaks each-fact-once); no dispute-opening date; summaries that describe instead of argue |
| counsel v2 | 1 (Blume #360980) | claim → record → one tie-back → request, ~60 words, no identifiers, theory chosen by code |

The fix is not a better template prompt. It is counsel for every claim, every payment method.

## 4. The letter frame (every claim type)

Only the middle changes per claim. *code* = written by code from the ledger; *model* = the one generated part.

1. **Header and case table** (*code*). Provider-correct label (PR #913). Title and wording follow `disputes.phase`: "Chargeback response" / "Inquiry response".
2. **Executive summary** (*model*, ≤ 80 words, English). The claim in plain words → the deciding facts, strongest first → one sentence tying them to the claim → the request. No product titles or specs, no identifiers, no carrier names, no amounts.
3. **Evidence sections** (*code* where possible), per playbook, in order of force.
4. **Chronology** (*code*), complete for every claim type: ordered → paid → shipped → delivered → dispute opened (with the interval since delivery) → return state. A row is omitted only when the record lacks it. The opening row comes from `disputes.initiated_at` as a ledger `timelineEvent`, deduplicated against Shopify's own "opened a chargeback" row.
5. **Conclusion** (*code*), one request matched to the phase: chargeback → "requests that the chargeback be reversed"; inquiry → "asks that the claim be closed in the merchant's favour".

**English rule — deterministic, not a language detector:**
- Prose never contains a store product title. Code check: no line-item or listing title (or any 4+-word substring of one) may appear in model-written text.
- A stopword check (common German/Swedish/French/Spanish/Portuguese function words) runs on model-written text only, with the ledger's names (merchant, customer, carrier) allow-listed. Measure its false-positive rate on every current letter before it gates.
- The product is named by an English noun from Shopify's standard product taxonomy category; fallback "the item".
- Tables and cards (line items, shipment card) are record exhibits and keep the store's title, as a record identifier — the maintainer to confirm (§8, D2).
- A non-English listing exhibit prints the original with an English translation beneath it, captioned "English translation (machine-translated)". Code check: every number and unit in the original survives in the translation. Stored once per snapshot and reused; its cost counts in §9.

## 5. First playbooks: PayPal and Klarna, then not-as-described

The order follows the prod numbers (§7): lifting the non-card exclusion reaches 50 of 60 open disputes; a not-as-described playbook alone reaches none of Mein Maison's (all PayPal).

### 5.1 Non-card counsel (PayPal, Klarna)
- Remove `!isNonCardPayment` from the counsel gate; pass the payment family into the ledger and prompts.
- Provider wording: PayPal "dispute"/"inquiry"/"claim", "PayPal's review"; Klarna "dispute", Klarna's own categories. Never "issuer", "cardholder", "chargeback" or a network code on these.
- Existing INR playbook runs unchanged in substance; only the frame words change.

### 5.2 Not-as-described playbook
**Analyst question:** "Did the merchant deliver what it advertised, and is there any return?"

**Ledger claims (code-built):**

| Claim id | Fixed sentence | Source and guard |
|---|---|---|
| `carrier_delivered` | The carrier recorded delivery on {date}. | fulfilment + carrier |
| `dispute_after_delivery` | The dispute was opened {n} days after delivery. | `disputes.initiated_at` |
| `no_return_in_store_system` | The order shows no return in the store's returns system. | `Order.returnStatus = NO_RETURN`. Suppressed when the shop has no messages integration, or a stored message shows return or refund intent (constraint regexes extended to return intent — "return", "send back", "Rücksendung", "zurückschicken", … in all 6 locales). "…and none was received" only with merchant confirmation. |
| `listing_published` | The item was sold under a published listing with photographs and a written description (exhibit). | `product_listing_snapshots`, only when `product_updated_at ≤ order.created_at`; otherwise the exhibit is omitted |
| `return_path_published` | The store's published refund policy offers returns. | policy snapshot; suppressed when the window has expired or return shipping is at the buyer's cost (the adverse-policy rule of the merchant-counsel stance) |
| `later_order` | The same customer ordered again on {date}. | customer orders (INR reuse) |

**Code-owned absence.** The return claim is written ONLY by code, in the "Delivery and return" paragraph. The model summary may not mention returns; the existing absence checks (`counsel/checks.ts:82`, prompts "never argue from absence") keep blocking model-written phrasing. This is the one bounded exception, and it lives in code.

**Theories, in order of force:** `delivered_then_reordered` (delivered, later order, no return) → `delivered_no_return` (delivered; dispute {n} days later; no return in the store system) → `listing_and_no_return` (no carrier delivery: listing + no return).

**Sections:** "What was sold" (listing exhibit, photos, English translation) → "Delivery and return" (code-written) → Chronology.

**Never:** that the item matched or conformed to the listing; that the listing is what the customer saw at checkout; features in prose; that the cardholder kept, has or used the goods; the cardholder's state of mind; leading with delivery as if non-receipt were claimed.

**Prerequisites:** `PRODUCT_LISTING_EVIDENCE_ENABLED` is ON in prod (done 2026-09-28, #905); PR 1b's arrival switches (§1.2) are reverted for this family.

## 6. The remaining families (order of build)

| # | Scope | Open on prod now |
|---|---|---|
| 1 | Non-card counsel (§5.1) | 50 (40 PayPal, 10 Klarna) |
| 2 | Not-as-described (§5.2) | 16 |
| 3 | Item not received — cases counsel returns null for (in transit, no carrier delivery) | part of 27 |
| 4 | Credit not processed (mostly Klarna, Cay) | 10 |
| 5 | Counsel takes a captured bank claim (translated) | 0 today; every reopened dispute |
| 6 | Fraud, subscription, general, incorrect account details | 7 |

## 7. The retirement and production — decision needed (D1)

**Done on develop (not in production):**
- The build job never calls the template writer. No counsel letter → failed package `no_counsel_letter` (not retried). A spent counsel budget or a counsel error → `daily_cap_reached` / `llm_error`, retried by the self-heal pass. Pinned by tests.
- **Filing gate:** the shared safety check (`assessPackageCandidateSafety`, run by every filing path — save job, deadline cron, canonical selector, finalize/submit routes, workspace) refuses a letter without the counsel block (`retired_template_writer`). Without it, template letters built earlier would still have been filed at their deadline, because the selectors skip failed rows.

**What that means in production today (60 open disputes):**

| Now | Count | After the retirement ships |
|---|---|---|
| Counsel letter | 2 | filed as today |
| Template letter | 30 | **refused at filing** (merchant sees "written by a retired writer") |
| No letter | 28 | stays without a letter |

Three disputes are due **today** with no letter at all, independent of this change: Mein Maison #101582, Cay #13638, #14287.

When DisputeDesk files nothing, Shopify files its own automatic response at the deadline (not verified for PayPal inquiries). Packs are billed at build.

**Options:**
- **A — ship now, as instructed.** No template letter is ever filed again. ~58 disputes file nothing from DisputeDesk until §5.1/§5.2 ship. Merchant copy and email for the state required first (see below).
- **B — hold the retirement in develop; hold every template letter for review in prod** until §5.1 ships, then ship both together.
- **C — ship now with an interim code-only counsel letter** for every family: the code-written sections and complete chronology, a fixed code-written summary (no model), provider-correct frame. Satisfies "only counsel writes", files something true for every dispute, and each family's model summary replaces it as its playbook ships. **Recommended.**

**Needed before A or C ships:** merchant UI copy and email for "no letter yet" in 6 locales; billing treatment for disputes that file nothing; the stale-comment and doc fixes.

## 8. Decisions for the maintainer

- **D1** — A, B or C (§7).
- **D2** — may the line-items table and shipment card keep the store's (German) product title as a record identifier, or must they show the English noun too?
- **D3** — machine translation of a non-English listing exhibit, captioned as machine-translated: acceptable?

## 9. Acceptance and rollout (per playbook)

1. Unit tests: ledger claims from fixtures (#101111 is the not-as-described fixture); theory selection; English checks; chronology completeness.
2. **#101111 acceptance:** no product title or spec in the summary or any prose section; timeline ≥ 5 rows (placed, paid, shipped, delivered, opened); PayPal/inquiry wording; one request.
3. Offline eval (`scripts/counsel/eval-counsel.mts`), 5 real cases per family: the judge decides for the merchant after the summary alone AND finds zero sentences the ledger does not back.
4. **ONE letter to the maintainer**, rendered through the job path (preview = job, PR #914), PDF and HTML view. No batch before approval.
5. Release with per-change approval → regenerate the approved case in prod and compare → the family's open disputes deadline-first, paced under the counsel daily cap (25/shop/day).
6. Cost: counsel ≈ $0.016/package measured; a playbook plus translation must stay within 2×.

## 9a. Status — 2026-09-28 evening (maintainer: D1 = A after a test print; D2 yes; D3 yes)

Built on `fix/retire-template-writer` (PR #915), develop only:
- §5.1 non-card counsel and §5.2 the not-as-described playbook, frame, English checks, dispute-opened row, non-card
  Case Details, listing translation with cache (`product_listing_translations`, applied to dev and prod).
- Test print: Mein Maison #101111 rendered through counsel from prod data (read-only; `canary-record-context.mts
  --counsel`): passed every check on the first draft; timeline six rows (placed, paid, shipped, confirmation, delivered,
  dispute opened); PayPal wording; English summary; listing with translation.

Two deviations from §5.2, decided while building:
- **Listing edited after the order is NOT omitted.** `product.updatedAt` moves on any edit (apps, sync); #101111's was
  edited the day of the test print. Omitting would drop nearly every exhibit. The caption stays "as published in the
  store, retrieved {date}", and the ledger forbids calling it what the customer saw.
- **The return line does NOT require a messages integration.** It is the wording letters already carried ("No return
  has been recorded in Shopify for this order.") — true of the record whatever was emailed — withheld when a stored
  message shows return or refund intent.

## 10. Critic review (rev 1 → rev 2)

Verdict on rev 1: **REVISE**. Every finding and what rev 2 did:

| # | Finding | Rev 2 |
|---|---|---|
| B1 | Retiring the writer in the build job would not stop template letters being filed: selectors skip failed rows | Filing gate added in the shared safety check; §7 recounted |
| B2 | The not-as-described playbook could not run for #101111: PayPal is non-card and counsel skips non-card | §5.1 non-card counsel is now first; counts split by payment family |
| B3 | "No return" broader than the record (no `read_returns`; `returnStatus` only; constraints miss return intent; conflicts with the absence ban) | Claim reworded to the store's returns system, guarded, code-owned only |
| M1 | `kept_and_reordered` implies the cardholder kept the goods | Renamed; "kept, has or used" added to never |
| M2 | Listing retrieved today, maybe edited after the order; flag prerequisite | `product_updated_at ≤ order.created_at` guard; prerequisite listed |
| M3 | Language detector unreliable; titles reach the page through code | Deterministic checks; D2 on tables and cards |
| M4 | Machine translation unguarded | Caption, number/unit check, stored once, costed; D3 |
| M5 | Cap and errors became permanent failures | Retriable codes (done on develop) |
| M6 | No merchant copy, billing, or third option | §7 prerequisites; option C |
| M7 | A captured bank claim now means no letter | §6 row 5 |
| M8 | Chronology fix incomplete (inquiries; six switch sites) | §1.2 lists the sites; §4 opening row with dedupe |
| m1–m6 | Secondary Visa source; parcel wording; adverse-policy rule unnamed; judge truthfulness; #101111 acceptance; Shopify fallback unverified for PayPal | All addressed in §2, §5.2, §9, §7 |
