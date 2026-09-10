# The returned-parcel argument must be made per means of payment

**Status:** PLAN ONLY (v1, 2026-09-10). Not started.
**Deliverable:** stop asserting a Klarna/EU consumer-law claim as if it were a
universal rule. Make the returned-to-sender argument branch on the means of
payment — Klarna, card network, PayPal — and on whether the merchant actually
has the one thing that wins these cases: a pre-disclosed uncollected-goods
policy. Wire the merchant's answer into a bank-facing argument, which today it
never reaches.
**Deployment:** prod = `master` `52b69eb4`. All figures read from prod
(`aokhplydttxtebvbeuzc`) on 2026-09-10.
**Reported by:** the merchant, on cay-collective dispute
`b47f312a-39d1-48ca-a404-1cb8fed71d9a` (Order #13638, SEK 434,
CREDIT_NOT_PROCESSED, due 2026-09-14), asking a question our copy could not
answer: *"If it's refused or uncollected, how can the merchant then claim they
have fulfilled duties?"*

> **The honest answer is: generally, they can't.** That is the finding this plan
> is built on, and it inverts what the product currently tells merchants.

> **Out of scope:** the returned-to-sender gate's *automation* decision. Blocking
> auto-submit and the deadline filing is correct for every payment method — a
> human should decide these — and nothing here changes that. Also out of scope:
> rebuilding packs for the three affected disputes (§7 covers them separately),
> and the `disposition` field, whose merchant-only confinement is correct and
> must survive this plan intact.

---

## 1. What we tell merchants today

On the Evidence tab, as the single "Required" item on an otherwise-blocked case:

> **Returned Parcel Outcome** · Critical · Required
> Explains why a parcel that came back to you was never taken — **a refused or
> uncollected delivery is not a valid return**, which is the one argument still
> open on this dispute

And in the card itself (`disputes.evidenceTab.parcelOutcome.subtitle`):

> If the customer refused the parcel or never collected it, **that is not a
> valid return** — and it is the one argument still open on this dispute.

Four places repeat it: `disputes.whyText.returned_parcel_outcome`,
`…parcelOutcome.subtitle`, `…parcelOutcome.reasonHint`, and
`help.articles.returnedToSenderParcels.body`, in all 6 locales.

## 2. Where the claim came from, and what it actually supports

It is not invented. Klarna's merchant documentation says it verbatim:

> "If a customer does not accept the delivery of the order or does not pick-up
> the goods, they will be sent back. This is not a valid use of the right of
> withdrawal (in the EU) nor is it considered a valid return."

Our code cites this in `lib/automation/returnedToSender.ts:21`,
`lib/shopify/deliveryEventClassifier.ts:137`, `lib/defence/factClassifier.ts:567`,
`lib/automation/autoSubmitGuards.ts:144`, and `docs/technical.md` §2718/§2789.

**The claim is true and narrow.** It resolves one question — *did refusing
validly withdraw from the contract?* — and the answer is no. Art. 11 of the
Consumer Rights Directive (2011/83/EU) requires the model form or "any other
unequivocal statement"; silence is not one. ECC-Net confirms: "Refusing delivery
or not picking the goods up at the post office would not as such count as valid
expressions of withdrawal."

**It does not resolve the question that decides the dispute** — *did the merchant
perform, so they keep the money?* Two separate questions, and the product has
been conflating them:

| | Question | Answer | Favours |
|---|---|---|---|
| 1 | Did refusing validly *withdraw*? | No | Merchant (weakly) |
| 2 | Did the merchant *perform*? | **No** | **Customer** |

On (2), **Art. 20 CRD is mandatory law and cannot be contracted around** for
consumer sales: risk passes only when the consumer "has acquired the **physical
possession** of the goods." The Commission's guidance (2021/C 525/01), quoted in
the ECC-Net position paper of 12 July 2024 §7:

> "Where the consumer has never taken physical possession of the goods, e.g. by
> refusing to take delivery … **the trader would continue bearing the risk** of
> loss or damage since no transfer of risk to the consumer will have taken
> place according to Article 20."

Worse: the 14-day withdrawal clock runs *from* physical possession, so a refusing
consumer's withdrawal right typically **stays open indefinitely** rather than
expiring.

Note the merchant intuition this displaces — INCOTERMS-style "risk passed on
tender of delivery" is a B2B trade concept and does not apply to consumer sales.

**And Klarna's own binding terms say the same thing.** Merchant Protection
Program Terms (July 2026):

- **2.2** — an uncollected-goods fee is chargeable **only** if clearly stated in
  your T&Cs pre-purchase, and must not equal or exceed order value.
- **2.3** — "You must **fully refund** the Customer if your terms and conditions
  do not include any information regarding uncollected goods."
- **2.5** — full refund if the parcel never reached them and they had no
  opportunity to collect it.

So even on Klarna, where the sentence is sourced, it does not mean the merchant
keeps the money. It means the *withdrawal* was not formally exercised.

## 3. The card networks have no such rule

This is the part that makes the current copy unsafe rather than merely
imprecise.

**Visa** — a full-document enumeration of the *Dispute Management Guidelines for
Visa Merchants* (June 2024) finds the words *refused*, *unclaimed*, *uncollected*,
*undeliverable*, *attempted delivery* and *returned to sender* **absent from any
delivery context**. This is a verified absence, not a failed search. For 13.1 the
only listed outcome where goods did not reach the cardholder is: "**Accept the
dispute.**" Visa's own prevention advice defines the evidence target as proof the
goods were "delivered to the correct address or picked up and signed for" —
*completed* delivery, which a returned parcel can never show.

**Amex C04** is titled "Goods/Services Returned or **Refused**," and the sole
rebuttal for the refusal branch is "Proof that the goods/services were
**accepted**" — logically unavailable in a genuine refusal.

**Discover RG** lists "**Delivery was refused**" as a cardholder trigger, not a
merchant defence. Discover **RN2** exists precisely for "the cardholder refused
delivery … but should have received a credit."

**Mastercard** — the rulebook is behind a bot wall and could not be retrieved.
Recorded as an **unverified gap**, not assumed either way. (4855 is retired;
these ride under 4853.) §8 tracks closing it.

**Visa CE 3.0 is irrelevant here** — it applies to 10.4 card-absent fraud, never
to a 13.x consumer dispute. Practitioner content that conflates them is wrong.

**The one lever that does exist** in the rulebooks is **pre-disclosed policy** —
Visa 13.7 ("Return, refund, and cancellation policies were properly disclosed …
agreed to at the time of sale") and the Amex C04 policy branch. That, not the
withdrawal argument, is what a card case turns on.

### Practitioner folklore to keep out of the product

Commonly repeated, unsupported by any rulebook we could read: that attempted-
delivery scans win the case; that notice cards and pickup-point expiry records
are compelling evidence; that refusal proves the cardholder received the benefit
(flatly contradicted by Amex C04). These records are worth holding — they rebut
a *fraud* or *never-shipped* allegation and show good faith — but they do not
satisfy the proof-of-delivery element these codes actually turn on, and the
product must not imply they do.

## 4. Why this has not blown up yet, and why it will

All three returned-to-sender disputes in prod are Klarna, so today's copy is
**accidentally** correct:

| dispute | reason | phase | payment family | due | amount |
|---|---|---|---|---|---|
| #13195 | CREDIT_NOT_PROCESSED | chargeback | Klarna — Pay Later | Sep 19 | SEK 400 |
| #13638 | CREDIT_NOT_PROCESSED | inquiry | Klarna — Pay Later | **Sep 14** | SEK 434 |
| #14656 | PRODUCT_NOT_RECEIVED | inquiry | Klarna — Pay Later | Sep 23 | SEK 978 |

But `detectReturnedToSender` takes **no payment context**
(`lib/automation/returnedToSender.ts:93`), and the pack population is:

| payment family | packs | RTS triggered |
|---|---|---|
| *(null)* | 124 | 0 |
| **card** | **100** | 0 |
| **paypal** | **78** | 0 |
| klarna | 16 | **3** |
| other / unknown | 4 | 0 |

The first card RTS case renders EU-withdrawal reasoning to a Visa cardholder and
tells the merchant it is "the one argument still open." That is a merchant acting
on our advice into a dispute Visa's own rulebook says to concede.

## 5. Two defects that are not about the law

**5.1 The merchant's answer reaches no bank argument.**
`lib/defence/factClassifier.ts:584` computes `citableReason` — "what the writer is
handed" per its own comment. Nothing consumes it. No strategy, no predicate, no
overlay references it (`grep citableReason` returns only its definition, and
`klarnaOverlay.ts` says nothing about refused/uncollected parcels). So the UI
labels this **Required** and "the one argument still open," the merchant answers
it, and the answer goes nowhere. Whatever we decide about the law, this is a
broken promise.

**5.2 Cay Collective has no uncollected-goods clause.** Their refund policy
snapshot matches a naive `uncollected|uthämt|refus` regex, but reading the clause
shows a marketplace return policy whose 14 days run "**within 14 days of
receiving your item**" — which never happened. There is no uncollected-goods term.
Under Klarna §2.3 that means **all three disputes owe a full refund**, and the
product is currently urging the merchant toward an argument they cannot make.

## 6. The change

**Organising principle: the argument is a property of the means of payment.** The
codebase already models this correctly — `PaymentContext` is deliberately "a
first-class dimension PARALLEL to card network … so evidence + narrative can
branch intentionally instead of silently degrading"
(`lib/disputes/paymentContext.ts:4`), and `lib/defence/paymentOverlays.ts` already
layers per-method framing with hard-banned phrases. This plan uses those seams
rather than adding new ones.

### 6.1 Thread payment context into the gate

`detectReturnedToSender` gains `paymentFamily` and `consumerRegion` inputs.
`buildPack.ts` already computes `paymentContext` at line 336 and already branches
on it (`klarnaInquiryTemplateOverride`, line 569) — pass it at line 795. The
summary gains an `argumentBasis` discriminator:

| basis | when | what the merchant is told |
|---|---|---|
| `eu_withdrawal_formality` | Klarna **and** EU consumer | withdrawal wasn't validly exercised — **but** a refund is still owed unless terms disclosed an uncollected-goods fee |
| `disclosed_policy` | card / PayPal, or non-EU Klarna | the only lever is a pre-disclosed uncollected-goods policy |
| `none` | `undeliverable_address`, any method | nothing to argue |

The gate's automation decision is **unchanged** in every branch: still capped at
weak, still blocks auto-submit and the deadline filing. Only the explanation
moves.

### 6.2 Rewrite the copy so it stops implying the merchant keeps the money

Retire "a refused or uncollected delivery is not a valid return" as a standalone
claim in all 4 keys × 6 locales. Replace per basis. Klarna/EU:

> Refusing a parcel or leaving it uncollected is **not** a formal exercise of the
> right of withdrawal — so this is not a return, and it is worth saying. But the
> customer is still owed a refund unless your terms disclosed an
> uncollected-goods fee before purchase, and the risk of loss stayed with you
> the whole time.

Card/PayPal:

> The card networks have no rule that a refused or uncollected delivery favours
> the merchant — Visa's guidance treats an undelivered order as one to concede,
> and Amex asks for proof the goods were *accepted*. The one argument that
> counts is a **return or uncollected-goods policy you disclosed before
> purchase**.

Per `[[feedback_no_bare_gateway_codes_merchant_copy]]`, no bare reason codes in
merchant copy — the bank letter may cite them; the merchant UI names the rule in
plain language.

### 6.3 Ask the question that actually changes the outcome

Not "was anything wrong with the delivery?" — that invites narrative we cannot
use and may not want. Add **one** question to `ParcelOutcomeCard`, shown for every
payment method:

> **Did your terms, shown before purchase, say what happens if a parcel isn't
> collected?**  ·  Yes / No / Not sure

Pre-check it against the `policy_snapshots` we already store (refunds, shipping,
terms), and show what we found so the merchant confirms rather than guesses —
the same pattern as the existing `reasonHintFromCarrier` help text, which already
pre-fills the carrier's own refused/not-collected inference. `answered = yes` +
a matching clause is the only state that produces a bank-facing argument on a
card case.

Keep the existing `reason` and `disposition` questions exactly as they are.
Keep `disposition` merchant-only — "we restocked it and kept the money" is a
confession and must never reach a bank.

### 6.4 Wire the answer into a real argument (closes 5.1)

Add a `returned_parcel_disclosed_policy` predicate and a strategy that cites the
disclosed clause plus the shipment and attempt records. Shopify already accepts
this shape: `refundPolicyDisclosure` and `refundPolicyFile` exist on
`disputeEvidenceUpdate` (`lib/shopify/mutations/disputeEvidenceUpdate.ts:58,65`)
and we already collect `Shop.shopPolicies`. Extend `klarnaOverlay.ts` and
`paypalOverlay.ts` with the per-method framing; card cases route through the
disclosed-policy strategy.

Bank-facing discipline per `[[feedback_bank_optimized_rebuttal]]` and
`[[feedback_bank_non_disclosure_two_layers]]`: **never** write "the customer
refused delivery" into bank text — to an issuer that reads as an admission of
non-performance. Cite the disclosed policy, the shipment, and the attempt; let
the carrier record carry the fact.

### 6.5 Recommend the honest outcome

When `argumentBasis = disclosed_policy` and no clause is found, the merchant-facing
recommendation becomes **refund** — with the reasoning shown, not asserted.
Consistent with the existing hero copy, which already says "If you kept the goods
and the money, the fair answer is to refund," and with
`[[project_shopify_files_anyway_reframes_guards]]`: holding is honesty, not odds.

This is a recommendation, never an action. DisputeDesk does not refund on the
merchant's behalf.

## 7. The three live disputes

Not a rebuild — none of these needs a regenerated pack to be handled correctly.
Cay Collective has no uncollected-goods clause (§5.2), so under Klarna §2.3 all
three owe a full refund. #13638 is due **2026-09-14**. Worth telling the merchant
before the deadline rather than after, independent of when the code ships.

## 8. Open questions

1. **Mastercard is unverified.** The rulebook could not be retrieved. Until it
   is, card cases use the Visa/Amex-shaped `disclosed_policy` framing, which is
   the conservative choice. Do not assert a Mastercard position in copy.
2. **`consumerRegion` needs a definition.** Shipping country, billing country, or
   shop locale? Art. 20 CRD follows the consumer, so shipping country is the
   likely answer — but a Swedish shop shipping to the US is a real case and the
   pack carries `countryCode` on both addresses.
3. **Is this a fatal-loss trigger?** Structurally the POD element cannot be
   satisfied, which resembles the existing `refund_issued` reasoning. Recommend
   **no** for now: unlike a refund already issued, a narrow disclosed-policy path
   genuinely exists under 13.7/C04, so a hard block would be too strong. Revisit
   once §6.3 tells us how often a clause actually exists.
4. **Does a UK/EEA split matter?** The UK's post-Brexit CCRs mirror the CRD here,
   but this has not been verified and no prod case has needed it yet.

## 9. Verification

- Unit: `detectReturnedToSender` returns the right `argumentBasis` per
  (family × region × reason), including the `undeliverable_address` → `none` case.
- Invariant test: the string "not a valid return" appears in **no** locale file
  outside a Klarna+EU-gated key — the class fix, in the spirit of
  `[[feedback_fix_the_class_not_the_instance]]`.
- Invariant test: no bank-facing narrative may contain "refused delivery" /
  "never collected" (extend `BNPL_PROHIBITED_CARD_PHRASES`' enforcement pattern
  to a new bank-facing ban list).
- Render the Evidence tab for a synthetic card RTS case and a Klarna RTS case;
  confirm the two read differently and neither overstates.
- `npm test`, `npx tsc --noEmit`, `npm run build`.
- i18n parity across all 6 locales (`scripts/verify-i18n-parity.mjs`).

## 10. Sources

- Visa, *Dispute Management Guidelines for Visa Merchants* (June 2024) — primary,
  enumerated in full for the verified absence in §3.
- Klarna, *Merchant evidence gathering* docs — the verbatim claim.
- Klarna, *Merchant Protection Program Terms* (July 2026) §§2.2, 2.3, 2.5.
- Directive 2011/83/EU (Consumer Rights Directive), Arts. 9, 11, 13, 14, 20.
- Commission Notice 2021/C 525/01 — guidance on the CRD.
- ECC-Net, *Parcel delivery issues met by ECC-Net in the e-commerce sector*
  (12 July 2024) §7.
- Chase/Paymentech, *Chargeback Reason Code User Guide* — primary text for
  Amex C04 and Discover RG/RN2.
- Mastercard *Chargeback Guide* — **not retrievable** (403); gap recorded in §8.
