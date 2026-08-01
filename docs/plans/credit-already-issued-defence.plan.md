# Credit-already-issued defence theory

**Status:** IMPLEMENTED 2026-08-01 (PR follows this commit). Decisions 1, 3, 4, 6, 7 taken as recommended; decision 5 (retiring the older refund strategies) deferred — see §8.
**Raised:** 2026-08-01, from blume-box dispute `162042cd`.
**Prerequisite shipped:** the fatal-loss gate no longer treats a pre-dispute refund as unwinnable (PR #479), and the refund now appears on the fraud checklist (this PR).

---

## 1. The gap

DisputeDesk models exactly one winning theory per reason family, and for fraud that theory is **"the cardholder authorized this transaction."** Every fraud strategy argues some version of it:

```
lib/defence/strategies/
  unauthorized_fraud_auth_signal_stack.ts        AVS/CVV + 3DS
  unauthorized_fraud_customer_engagement_history.ts
  unauthorized_fraud_repeat_customer_pattern.ts  prior orders
  unauthorized_fraud_narrow_fallback.ts
```

There is a second, entirely different way to win, and we cannot express it: **the chargeback is moot because the cardholder already has the money.** A refund issued before the dispute was filed does not prove authorization — it removes the loss the dispute exists to remedy.

Today that argument only exists where the reason code happens to be about refunds (`credit_not_processed_*`, `duplicate_processing_refund_resolved`). A pre-dispute credit on a *fraud* claim, an *item-not-received* claim, or a *not-as-described* claim is invisible as an argument, even though the fact is collected and bank-eligible.

### The case that surfaced it

`162042cd` — FRAUDULENT, Mastercard 4837, $220.

| | |
|---|---|
| Refund issued | 2026-07-13 20:50 UTC, $220, full |
| Order cancelled + archived | same minute |
| Chargeback filed | 2026-07-31 21:00 UTC — **18 days later** |
| Authorization evidence | cardholder `Anthony Ku` vs account `jax hacy`; first-seen IP; Shopify risk HIGH/CANCEL; account 4 days old at order time |

The authorization argument is hopeless. The credit argument is close to unanswerable. We will file the first one.

---

## 2. What "winning" means here

Not a strength score — a different **claim**. The narrative should assert, in the issuer's terms:

> The transaction was credited in full on 13 July 2026, eighteen days before this dispute was filed. The cardholder has been made whole. Processing this chargeback would credit the same transaction twice.

No authorization claim. No reference to the cardholder's conduct. No mention of *why* the merchant refunded (a cancelled order, a fraud suspicion, a goodwill gesture — all of it either irrelevant or actively harmful to disclose, per the bank-non-disclosure rule).

---

## 3. Design sketch

### 3.1 Trigger

A new derived fact, computed once in `buildPack.ts` beside the fatal-loss gate (which already does the same timing comparison — extract the shared helper rather than duplicating it):

```
creditAlreadyIssued = {
  triggered: boolean,        // a refund strictly precedes disputes.initiated_at
  refundedAt: string,        // latest qualifying refund
  amount: number,
  coversDisputedAmount: boolean,   // refunded >= dispute.amount
  residual: number | null,         // dispute.amount - refunded, when positive
}
```

`coversDisputedAmount` matters: on `162042cd` the chargeback is **$235** against a **$220** refund, so ~$15 is genuinely uncovered. A full-coverage claim would be false. Partial coverage needs its own honest wording ("credited in full apart from…") or should decline to fire — **open question, see §6.**

### 3.2 Strategy

One reason-code-agnostic strategy, `credit_already_issued`, registered for every family rather than per-reason. Priority above the family's normal strategies when `triggered && coversDisputedAmount`, because it is the stronger claim wherever it applies.

Interaction with the existing refund strategies (`credit_not_processed_refund_record`, `duplicate_processing_refund_resolved`) must be resolved, not layered — those already argue something close to this for their own reason codes. Likely outcome: they become thin wrappers, or the new one supersedes them and they are deleted.

### 3.3 Strength treatment

`refund_record` already categorizes **strong** when `refundStatus === "processed"` with amount > 0. That is enough to lift the pack off "weak", but it is scored as a generic signal rather than as a decisive theory.

The honest model: when `creditAlreadyIssued.triggered && coversDisputedAmount`, the case is **strong on its own terms** regardless of what the authorization signals say — a full pre-dispute credit is not made weaker by a name mismatch. This needs a dedicated branch in `caseStrength.ts`, not a nudge to the signal count.

Guard: it must NOT fire when the refund landed *after* the dispute. That is a genuinely weaker position (the merchant may have paid twice already) and needs separate handling.

### 3.4 Automation

A covered pre-dispute credit is a clean auto-submit candidate: the facts are objective, the argument doesn't depend on judgement, and nothing about it is subjective the way a merchandise claim is. Recommend auto-submit rather than park — but confirm against `autoSubmitGuards` first.

---

## 4. Surfaces

| Surface | Change |
|---|---|
| Overview hero | Its own state — "Already refunded before the dispute" — not the generic strength copy |
| Evidence tab | The refund row leads (shipped in this PR) |
| Submit/Review | Narrative shows the credit argument, no authorization claims |
| PDF | Evidence Basis row leads with the credit + date |
| Emails | Should not tell the merchant a refunded case "needs evidence" |

All merchant-facing copy in six locales; nothing English in `lib/`.

---

## 5. Verification plan

- Unit: trigger timing (before / after / same timestamp / unparseable), partial vs full coverage, interaction with the fatal-loss gate, strategy selection precedence per reason family.
- Prod dry-run: count disputes where a pre-dispute credit covers the disputed amount, per reason code, before changing any scoring. `scripts/sql/` — reuse the `detectFatalLoss` timing logic so the measurement and the code agree.
- Render the actual narrative on `162042cd`'s real data before shipping (per the "render it on prod data first" lesson from #374/#380).

---

## 5a. Research findings (2026-08-01)

Researched against Visa, Mastercard and Shopify documentation to close §6. Each finding is marked **VERIFIED** (found in the cited source) or **UNVERIFIED** (could not reach a primary source — do not build on it without checking).

### F1 — A pre-dispute credit is an *invalidity* ground, not a compelling-evidence category. **VERIFIED**

Visa's *Dispute Management Guidelines for Visa Merchants* — the reference we calibrate against — lists **"credit or reversal has already been processed for the transaction"** among the grounds that make a dispute **invalid**, and directs merchants to supply documentation showing the credit/reversal details. An invalid claim is voided by the issuer rather than forwarded. Visa's cardholder-facing guidance states the same from the other side: *"If you have already received a full refund directly from the seller, you cannot make any further chargeback."*

**This is the single most important finding, and it changes the design.** "Credit already issued" is not a better argument *within* the fraud theory — it says the dispute should never have existed. That is why it is reason-code-agnostic: invalidity attaches to the transaction, not to the claim type. It vindicates the §3.2 sketch (one strategy registered across families) and it means the narrative should assert invalidity, not rebut authorization.

Industry practice agrees on outcome: representment with refund proof is described as *"one of the more straightforward disputes to win, provided you submit evidence before the deadline"*, with ARN, timestamps and refund confirmation as the evidence set.

### F2 — THREE orderings, not two. Only one of them is blocked. **VERIFIED (docs + prod data)**

The first draft of this section split the world into refund-before-dispute and refund-after-dispute, and concluded the second was unreachable. Querying prod showed that taxonomy was wrong. There are three:

| | Ordering | Allowed? | Correct response | Prod (all packs) |
|---|---|---|---|---|
| **A** | Refund → **chargeback** later | Yes. Nothing can stop a cardholder filing | Represent with the credit documentation (F1) | 1 — `162042cd` |
| **B** | **Chargeback** open → merchant refunds | **No** — Shopify blocks it | n/a | 0 |
| **C** | **Inquiry** → merchant refunds | Yes, and it is the textbook play | Refund resolves it; no representment needed | 2 — both **won** |

Shopify on B only:

> "Refunds can't be issued while a chargeback is open. The funds have already been withdrawn by the bank and are held pending the dispute resolution."
>
> "You can't issue a refund after a cardholder initiates a chargeback. If you determine that a refund is warranted for an open chargeback, then the cardholder must first drop the chargeback, and then you can provide a refund."

**A is not prohibited and cannot be.** Visa's rules say the *issuer* should screen such a dispute out as invalid (F1), but that is a rule issuers are meant to apply, not a technical block — and `162042cd` is proof they raise them anyway. That is exactly why the representment path matters.

**C is the case the first draft missed.** An inquiry is a pre-dispute retrieval request, not a chargeback, so Shopify's block does not apply and refunding is the encouraged resolution. Both prod instances (cay-collective, `CREDIT_NOT_PROCESSED`, `phase = inquiry`) were refunded days after initiation and **won**.

**Design consequences:**

1. Do not build a state for B — the platform prevents it. `detectFatalLoss`'s conservative fallback covers any residue (a refund racing the dispute webhook, or an off-Shopify credit).
2. **`detectFatalLoss` needs a `phase` guard.** It currently compares the refund against `initiated_at` with no regard for phase, so on an inquiry resolved by a refund (case C) the refund lands *after* initiation, the gate fires, and we tell the merchant a correctly-handled case is structurally unwinnable. Both prod instances were won, so this is a messaging defect rather than an outcome one — but it is wrong and it is cheap to fix: when `phase = inquiry`, a later refund is a resolution, not a concession.

### F3 — Shopify has NO evidence field for a credit already issued. **VERIFIED**

The Dispute Evidence resource carries: `access_activity_log`, `customer_email_address`, `customer_first_name`, `customer_last_name`, `uncategorized_text`, `shipping_address`, `cancellation_policy_disclosure`, `cancellation_rebuttal`, `refund_policy_disclosure`, `refund_refusal_explanation`, `billing_address`, `product_description`, `fulfillments`, `dispute_evidence_files`.

There is no field for a processed refund. Two consequences, one of them a trap:

- The argument must travel in **`uncategorized_text`** (already the fraud path — see *Shopify evidence mapping*), with the refund receipt attached via `dispute_evidence_files`.
- **`refund_refusal_explanation` must never be used for this.** It means *why a refund was refused* — the opposite of what we are asserting. Populating it to say "we refunded" would tell the reviewer we declined the refund. This needs to be a hard rule in the implementation, and a test.

### F4 — Partial credit: represent, with honest arithmetic. **VERIFIED (practice) / UNVERIFIED (formal mechanism)**

The documented approach for a chargeback exceeding a partial refund is to present the timeline and the refund proof, on the argument that the cardholder cannot collect the same money twice. Outcome is either cardholder withdrawal or a processor ruling on review.

No source describes a formal mechanism for representing *only the covered portion*, and Shopify's evidence submission carries no amount field — it is text and files, all-or-nothing. So we cannot split the claim.

**Recommendation:** fire on partial coverage too, with wording that names both figures and never says "in full" unless `refunded >= disputed`. On `162042cd` that means asserting a $220 credit against a $235 dispute and letting the reviewer weigh the $15, rather than either staying silent or overclaiming.

### F5 — Mastercard's formal second-presentment code. **UNVERIFIED**

I could not reach a primary Mastercard source: the official *Chargeback Guide* PDFs are 403 or unindexed, and the secondary reason-code references cover only first-presentment chargeback codes (4837, 4853, 4842 …), not the acquirer-side second-presentment codes. I could not confirm the existence or number of a "Credit Previously Issued" second-presentment code.

**Do not cite a Mastercard code number in code, copy, or narrative until someone reads the current Chargeback Guide.** F1 stands on Visa's documentation; the Mastercard path is presumed analogous but unproven. Practically this may not matter — we submit evidence text to Shopify, and the acquirer selects the code — but it must not be asserted.

### F6 — Winning does not refund the chargeback fee. **VERIFIED (conditional)**

*"Some processors refund chargeback fees on successful representment, while others do not."* So a won credit-already-issued case still likely costs the fee. It does not change whether to fight — the alternative is losing the disputed amount *as well* — but it should temper any "clear win" language we put in front of a merchant.

---

## 6. Decisions needed

Research closed four of the five. What remains is genuinely a product call.

| # | Question | Research says | Recommendation |
|---|---|---|---|
| 1 | **Partial credit** — fire on partial, or full coverage only? | No formal split-claim mechanism; Shopify has no amount field (F4) | **Fire on partial**, naming both figures, never "in full" unless covered |
| 2 | **Post-dispute refunds** — build a state for it? | Three orderings, not two: A representable, B blocked by Shopify, C (inquiry→refund) allowed and already winning (F2) | **Don't build B.** But **add a `phase` guard to `detectFatalLoss`** so case C stops being labelled unwinnable |
| 3 | **Supersede or compose** with a strong authorization stack? | Not addressed by any source | **Supersede.** F1 makes this an invalidity claim; pairing it with "and also he authorized it" weakens both |
| 4 | **Reason codes where credit is not a defence** | Visa frames it as transaction-level invalidity, not claim-type specific (F1) | **Reason-code-agnostic**, as sketched |
| 5 | **Retire the existing refund strategies?** | Not addressed | Open — needs a read of `credit_not_processed_refund_record` and `duplicate_processing_refund_resolved` against the new one |

### Two new decisions the research surfaced

6. **Auto-submit or park?** The facts are objective and the argument needs no judgement, which argues for auto-submit. Against: winning still costs the chargeback fee (F6), and we have never auto-submitted an invalidity claim before. **Recommendation: auto-submit**, on the same footing as any other Strong case.

7. **Strength representation.** F1 says this is not "strong evidence for the fraud theory" — it is a claim that the dispute is invalid. Modelling it as a strong *signal* understates it and mixes two theories in one score. **Recommendation: a dedicated `caseStrength` branch** that returns strong-with-its-own-reason when a pre-dispute credit is present, rather than adding to `strongCount`.

---

## 7. Sources

- Visa — *Dispute Management Guidelines for Visa Merchants* (June 2024): invalid-dispute grounds incl. credit/reversal already processed. [[reference_visa_dispute_management_guidelines]]
- Visa — [consumer chargeback guidance](https://www.visa.co.uk/how-you-pay-matters/chargeback-purchase-disputes.html): no chargeback after a full refund from the seller
- Shopify — [Resolving a chargeback or inquiry](https://help.shopify.com/en/manual/payments/chargebacks/resolve-chargeback): refunds blocked while a dispute is open
- Shopify — [Dispute Evidence API](https://shopify.dev/docs/api/admin-rest/latest/resources/dispute-evidence): full field list; no credit-issued field
- [Chargeback Gurus — preventing double refunds](https://www.chargebackgurus.com/blog/chargebacks-preventing-double-refunds)
- [Chargeflow — chargeback after a refund](https://www.chargeflow.io/blog/receiving-a-chargeback-after-a-refund): evidence set, win likelihood, fee treatment
- [FightDisputes — chargeback after a partial refund](https://fightdisputes.com/guide/chargeback-after-partial-refund/)
- **Not reached:** Mastercard *Chargeback Guide* (403 / unindexed) — see F5

---

## 7. Explicitly out of scope

- Anything that files, cancels, or alters a refund. This is evidential only.
- Changing the fatal-loss gate further; #479 already did what was needed.
- Chasing the ~$15 residual on `162042cd` operationally.

---

## 8. What shipped (2026-08-01)

| Piece | Where |
|---|---|
| Shared timing helper — the one comparison | `lib/automation/creditTiming.ts` |
| Fatal-loss gate reads it + `phase` guard for inquiries | `lib/automation/fatalLoss.ts` |
| Timing + coverage carried into the refund fact | `lib/packs/sources/orderSource.ts`, `lib/defence/factClassifier.ts` |
| `credit_preceded_dispute`, `credit_covers_disputed_amount` | `lib/defence/factPredicates.ts` |
| Cross-family strategy, priority 100 | `lib/defence/strategies/credit_already_issued.ts` |
| Strength FLOOR (not a signal) + hero + reason token | `lib/argument/caseStrength.ts` |
| `credit_already_issued` block in `pack_json` | `lib/packs/buildPack.ts` |

**Decisions as implemented.** Partial credits fire the strategy but do **not** reach the strength floor — the floor needs `coversDisputedAmount`, because an uncovered balance still has to be defended on the family's own merits (decision 1, refined during implementation). The strategy supersedes rather than composes: priority 100 beats every family strategy, and the prompt forbids arguing the family's theory alongside it (decision 3). It is registered under all nine families (decision 4). Strength is a floor, not another point on `strongCount` (decision 7).

**Two prompt rules worth keeping.** The narrative may not declare the dispute "invalid" — that determination is the issuer's, and asserting it reads as overreach. And "in full" is gated on `credit_covers_disputed_amount`, so `162042cd`'s $220-against-$235 names both figures instead of overclaiming.

**Registry invariants.** `credit_already_issued` is the first strategy registered under every family, which broke two one-strategy-per-family invariants. They now exempt an explicit `CROSS_FAMILY_STRATEGY_KEYS` set and a new invariant asserts each such strategy really is registered everywhere — the checks stay meaningful for family-specific strategies.

### Still open

- **Decision 5 — retiring `credit_not_processed_refund_record` / `duplicate_processing_refund_resolved`.** Both now sit below `credit_already_issued` and fire on `refund_processed` (any refund) rather than a pre-dispute one, so they remain the right strategy when a refund exists but did *not* precede the dispute. Note `duplicate_processing_refund_resolved` carries the instruction *"Never argue the chargeback is invalid because of the refund"*, written before the Visa research; it does not contradict the new strategy (which also avoids the word "invalid") but the two should be read together before either is retired.
- **Automation (decision 6).** `autoSubmitGuards` was not touched. A credit-already-issued case now scores `strong`, so it follows the existing Strong auto-submit path — no new gate. Verify that is what happens on a real case before relying on it.
- **F5 — the Mastercard second-presentment code remains UNVERIFIED.** Nothing in the shipped code cites one.
