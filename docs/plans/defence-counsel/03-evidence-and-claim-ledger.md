# Plan 3: Evidence and the claim ledger

Counsel can only be as good as the evidence it is handed. Today the letter model receives **two** facts for the reference case. This plan lists everything we hold, decides what reaches the model, and turns it into a **claim ledger**: a code-built list of statements the letter may make, each proven by a record.

## 1. Everything held for #352543

The source is `case-352543/inputs.json` (the evidence pack's `pack_json.sections`, plus the dispute row). "Reaches model today" refers to Appendix A.

| # | Evidence | Value (reference case) | Reaches model today? | Relevance to non-receipt |
|---|---|---|---|---|
| 1 | Carrier delivery record | Stallion Express, "delivered", 6 Jul 2026 19:53 UTC, tracking 260702441A, public tracking URL | ✅ (`delivery_proof`, `shipping_tracking`) | **Core** |
| 2 | Fulfilment → line-item mapping | One fulfilment; all 3 order lines, in the quantities ordered, mapped by line-item ID (verified 25 Sep) | ❌ (only used by the template) | **Core**: the delivery covers the whole order |
| 3 | Timing | Ordered and paid 2 Jul; shipped 2 Jul; delivered 6 Jul; dispute opened 19 Sep (75 days after delivery) | ❌ (only dates inside facts) | **Strong**: the sequence, and the interval after a delivery notice |
| 4 | Order-history emails | Shipping confirmation 2 Jul; "shipment delivered" email 6 Jul; both to the order's email address | ❌ | Supporting: the cardholder was sent notice of delivery that day |
| 5 | Order total vs disputed amount | Equal (CAD 120.75) | ❌ | Scope: the delivered shipment covers the full claim |
| 6 | Customer history | `totalOrders: 2`, `isRepeatCustomer: true`, `customerSince` 2 Jul 2026 05:24 (the same morning), `priorUndisputedOrders: 0` | ❌ | **Unknown until checked**: when was the second order placed? See open question Q1 |
| 7 | Checkout IP | Same country as shipping; no VPN, proxy or datacenter; low risk; `bankEligible: true`; a bank-ready paragraph exists | ❌ | Weak for non-receipt; strong for fraud claims |
| 8 | Payment | Visa via **Apple Pay** | ❌ | Weak for non-receipt; strong for fraud |
| 9 | Billing vs shipping | Same city, province and postal prefix | ❌ | **Forbidden** as a delivery claim (rule 14). May only be used in fraud letters, and only via the verified wording rules |
| 10 | Published shipping policy | Snapshot captured 20 Jul 2026, published URL | ❌ | Supporting: shipped within the published policy (check the text first) |
| 11 | Refund, cancellation and return policies | Snapshots | ❌ | Not relevant to non-receipt; policies must not be volunteered |
| 12 | Shopify Protect | `isCovered` / state | ❌ | Internal routing only; never in a letter |
| 13 | Customer support conversations (Gorgias) | blume-box has Gorgias connected; the case has a Gorgias comms section | ❌ | **Potentially strong**: any post-delivery contact that does not report non-receipt, or that acknowledges the order. Refund and cancellation threads are hard-blocked from bank letters (existing rule) |
| 14 | Carrier event detail | Carrier scan events (text, time); possibly a delivery photo or proof-of-delivery page at the carrier | Partially (delivery date only) | **Potentially strong**: needs a legal check against rule 14 (see Q3) |

### 1.1 Why only two facts reach the model (from the stored `plan_json` and `facts_json`)

Two filters run in sequence. Both are built to decide what is **safe** to show a bank; neither asks what **helps** the argument.

1. **The argument plan** (`plan_json`, policy v1, `reasonModuleId: inr_product_not_received`):
   - **Included:** `order_confirmation`, `shipping_tracking`, `delivery_proof`, `shipping_policy`.
   - **Excluded as `not_argument_relevant`:** customer history (`activity_log`, `customer_account_info`), `ip_location_check`, and the refund and cancellation policies.
   - **Excluded as `unverified`:** `avs_cvv_match`.
2. **The bank-eligibility filter** (`bankIncludedFacts`, `lib/jobs/handlers/buildDefencePackageJob.ts` ~L496) then dropped `order_confirmation` and `shipping_policy`. What remained in `facts_json`: `shipping_tracking` and `delivery_proof`.

Customer history is also stored only as counts (`totalOrders: 2`). Because no code asked *when* the other order was placed, the most useful question (Q1) never came up.

**Implication:** the claim ledger (§3) must be built from the records by **argument value per reason code**, and bank safety must be applied per claim rather than per whole record category. A record category that is "not relevant" in general can still yield one highly relevant claim, such as "ordered again after delivery".

## 2. Open questions (resolve these before the prompt work; each can change the argument)

- **Q1: The second order.** Customer history says 2 orders, the account was created the morning of this one, and "repeat customer" is true. When was the other order placed, and was it delivered? *If the cardholder ordered again after 6 July*, that is one of the strongest facts in a non-receipt case. It is stated as a fact ("the cardholder placed a further order on …"), never with commentary. Source: the Shopify Admin API (the customer's orders), read with the stored offline token (CLAUDE.md, "Calling a MERCHANT store's Admin API").
- **Q2: Gorgias.** Did the cardholder contact Blume between 2 Jul and 19 Sep? If so, what about? Only conversations that help are usable, and **never an absence** ("did not contact" is forbidden).
- **Q3: Carrier proof of delivery.** Does Stallion Express expose a proof-of-delivery photo or a delivery-event description? Quoting the carrier's own words about *where* it left the parcel needs a decision from the maintainer on whether rule 14 covers a verbatim carrier statement (today: it does, so it's not allowed).
- **Q4: Shipping policy text.** Does the published policy promise a dispatch window that this order met ("ships within X business days")? If so, the letter can say the order shipped within the published policy.

## 3. The claim ledger

### 3.1 What it is
A deterministic, code-built list of the **statements this case may make**. Each entry has:

```ts
interface LedgerClaim {
  id: string;                  // stable: "carrier_delivered", "whole_order_in_shipment", …
  statement: string;           // canonical true sentence, plain English
  specifics: Record<string, string>; // usable concrete values: { carrier: "Stallion Express", deliveredOn: "6 July 2026", daysAfterDispatch: "4" }
  weight: "core" | "strong" | "supporting";
  sources: string[];           // record ids the claim is derived from (fact ids, pack section paths)
  mayImply?: string;           // the inference the writer may draw, stated as the merchant's position
  mustNot: string[];           // private limits: never printed; the writer must stay inside them
}
```

### 3.2 Rules
- **Only code builds claims, from records.** The model never adds one. A claim appears only when its condition is met:
  - `whole_order_in_shipment` only when the line-item-ID check passes (`lib/defence/fulfilmentCoverage.ts`, already built);
  - the timing claim only when the delivery is dated before the dispute;
  - an email claim only when the history line names the order's email address.
- **Claims are reason-code-aware.** Each claim carries relevance per family, so a fraud letter gets the IP, wallet and AVS claims and a non-receipt letter gets delivery, scope and timing. Irrelevant claims are not sent; they only distract.
- **Specifics are data, not prose.** The ledger provides "4 days", "75 days", "all three items", "same day", and the writer decides where each one does the most work.
- **Limits (`mustNot`) are private.** They are never printed (Plan 2 §3).

### 3.3 The ledger for #352543 (target, given today's data)

| id | statement | weight | specifics |
|---|---|---|---|
| `claim_is_non_receipt` | The cardholder claims the order was not received (Visa 13.1). | core | — |
| `carrier_delivered` | Stallion Express recorded the shipment as delivered on 6 July 2026. | core | carrier, deliveredOn |
| `carrier_is_third_party` | The delivery record is the carrier's own record, publicly viewable at the tracking link, and is not produced by the merchant. | core | trackingLinkShown: true |
| `whole_order_in_shipment` | All three purchased items, in the quantities ordered, were in that one tracked shipment (verified by line-item ID). | core | itemCount: 3 |
| `full_amount_covered` | That shipment covers the full disputed amount. | strong | — |
| `shipped_same_day` | The merchant shipped the order the day it was placed and paid for. | strong | shippedOn: 2 July 2026 |
| `delivered_four_days_after_dispatch` | Delivery was recorded four days after dispatch. | supporting | days: 4 |
| `delivery_notice_same_day` | A delivery notification was sent to the order's email address the day the carrier recorded delivery. | strong | — |
| `dispute_75_days_after_delivery` | The dispute was opened 75 days after the carrier recorded delivery. | strong | days: 75 |
| *(Q1)* `later_order` | *Only if Q1 confirms:* the cardholder placed a further order on [date], after the delivery. | core | — |
| *(Q4)* `within_shipping_policy` | *Only if Q4 confirms:* the order shipped within the published shipping policy. | supporting | — |

## 4. Code changes this plan implies

- **New: `lib/defence/claimLedger.ts`.** Builds `LedgerClaim[]` from the approved facts, the pack sections, the timeline, `fulfilmentCoverage` and the dispute row, per reason-code family. Pure and unit-tested; each claim's condition gets its own test.
- **New Shopify read (Q1):** the customer's other orders, with dates and fulfilment status. It goes into the pack as a new section and a claim.
- **Gorgias (Q2):** reuse the existing Gorgias evidence core. Only positive, non-refund conversation facts enter the ledger.
- The ledger **replaces** the "approvedFacts" payload for families that opt in. The classifier's bank-eligibility rules still decide which records a claim may be built from.
