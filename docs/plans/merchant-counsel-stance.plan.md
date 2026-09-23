# Merchant's counsel: defend every dispute, bury what helps the cardholder

**Status:** PLAN ONLY (v1, 2026-09-23). Not started. Decisions D-1 and D-2 taken (§9).
**Directive (maintainer, 2026-09-23):** *"We are supposed to defend the position of the
merchant no matter what, even if policies, as well as the situation, argue against us.
We should use the argument we can and not provide those who work against us … with the
argument that should simply be hidden."* And: the stance *"should govern all types of
disputes"*.
**Scope:** every dispute type, every surface that decides whether we file or what reaches
the bank. It supersedes the stand-down behaviour of the fatal-loss gate and the
returned-to-sender gate (§3). **Deployment:** prod = `master`. Figures read from prod
(`aokhplydttxtebvbeuzc`) on 2026-09-23 via `npm run db:query:prod`. Code references are
against `origin/develop` @ `0d383e16`.
**First applied in:** `docs/plans/non-receipt-delivery-evidence.plan.md` (PR #766),
whose Stance section is the worked example for item-not-received.

---

## 1. The stance (applies to every dispute type)

1. **Always defend.** Nothing in the product recommends conceding, withdrawing an
   approval, or not filing because the facts or the merchant's own policies favour the
   cardholder. Every dispute gets the strongest defence available. The only outcome
   worse than a weak defence is silence: an unanswered inquiry or chargeback is a
   certain loss.
2. **Use every argument that helps; volunteer nothing that hurts.** Material that helps
   the cardholder never enters any bank-facing artifact: not the facts, the narrative,
   the PDF, nor an appendix.
3. **Every sentence is true.** Omission is the tool, never misstatement. The issuer holds
   the carrier record, the network data and the cardholder's statement. One provably
   false sentence loses the response, and it exposes the merchant.
4. **Never argue against ourselves.** A sentence that concedes the cardholder's premise
   is removed even when it is true.
5. **The client knows what we withheld.** A merchant-only note lists what was left out of
   the bank artifact and why. It is never sent to the bank. The merchant can still choose
   not to defend (the existing Concede control): that is the client's instruction. We
   never recommend it.

**The only legitimate reasons not to file**, after this plan:

| reason | why it is not a concession |
|---|---|
| Shopify Protect coverage (`PROTECTED` / `ACTIVE`) | Shopify pays the merchant; a filing is pointless. Unchanged (CLAUDE.md Coverage Gate) |
| the merchant chose **Concede** | the client's instruction |
| no artifact can be produced without a false sentence | then file the **minimal verified response** (§4.3), never silence |

### 1.1 What "helps the cardholder" means, per dispute type

A starting list. §5's audit turns it into a manifest with a test.

| dispute type | material that must never reach the bank (when it applies) |
|---|---|
| **Fraudulent / unauthorised** | AVS or CVV mismatch; 3DS attempted-and-failed; IP or location mismatch, VPN or proxy (already gated by `bankEligible`); high Shopify risk level; first-time customer, when that is the only history; billing ≠ shipping, when no explanation helps |
| **Item not received** | delivery or dispatch windows the shipment missed; order→dispatch and order→delivery intervals; a dispute opened before dispatch; "no return was initiated" (D2 in PR #766); delay complaints; the merchant's refund-for-late-arrival clauses |
| **Not as described / unacceptable** | the cardholder's complaint text and photos; defect acknowledgements in support threads; return requests; policy clauses granting refunds for defects or "not as described" |
| **Credit not processed** | a return received or in transit; a refund promised in messages; policy clauses that grant the refund being claimed; a returned-to-sender parcel sitting in stock, stated as such |
| **Subscription cancelled** | the cancellation request; policy clauses allowing cancellation at the time claimed; usage that stopped after the claimed cancellation |
| **Duplicate / incorrect amount** | a second charge that was in fact a duplicate; an amount that differs from checkout |
| **All types** | the merchant's own policies whenever their terms favour the cardholder on these facts; internal scores, completeness gaps, "missing evidence" language (`[[feedback_bank_optimized_rebuttal]]`) |

The same facts become **arguments** when they help. A delivery inside the published
window, a policy the cardholder accepted at checkout that bars the claimed remedy, and
3DS authenticated are all cited. Each fact is judged per case, never per field.

---

## 2. What the product does today: every path that stands the merchant down

| # | mechanism | what it does | where |
|---|---|---|---|
| S1 | **Fatal-loss gate**: `refund_issued` (refund on or after the dispute, or timing unknown) and `inr_no_fulfillment` | caps strength at weak, sets hero to `hard_to_win`, **auto mode blocks: the case is never filed** | `lib/automation/fatalLoss.ts`, `deriveCaseAutomationDecision.ts:204-209` |
| S2 | **Returned-to-sender gate** | caps at weak, **blocks auto-submit and the deadline filing** until the merchant answers the parcel-outcome questions | `lib/automation/returnedToSender.ts` |
| S3 | **No bank-eligible facts / `noSafeArgument`** | the defence package is skipped; **nothing is written** | `defence_package_skipped` / `no_bank_eligible_facts`; `plan_json.noSafeArgument` |
| S4 | **Stand-down copy** | *"Nothing is needed from you — let this one close"* (refund); *"there is nothing factual to argue with"* (no shipment); parcel-outcome copy that frames conceding as the honest call | `messages/*.json` `disputes.strengthReason.fatalLoss.*`, `…returnedToSender.*`; `ParcelOutcomeCard.tsx:21`; `parcel-outcome/route.ts:38` |
| S5 | **Rebuild banner** | *"structurally unwinnable condition … not re-saved to Shopify"* | `disputes.evidenceTab.rebuildOutcomeBanner.blocked_fatal_loss` |

Not stand-down paths, and kept: weak cases in auto mode `hold_for_deadline` and **file**
on the deadline (`deriveCaseAutomationDecision.ts:270-285`); the merchant's own Concede
control; coverage.

### 2.1 What they cost: prod, all time, latest pack per dispute

**S1, the fatal-loss gate: 11 disputes, all `inr_no_fulfillment`.** Zero on
`refund_issued`: the 2026-08-01 timing fix made a pre-dispute refund an argument, and
Shopify blocks refunds on an open chargeback (`[[reference_never_refund_an_open_chargeback]]`),
so the trigger that remains is almost unreachable.

| phase | outcome | filed by us? | n | amount |
|---|---|---|---|---|
| inquiry | **lost** | **no** | **5** | 263 |
| chargeback | lost | yes (Shopify's own scrape) | 3 | 302 |
| inquiry | won | no | 1 | 753 |
| inquiry | won | yes | 1 | 1 400 |
| chargeback | open | yes | 1 | 38 |

**S2, returned-to-sender: 6 disputes.** 5 won (4 of them inquiries won without a
filing), 1 open. The gate has not lost money yet. It is a stand-down all the same.

**S3, `no_bank_eligible_facts`: 22 disputes** (overlapping S1). Item-not-received
inquiries: **6 lost with nothing filed**. Item-not-received chargebacks: 3 lost. Credit
not processed: 4 won, 2 open.

The loss pattern is one shape: **an item-not-received inquiry, on an order with no
shipment, where we said nothing, lost by default.** An inquiry is answered or lost.
Silence was the one response with no chance.

---

## 3. The revisit: S1 and S2 stop standing down

### 3.1 Fatal-loss becomes a merchant-only risk signal

`detectFatalLoss` keeps detecting, because the merchant should know. What changes is
what it **does**:

| today | after |
|---|---|
| `deriveCaseAutomationDecision` returns `block` / `fatal_loss` | **removed.** The case follows the normal ladder: weak strength in auto mode means `hold_for_deadline`, **which files** |
| strength capped at weak, hero `hard_to_win` | kept. It is a private assessment, and the merchant deserves an honest read |
| copy: "let this one close", "nothing factual to argue with" | rewritten: say what we are filing and what would strengthen it. Never advise giving up (§3.4) |
| rebuild banner: "not re-saved to Shopify" | the rebuild saves like any other |

**Ordering is unchanged** where it still matters: coverage beats everything.
`returned_to_sender` and `fatal_loss` stop being ladder rungs that block, and become
inputs to argument selection and merchant copy.

### 3.2 What we argue on each former fatal-loss trigger

**`inr_no_fulfillment`: no shipment on record.** Available arguments, in order, all
already in the pipeline or in PR #766:

1. **Premature filing.** The dispute was opened before the merchant's published dispatch
   or delivery window closed (PR #766 §8.1). Measured against the policy version in force
   on the order date.
2. **Made-to-order, pre-order, or stated lead time** on the product or in checkout terms
   the cardholder accepted, when present.
3. **Customer communications** that help: agreement to wait, a changed address, a hold
   request (`delivery_recognition` and similar; never complaint text).
4. **Order record and authorisation facts** that establish a valid, cardholder-placed
   order: the minimal verified response (§4.3).

For an **inquiry**, (4) alone is still a response, and silence is a certain loss.

**`refund_issued`: refund on or after the dispute, or timing unknown.**

1. **Credit already issued.** The cardholder has the money. Stated as the fact it is,
   with the refund date and amount from `order.refunds[]`, **without** its timing
   relative to the dispute when that timing is unhelpful. This is the network's own
   double-credit argument. Today's header calls citing the refund *"a confession"*. For
   a refund the cardholder already holds, it is the defence: the merchant owes nothing
   further.
2. **Timing unknown** (today: conservatively fatal) → resolve it
   (`detectCreditAlreadyIssued`), then argue as (1). Never block on it.

### 3.3 Returned-to-sender files by default

The argument Klarna itself asks merchants to make (a refused or uncollected parcel *"is
not a valid use of the right of withdrawal … nor … a valid return"*) is available
whenever the carrier's own record shows refusal or non-collection
(`shopify_fulfillment_trackings.return_reason`, `ParcelOutcomeCard`'s
`reasonHintFromCarrier`). So:

- **Carrier reason = refused / not collected:** file on that argument without waiting for
  the merchant. Their answer can strengthen it; it no longer gates it.
- **Carrier reason unknown:** file the minimal verified response (§4.3) plus dispatch and
  carrier facts. Never state that the parcel came back. The merchant's answer, if it
  arrives before the deadline, upgrades the letter through a normal rebuild.
- The disposition answer (*"back in stock, no refund issued"*) stays **merchant-only**,
  as its own hint already promises. It is the textbook example of Stance rule 2.

### 3.4 Copy (all 6 locales, same PR, `[[feedback_translate_on_add]]`)

| key | today | after (EN, direction) |
|---|---|---|
| `strengthReason.fatalLoss.refund_issued` | "…the bank will read a defence as an admission… Nothing is needed from you — let this one close." | "A refund covering this charge has already been issued. We're defending on that basis: the customer already has the money. If you refunded before the dispute was opened, the defence is stronger still. Nothing is needed from you." |
| `strengthReason.fatalLoss.inr_no_fulfillment` | "…there is nothing factual to argue with…" | "This order has no shipment on record, which makes this a hard case. We'll still respond with the order and payment record. If it did ship, add the tracking number and we'll rebuild automatically. If it's made-to-order or still inside your stated dispatch time, that's an argument too; tell us." |
| `strengthReason.returnedToSender.*` | "…the bank will normally decide for the customer…" | "The parcel came back to you. We're responding on the carrier's record. Tell us why it came back to make the response stronger." |
| `rebuildOutcomeBanner.blocked_fatal_loss` | "…structurally unwinnable… not re-saved" | removed with the block |
| `ParcelOutcomeCard` header comment and route comment | "when conceding is the honest call" | deleted |

Hero `hard_to_win` stays: it is a private risk rating, not advice.

---

## 4. Enforcement: making "never volunteer" structural, for every type

### 4.1 One helpfulness judgement per fact, per case

`CaseArgumentPlan` is already the only owner of disclosure and issuer-facing claim
authority (`deriveArgumentPlan.ts:1-29`). It gains one thing: every fact carries
`bankEffect: "helps" | "hurts" | "neutral"` **for this case**, decided by the reason
family's rules (§1.1). Only `helps` and `neutral` can reach `plan.included`. That
generalises the field-level `bankEligible` gate (IP/location) to a case-level decision:
the same shipping policy helps on an on-time delivery and hurts on a late one.

### 4.2 Two layers, as for bank non-disclosure today

Per `[[feedback_bank_non_disclosure_two_layers]]`: (1) `hurts` facts are dropped before
the narrative prompt is built, and never reach the PDF or any appendix; (2) the
validator refuses sentences that cite them anyway (window numbers, refund clauses,
complaint quotes, failed checks). A test enumerates every `EvidenceFactCategory` × reason
family, and fails on a pair with no `bankEffect` rule, in the same style as the cron-gate
invariant.

### 4.3 The minimal verified response: never silence

When the plan holds no primary argument (`noSafeArgument`, `no_bank_eligible_facts`), the
system files a **deterministic** response instead of skipping. It contains the order
record, the authorisation facts that help, any dispatch or carrier facts, and the
merchant's published terms **where they help**, each true and sourced. PR #766 §9.8's
fallback rules apply: never a claim that depends on an unread source; never a prior
artifact that disagrees with a known fact. The `defence_package_skipped` path becomes the
exception it should always have been: a build failure, not a strategy.

### 4.4 Merchant-only "withheld" note

One component, shared by every type: *"Left out of your response, because it would help
the customer:"* followed by the list (e.g. "your shipping policy's 5–7 day window, since
this order arrived later"). It is rendered from the plan's `hurts` set, and it follows
the fatal-loss message's existing rule: merchant UI only, never bank-facing.

### 4.5 Completeness hints stop inviting harm

The completeness engine asks for `shipping_policy`, `refund_policy` and others by field.
A hint must not ask for a field whose `bankEffect` for this case is `hurts`. Otherwise we
ask the merchant to hand us the cardholder's argument (PR #766 §6.2 is the INR instance;
`[[feedback_ask_only_for_what_the_merchant_can_actually_do]]`).

---

## 5. Audit: what reaches the bank today that shouldn't

Before code, one read-only pass, per dispute type, over the last 90 days of prod
packages. For every bank-bound fact, apply §1.1 and list the ones that `hurt`. Deliverable:
a table of (fact, reason family, count of packages that carried it to the bank), plus
the letters quoted verbatim where the narrative argued from it. Already known instances:

- INR: `no_return_initiated` argued as corroboration of receipt (PR #766 D2; Case B,
  `f0036694`).
- IP/location: gated since the bank-optimized work; re-verify on the PDF path, which
  replaced the Shopify text-field path on 2026-05-16.
- Gorgias refund/cancellation history: hard-blocked (`[[project_gorgias_bank_category_exclusion]]`);
  re-verify on the canonical pipeline.

---

## 6. Phasing

| phase | content | depends on |
|---|---|---|
| **A** | Stance into CLAUDE.md (§7); S4/S5 copy rewrite (6 locales); delete the concede-advice comments | nothing |
| **B** | S1: remove the fatal-loss `block` rung; argue per §3.2. S2: file by default per §3.3 | A for copy |
| **C** | §4.3 minimal verified response replaces the skip | PR #766 §9.8 rules |
| **D** | §5 audit, then §4.1–§4.2 `bankEffect` + validator + invariant test; §4.4 note; §4.5 hints | audit output |

**Blast radius of B, to measure before merge:** every open dispute with
`fatal_loss.triggered` or `returned_to_sender.triggered` moves from blocked to
`hold_for_deadline` and **will file on its deadline**. Today: 1 open fatal-loss (a
chargeback, already filed by Shopify's scrape) and 1 open returned-to-sender (approved).
Print the exact set with amounts and deadlines at merge time
(`[[feedback_irreversible_scope_confirm]]`).

## 7. CLAUDE.md

Add a non-negotiable, *"The merchant's counsel"*, with the five rules of §1, the three
legitimate reasons not to file, and a pointer to this plan. Amend the **Fatal-loss Gate**
bullet: it is under revision per this plan, and no new gate may block filing or advise
conceding. Coverage remains the only automatic reason not to file.

## 8. Tests

1. `inr_no_fulfillment` in auto mode → decision is `hold_for_deadline`, **not** `block`;
   the deadline cron files it.
2. Same, as an inquiry, no other facts → the minimal verified response is produced and
   filed; `defence_package_skipped` is not emitted.
3. `refund_issued`, timing unknown → timing is resolved; the letter states the credit and
   its amount; no sentence places the refund after the dispute.
4. Returned-to-sender, carrier reason "not collected", no merchant answer → files on the
   not-a-valid-return argument; disposition never appears in the letter.
5. Returned-to-sender, carrier reason unknown → files the minimal response; never says the
   parcel came back.
6. Every `EvidenceFactCategory` × reason family has a `bankEffect` rule (invariant).
7. A `hurts` fact injected into the narrative input → dropped at layer 1; if forced into
   the prose → refused at layer 2.
8. The withheld note lists exactly the `hurts` set, and the bank PDF contains none of it.
9. No merchant-facing string in any locale advises conceding or letting a case close
   (grep gate alongside the forbidden-copy CI step).
10. The Concede control still works, and still prevents filing: the client's instruction.

## 9. Decisions (maintainer, 2026-09-23)

**D-1 · Always file our own response, on chargebacks too. Decided: yes.** On an inquiry,
silence is a certain loss. On a chargeback, Shopify files its own scrape if we don't
(`[[project_shopify_files_anyway_reframes_guards]]`). Ours replaces it in every case: it
is at least as strong, and it never argues against the merchant. §4.3's minimal verified
response is therefore the floor for **every** dispute, in every phase.

**D-2 · Keep `hard_to_win` as a private risk rating. Decided: yes.** The rating stays on
the merchant's Overview as an honest read of the case. It never gates filing, never
reaches the bank, and its copy never advises giving up (§3.4).
