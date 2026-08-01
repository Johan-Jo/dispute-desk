# Credit-already-issued defence theory

**Status:** PLAN ONLY — nothing implemented.
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

## 6. Open questions

1. **Partial credit.** Fire with honest partial wording, or only on full coverage? `162042cd` is the live example ($220 of $235).
2. **Post-dispute refunds.** Distinct state, or out of scope? The merchant has likely paid twice; the remedy may be operational rather than evidential.
3. **Does it supersede or compose?** If a case has both a strong authorization stack *and* a pre-dispute credit, do we argue one or both? Arguing both may read as hedging to a reviewer.
4. **Reason codes where a credit is not a defence.** Any where a pre-dispute refund does not moot the claim? Needs a pass against the Visa guidelines PDF ([[reference_visa_dispute_management_guidelines]]) and the Mastercard chargeback guide before we assert this is universal.
5. **Retirement of the existing refund strategies** — supersede or wrap.

---

## 7. Explicitly out of scope

- Anything that files, cancels, or alters a refund. This is evidential only.
- Changing the fatal-loss gate further; #479 already did what was needed.
- Chasing the ~$15 residual on `162042cd` operationally.
