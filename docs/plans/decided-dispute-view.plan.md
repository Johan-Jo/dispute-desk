# Decided disputes get their own view: what happened, what mattered, what to change

**Status:** v1.2, 2026-09-26. **PR 1 and PR 2 implemented** on `feat/decided-dispute-view` (PR #844). PR 2 follows the Claude Design "Decided Dispute View" (D-1 fixed copy, D-2 no fee, D-3 Shopify Admin pointer, D-4 design: all resolved by the design). PR 3 needs separate approval.
**Builds on:** `docs/plans/lost-dispute-explanation.plan.md` (shipped 2026-08-29, `62459a25` + `c45699af`). That plan added one sentence and a "learning" list to the hero. This plan replaces the live-case layout on a decided dispute with a dedicated decided-case view.
**Evidence:** prod `aokhplydttxtebvbeuzc`, queried 2026-09-26.

---

## 0. Intended behaviour today (read before the defects)

- A decided dispute renders the **same Overview as a live case**. The only difference is the hero: one sentence from `outcomeExplanationToken` plus, on a loss, a factor list from `deriveOutcomeFactors` (`lib/disputes/outcomeExplanation.ts`).
- Who filed is decided by **whether a `defence_packages` row reached `bankFacing`**, not by `submission_state`, because that flag is also true on pre-install imports (`lost-dispute-explanation.plan.md` §3).
- Shopify **auto-sends its own scraped response at the deadline** when nothing was filed (`docs/technical.md:447`; memory `project_shopify_files_anyway_reframes_guards`).
- The issuer's reasoning ("Help me understand why I lost", Attachments A/B) is **Admin-UI only**. It is not in any API version (`lost-dispute-explanation.plan.md` §2). Sidekick can read it; we cannot. We do not plan to ingest it.

---

## 1. The case that triggered this — order #360499, blume-box

| When (UTC) | Event |
|---|---|
| Aug 19 | Order placed and paid. **Never shipped.** |
| Aug 27 | Chargeback opened: Product Not Received (Visa 13.1), due Sep 11 23:00 |
| Aug 27 → Sep 11 | Pack built 4×, score 42, missing tracking and delivery. Fatal-loss gate `inr_no_fulfillment` blocked filing. Letter to the bank skipped 3× (`no_bank_eligible_facts`). |
| Sep 11 06:16 | Merchant emailed the fatal-loss alert |
| Sep 11 08:00 | Deadline cron: `defence_package_blocked_unsafe_claim`, reason `fatal_loss` |
| Sep 12 07:43 | **Response sent through Shopify** (`evidence_sent_on`) |
| Sep 16 | Merchant cancelled the order |
| Sep 17 | Lost |

What the page shows, and why each part is wrong:

| On screen | Problem | Cause |
|---|---|---|
| "This dispute was decided before DisputeDesk filed any evidence for it." | False. We held the case on purpose from Sep 1, and the bank decided 6 days after the deadline. | `not_defended_by_us` covers two different things: a pre-install import, and a case we held. No `submitted` package row means `bankFacing` is null. |
| "Add missing evidence" / "Save anyway" | Live-case actions on a closed case | The gate is `(autoSaveBlock \|\| held?.held) && !isReadOnly`, and `isReadOnly` is only true once *we* saved (`useDisputeWorkspace.ts:1156`). |
| "Not yet assessed" badge | Assessed 4× | Live-case badge still renders on decided cases |
| "What happens now" timeline | Nothing happens now | Live-case component |
| "No action required" chip inside a red alarm card | Mixed signals | Alarm styling that belongs to a live case |

And the actual lesson is missing: **the order never shipped.** That is the one fact that settles a not-received claim, and we hold it on record. Sidekick's version of this same case guesses at tracking and signatures ("If you had tracking that showed delivery but lacked signature confirmation…"). It has the issuer's text but not the order facts. We have the order facts, which is an advantage.

---

## 2. What Sidekick shows vs what we can know

| Sidekick section | Its source | Ours | Decision |
|---|---|---|---|
| Headline: amount incl. $15 fee, order, product | Payments ledger + order | Amount + order: yes. Line items: yes (`orderSource.ts:95`). **Fee: not stored anywhere** (no fee column in prod). | Show the amount and products. Leave the fee out (D-2). |
| "The customer's claim" (cardholder's words, issuing bank's name) | Issuer packet | Reason + network reason code + the catalog's description (`reasonCodeCatalog.ts`) | Show the **claim type** in plain words, never the cardholder's words. The page must not imply we read the claim. |
| "Why the bank ruled against you" | Issuer's decision text | Not available | **Don't imitate it.** Replace it with "What we saw in the record": observed facts only, no causation (existing rule 2 in `outcomeExplanation.ts`). |
| "What would have made a stronger case" | Generic advice per reason | Reason-family checklist **plus our own record of which items this case had** | Better than Sidekick: had / missing, per case |
| "Preventing this in the future" | Generic | Per family, **tailored with store data** (order value, how often this store shares tracking, how long it takes to fulfil) | Only steps the merchant can actually take (memory `feedback_ask_only_for_what_the_merchant_can_actually_do`) |
| "This loss is final" | — | Yes | Keep: one line, no actions |

---

## 3. The view

A decided dispute gets a dedicated Overview layout. Live-case components don't render on it.

```
┌ Header card (unchanged: order, badges, amount, customer, dates) ─────────┐
│  badges: [Lost]            ← "Not yet assessed" removed on decided cases  │
└──────────────────────────────────────────────────────────────────────────┘
┌ Outcome ────────────────────────────────────────────────────────────────┐
│ Dispute lost · decided Sep 17, 2026                    USD 85.41 lost   │
│ The Back to School Bundle (1 item) · Product not received               │
│ This decision is final. There is nothing left to file.                  │
│ Who responded: A response was sent through Shopify on Sep 12.         │
│   DisputeDesk held this case: the order was never shipped, so there was │
│   no delivery we could truthfully put in front of the bank.             │
└──────────────────────────────────────────────────────────────────────────┘
┌ What we saw in the record ───────────────────────────────────────────────┐
│ • The order was never shipped (fulfilment status: unfulfilled).         │
│ • No tracking number or delivery confirmation existed.                  │
│ On a not-received claim the bank's question is "was it delivered?",     │
│ and nothing on record said yes.                                          │
└──────────────────────────────────────────────────────────────────────────┘
┌ What wins this type of dispute ──────────────────────── this case ──────┐
│ Carrier tracking to the customer's address                   ✕ missing  │
│ Delivery confirmation (signature above your threshold)       ✕ missing  │
│ Delivery date promised at checkout                           ✓ policy   │
│ Customer communication record                                – none     │
└──────────────────────────────────────────────────────────────────────────┘
┌ Next time ───────────────────────────────────────────────────────────────┐
│ • Ship or cancel-and-refund before the customer disputes. This order    │
│   sat unshipped 8 days before the chargeback.                           │
│ • [tailored] 12% of your not-received disputes this year were orders    │
│   that hadn't shipped.                                    (Phase 2)     │
└──────────────────────────────────────────────────────────────────────────┘
┌ What happened (timeline, past tense, replaces "What happens now") ───────┐
│ Aug 27 Dispute opened · Aug 27 Evidence gathered · Sep 1 Held: order not│
│ shipped · Sep 11 You were emailed · Sep 12 Response sent through Shopify │
│ sent · Sep 17 Lost                                                       │
└──────────────────────────────────────────────────────────────────────────┘
```

**Won** mirrors this: "Dispute won · USD X recovered". "What we saw" becomes "What carried the case" (the existing won factors). "Next time" is dropped. A win needs no lesson, and inventing one is padding.

**Style:** the outcome card uses a neutral tone, not the red alarm card. Red means "act now", and there is nothing to do. **This needs a design** (§8 D-4) before the UI PR, per CLAUDE.md rule 8.

**Tabs:** Evidence and Review and Forward become read-only records of what was filed, or of the fact that nothing was. No save, upload or submit controls on a decided case.

---

## 4. "Who responded": five states instead of one

Replaces `not_defended_by_us`. Each state is resolved from stored data, never inferred from `submission_state` alone.

| State | Condition | Line |
|---|---|---|
| `we_filed` | `defence_packages.status='submitted'` OR `evidence_packs.saved_to_shopify_at` set | "DisputeDesk filed your evidence on {date}." |
| `we_held_shopify_sent` | Pack exists, we never saved, `evidence_sent_on` set | "A response was sent through Shopify on {date}. DisputeDesk held this case: {hold reason}." |
| `we_held_nothing_sent` | Pack exists, never saved, no `evidence_sent_on` | "No response was filed. DisputeDesk held this case: {hold reason}." |
| `before_install` | `closed_at` < shop install | "This dispute was decided before DisputeDesk was installed." (the only state that keeps the current sentence, reworded) |
| `unknown` | Anything else | No line at all, rather than a guess |

`{hold reason}` comes from the **latest `auto_save_blocked` / `defence_package_blocked_unsafe_claim` audit row**, mapped to merchant tokens (`fatal_loss:inr_no_fulfillment` → "the order was never shipped"; `strength_insufficient` → "the evidence on record was too thin to argue"; `covered` → "Shopify Protect covered it"). Tokens only, 6 locales.

Going forward, the merchant's-counsel stance (PR #767, D-1: always file our own response) makes the two `we_held_*` states rare. They still have to exist for history and for the Shopify Protect hold.

**Population, post-install decided disputes** (`closed_at >= shops.created_at`, used as the install date):

| Bucket | Chargeback lost | Chargeback won | Inquiry lost | Inquiry won |
|---|---|---|---|---|
| we_filed | 76 | 5 | 0 | 1 |
| we_held_shopify_sent | 14 | 21 | 0 | 1 |
| we_held_nothing_sent | 8 | 21 | 15 | 21 |
| no pack | 13 | 28 | 5 | 1 |

**Step 0 before any copy ships:** the 21 chargebacks won with "nothing sent" and the 41 "no pack" rows do not fit the model cleanly. A chargeback won with nothing filed is possible (the cardholder withdrew), but 21 is a lot. `shops.created_at` may also be a reinstall date. Each bucket gets a 3-case read (memory `feedback_canary_before_bulk`) and the resolver is corrected before the "who responded" line renders anywhere. **A wrong "who filed" line is the defect this plan exists to remove.**

### 4a. What step 0 found, and what shipped instead (2026-09-26)

Reading 3 cases per bucket showed the five states above were too coarse. Almost all of the unexplained rows are one shop (6a8848-dd). They reduce to a few real situations, none of them a data fault:

| Finding | Example | Consequence |
|---|---|---|
| Review-mode shop; the case was parked (`parked_for_review`) and never approved | #102014, #90877 | Hold reason `awaiting_review` |
| No plan capacity: `auto_build_skipped` = `quota_exceeded` / `feature_blocked` / `auto_build_off`, so no pack ever existed | #99992, #97061 | Hold reasons `plan_limit`, `auto_build_off` |
| Merchant conceded | #98141 | Hold reason `merchant_conceded` |
| Decided **before the deadline**, often the day it opened | #98623, #102014 | "The bank decided on {date}, before the response deadline…" For these cases the old sentence was actually true. |
| A response went through Shopify **before the shop installed** | #92361 (sent Aug 23, installed Aug 29) | New responder `sent_before_install`; no hold is blamed |
| Approved but never filed, and won anyway | #90627 | No reason named: plain "No response was filed." Not a guess. |

**Shipped model:** responder ∈ `before_install | we | sent_before_install | shopify | none` × a separate `holdReason` (priority: `merchant_conceded` → `not_shipped` → `refunded` → `covered` → `plan_limit` → `auto_build_off` → `awaiting_review` → `thin_evidence`) × `decidedBeforeDeadline`. PR 1 said "sent through Shopify" because the API can't tell Shopify's auto-send apart from a merchant filing in Admin; Decided 2026-09-26 by the maintainer: copy never says "automatic response"; it says "a response was sent through Shopify".

**Verified on prod** (read-only, the real loader over all 1,111 decided disputes): 880 `before_install`, 85 `we`, 27 `sent_before_install`. Held: `awaiting_review` 90, `auto_build_off` 13, `plan_limit` 8, `not_shipped` 2, `merchant_conceded` 1, no reason 6. Zero load failures. #360499 renders (PR 2 wording): *"A response was sent through Shopify on Sep 12, 2026." / "DisputeDesk held this case: the order was never shipped, so there was no delivery we could truthfully put in front of the bank."*

**Open, not in PR 1:** #90627 (approved, never filed) suggests the deadline cron can miss an approved case. That is a filing question, not a copy question. Needs its own look.

---

## 5. Content engines, all pure `lib/` modules emitting `I18nToken`s

**5.1 `deriveOutcomeFactors`: extend it, keep the rules.** New loss factors, grounded in the order record, which is available even with no package:

| Code | Condition | Family |
|---|---|---|
| `order_never_fulfilled` | `shopify_orders.fulfillment_status='UNFULFILLED'` and no fulfillments | delivery |
| `fulfilled_after_dispute` | first fulfilment after `initiated_at` | delivery |
| `refunded_after_decision` / `cancelled_after_dispute` | cancel/refund timestamps after `initiated_at` | all (merchant-only context) |

Existing rules stay: observed facts only, "banks weight this heavily" and never "you lost because", merchant-facing only (never in `narrative_json` or the PDF), no bare AVS/CVV codes.

**5.2 `whatWinsThisDispute(reasonFamily, evidenceChecklistKey, packFacts)` → rows of {item token, had | missing | n/a}.** The item list comes from the existing `evidenceChecklistKey` in `reasonCodeCatalog.ts` and the Visa guidelines (memory `reference_visa_dispute_management_guidelines`). Had/missing comes from **this case's** facts. Payment-family aware: Klarna/PayPal rows drop AVS, CVV and signature (`project_klarna_dispute_handling`).

**5.3 `nextTimeRecommendations(family, case, storeStats)` → at most 3 tokens.** Each recommendation is a rule with a data trigger, not boilerplate:

| Family | Recommendation | Fires when |
|---|---|---|
| delivery | Ship or cancel-and-refund before the customer disputes | `order_never_fulfilled` / `fulfilled_after_dispute` |
| delivery | Require signature above {threshold} | Delivered but unsigned AND order value ≥ the store's p75 order value |
| delivery | Share tracking with the customer at dispatch | No tracking on the order |
| fraud | Turn on 3-D Secure / Shopify Protect | Existing `learning.fraudRecommendation`, moved here |
| fraud | Hold orders flagged high-risk | `risk_recommendation_initial` = cancel/investigate and the order was shipped anyway |
| subscription | Make cancellation self-serve and confirm it by email | Subscription family |

No recommendation fires without its trigger. Zero is a valid result, and the card is then hidden.

**5.4 `decidedTimeline(audit_events, dispute)` → past-tense steps.** Built from the audit rows already written (opened, pack built, held + reason, alert emailed, filed by us / response sent through Shopify, decided). Replaces "What happens now" on decided cases.

**Why deterministic and not an LLM narrative like Sidekick:** CLAUDE.md rule 5 (no English in `lib/`, 6 locales), no per-view API cost, and it can't hallucinate. Sidekick's own text for this case invented a tracking scenario for an order that never shipped. Every sentence here is a token driven by a stored fact.

---

## 6. Phases

**PR 1: stop the wrong statements (small, `develop`, can ship before the design).**
- Step 0 bucket reads (§4) → five-state resolver replaces `not_defended_by_us`, with hold reason from audit.
- On decided cases: hide the gate actions (`isDecided` added to the `!isReadOnly` condition), the "Not yet assessed" badge and "What happens now".
- Outcome email (`sendOutcomePostedAlert.ts`) uses the same resolver, so the email and the page can't disagree.
- Tests: #360499's exact shape → `we_held_shopify_sent` + "order was never shipped"; a pre-install import → `before_install`; a decided case never shows gate buttons.

**PR 2: the decided view (after D-4 design).** §3 layout, §5.1–5.4 engines, read-only Evidence/Review tabs, 6 locales, `docs/technical.md` § *Decided-dispute view*, help article (`lib/help/`): what we can and can't know about a bank's decision, and why Shopify's own "Help me understand why I lost" link has the issuer's words.

**PR 3: store patterns (Phase 2 of the earlier plan).** Per-shop, per-reason base rates and the "12% of your not-received losses were unshipped orders" line, from the 466-case historical corpus (`lost-dispute-explanation.plan.md` §8). Aggregates only, never shown as a per-case explanation.

Verify each: `npm test`, `npx tsc --noEmit`, `npm run build`, `scripts/verify-i18n-parity.mjs`, then check the result on a prod case at 393/375/320px.

---

## 7. Out of scope

- Ingesting the issuer packet or quoting the cardholder's claim (not in the API; verified twice).
- LLM-written narratives (§5 rationale).
- Resending emails for already-decided disputes.

## 8. Decisions needed

- **D-1. Deterministic copy, not an LLM narrative.** Recommended: yes (§5).
- **D-2. Dispute fee.** Not stored. Showing it needs Payments balance-transaction reads, which may mean a new scope and a merchant re-consent. Recommended: show the disputed amount only, labelled "Amount lost", and revisit later.
- **D-3. Link to Shopify's "why I lost".** The header already has "View in Shopify Admin". Recommended: one sentence in the outcome card: "Your bank's written reasoning is in Shopify Admin." It tells the merchant what exists there without pretending we read it.
- **D-4. Design.** The layout in §3 is a wireframe. PR 2 needs a Claude Design / Figma pass, which is then reproduced literally (rule 8). PR 1 needs no design: it only removes wrong elements and corrects one sentence.
