# Defend the claim, not the label

**Status:** proposed, 2026-08-03.
**Raised by:** two consecutive prod disputes where the bank's label was wrong, found only because a human read the issuer's PDF by hand.

---

## 1. The problem

Every defence decision keys off `disputes.reason` — Shopify's 14-value
`ShopifyPaymentsDisputeReason` enum, which comes from the issuer's filing:

| Decision | Source |
|---|---|
| Reason family (`lib/argument/reasonFamily.ts`) | `reason` |
| Reason-code module: `prioritize` / `avoid` / `mustNotClaim` / `allowedFactCategories` | `reason` |
| Strategy ranking (`lib/defence/strategies/registry.ts`) | family |
| Checklist template + completeness | `reason` |
| Strength scoring (family-specific decisive signals) | family |
| Merchant-facing copy | family |

Two of two disputes examined in detail had the wrong label:

- **#345920** — labelled `PRODUCT_UNACCEPTABLE` / MC 4853. The issuer decided
  it on delivery: *"the shipping details you provided didn't include a tracking
  number or other proof of delivery."* We argued product conformity. Lost.
- **#352552** — labelled `PRODUCT_UNACCEPTABLE`. The issuer's claim document is
  a **fraud questionnaire**: *"cardholder did not participate"*, card never
  lost, never stolen, never used. We argued product conformity, and the label
  suppressed a Mastercard **ECI 02 liability shift** — the strongest fact in
  the file (fixed for 3DS specifically in PR #502; the general problem stands).

**We cannot verify the label.** The issuer claim and issuer response documents
are Shopify-Admin-only — not in `disputeEvidence.disputeFileUploads`, not
resolvable by `node()`, absent from the schema even on `unstable` (verified
2026-08-03, `docs/technical.md` § *What Shopify exposes…*). `networkReasonCode`
IS available and unused, but MC 4853 spans "not as described" AND "not
received" — our own `reasonCodeCatalog.ts` says so. It sharpens nothing here.

At one merchant a human catches this. At a hundred, nobody does.

## 2. Design principle

Stop betting the entire defence on one unverifiable label. Three layers, each
useful alone, in increasing order of ambition.

---

## 3. Layer 1 — a label may never suppress universally-safe evidence

Some evidence helps under one claim type and is merely *irrelevant* under the
others. It should never be gated on the reason code.

The first member shipped in PR #502: a **liability-shifted 3-D Secure
authentication** (ECI 02/05, authenticated, no exemption) is injected into
`allowedFactCategories` whatever the module says.

Generalise it into a named set — `ALWAYS_ADMISSIBLE_FACTS` — with an explicit
test per member answering *"can this read against us under any claim type?"*
Candidates to evaluate, not to assume:

| Fact | Helps under | Reads against us? |
|---|---|---|
| 3DS with liability shift | fraud (decisive) | No — shipped |
| AVS + CVV both matched | fraud | No |
| Delivery confirmed to the verified address | delivery, fraud | No |
| Prior undisputed order history (verified) | fraud | Only if the history contains a chargeback — already gated tri-state |
| Cardholder acknowledgement | every type | No |

Explicitly NOT in the set: attempted/exempted 3DS, IP/device signals
(`avoid`-listed for good reason), fraud screening on non-fraud claims.

**Cost:** small. **Risk:** low. **Independent of layers 2–3.**

---

## 4. Layer 2 — derive the claim shape from our own facts

Compute, from data we already hold, what the dispute *looks like* — with no
reference to the label — then compare.

```ts
// lib/disputes/claimShape.ts (new, pure)
type ClaimShape = "unauthorised" | "not_received" | "not_as_described"
                | "refund_owed" | "subscription" | "duplicate" | "indeterminate";

resolveClaimShape(facts) -> { shape, confidence, signals }
compareToLabel(shape, reason) -> "agrees" | "contradicts" | "ambiguous"
```

Inputs, all already collected:

- **Fulfillment / delivery**: `proofType`, `deliveredAt`, tracking presence,
  `fulfillmentStatus`. Nothing delivered + no tracking → leans *not_received*.
- **Customer communications** (Gorgias + Shopify timeline): the customer's own
  words to the merchant, pre-dispute. The closest thing we have to the claim
  document, and today it is used only as an evidence item, never as a signal
  about *what is being claimed*.
- **Refund/credit state**: a pre-dispute refund leans *refund_owed*.
- **Authentication**: AVS/CVV/3DS/fraud screening are the signals that *matter*
  under `unauthorised` — their presence doesn't prove the shape, but a
  fraud-shaped case is where they decide.
- **Subscription markers**: recurring line items, cancellation events.
- **`reasonDetails.networkReasonCode`** — wire it into the query (it is
  currently inferred from the enum, which makes it circular; see
  `lib/disputes/networkReasonCode.ts` header).

**Ship this in shadow mode first.** Run it across the 466 decided disputes and
measure how often it contradicts the label, and whether contradictions
correlate with losses. Change no defence until that number is known. If
contradiction is rare, layer 3 is not worth building; if it is common, we have
the evidence to justify it.

---

## 5. Layer 3 — respond to ambiguity instead of guessing

When the shape and the label disagree, or the network code is known-broad
(MC 4853, `GENERAL`, `CUSTOMER_INITIATED`), **defend both theories** rather
than picking one:

- Union the `allowedFactCategories` of both modules.
- Run both strategies; the narrative leads with the shape our facts support and
  answers the labelled claim second.
- `mustNotClaim` stays the **intersection** — a restriction from either module
  binds. Claim guards are unchanged: we still cannot assert what no fact backs.

This costs a longer letter and one extra strategy evaluation. It cannot make a
case weaker: every sentence still requires a fact.

**Merchant escape hatch — one question, only when it changes the outcome.**
When a contradiction is detected on an open dispute, ask exactly one thing on
the dispute page:

> The bank filed this as *product not as described*. Your customer's messages
> say the order never arrived. Which is it?  **[Never arrived] [Not as
> described] [Not sure]**

One click, no form, and it only appears when the answer changes the defence —
the rule from `feedback_ask_only_for_what_the_merchant_can_actually_do`.
"Not sure" is a real answer: it falls back to the union defence.

---

## 6. Learning loop

The issuer response is the only ground truth about *why we lost*, and it cannot
be fetched. It can be **given**:

- On a lost dispute, offer an upload slot: "Shopify Admin → this order →
  Chargeback → Issuer response. Drop the PDF here."
- Parse the stated reason, store it against the dispute, and correlate:
  claim shape vs label vs cited loss reason vs outcome.
- Availability is limited by design — Shopify only provides issuer responses
  for chargebacks that escalated from an inquiry and were lost, and not for
  every bank. Expect a minority, not the full 334.

That corpus is what turns layer 2's thresholds from judgement into measurement.

---

## 7. Non-goals

- **No LLM guessing at the true reason.** The shape resolver is deterministic
  and inspectable, like every other gate in the pipeline.
- **No overriding the label in `disputes.reason`.** The stored value stays what
  Shopify said; the shape is a parallel field. The admin override route
  (`final_outcome`, `submission_state`, …) is not extended to `reason`.
- **No merchant-facing "the bank got it wrong" copy.** We surface a question,
  not an accusation.

## 8. Rollout

| Step | Ships | Gate |
|---|---|---|
| 1 | `ALWAYS_ADMISSIBLE_FACTS` set (3DS already in) | tests per member |
| 2 | `networkReasonCode` selected in the dispute queries | — |
| 3 | `claimShape.ts` + shadow report over 466 decided disputes | contradiction rate measured |
| 4 | Union defence on contradiction / broad codes | step 3 shows it matters |
| 5 | One-question escape hatch on open contradictions | step 4 |
| 6 | Issuer-response upload + outcome correlation | independent |

## 9. Verification

- Unit tests per layer; shadow report is a script, not a behaviour change.
- Re-run the shape resolver over #345920 (expect *not_received*, contradicting
  `PRODUCT_UNACCEPTABLE`) and #352552 (expect *unauthorised*, contradicting the
  same label). Both are known-wrong labels with the answer independently
  confirmed by an issuer document — the only two ground-truth cases we have.
- No defence behaviour changes before step 4, and step 4 only on evidence.
