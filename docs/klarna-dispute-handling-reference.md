# Klarna dispute handling — reference

**Investigation date:** 2026-07-04 · **Trigger:** checking cay-collective's CE 3.0 eligibility · **Status:** findings verified against live Shopify/Supabase data + Klarna/Shopify docs.

This is the ground-truth reference for how DisputeDesk handles Klarna (and BNPL generally). Every claim here is either empirically verified against prod data or cited to a source; inferences are marked.

---

## 1. The headline facts

- **cay-collective is ~50/50 card vs Klarna** across their order book (500-order probe: 244 `CardPaymentDetails` — Mastercard 163 / Visa 72 / Amex 9 — and 242 Klarna). Their *disputes* skew Klarna, but half their orders are real cards, so card machinery (CE 3.0, AVS/CVV) still matters for them.
- **The underlying funding card network is NOT recoverable for a Klarna order** — structurally, not just un-collected. Verified 0/242 Klarna orders expose any card brand via `paymentDetails`, `paymentDescriptor`, or `receiptJson`.
- **Klarna sub-product (pay_now / pay_later) IS recoverable** — from `receiptJson`, not GraphQL. cay-collective: **pay_later 77.7% / pay_now 22.3%**.
- **Klarna runs its own dispute process** with its own 7-category taxonomy and a strict Proof-of-Delivery contract — NOT Visa/Mastercard reason codes.

---

## 2. Why the card network is unrecoverable (structural)

Shopify's `PaymentDetails` GraphQL union has four members; card-instrument fields (`company`/brand, `bin`, last-four, `wallet`) live **only** on `CardPaymentDetails`. Klarna resolves to `LocalPaymentMethodsPaymentDetails`, which exposes only `paymentMethodName` + `paymentDescriptor` — no brand field exists to populate.

Root cause is the settlement model, not a Shopify omission:
- Klarna is the **payer of record**. The customer transacts with Klarna (hosted redirect); Klarna pays the merchant via its **Merchant Card Service (MCS)** — a Klarna-issued *virtual* card. Any card the consumer linked inside Klarna is Klarna's private data, protected by PSD2 consent, and never transmitted to the merchant.
- So the only card a merchant could ever observe is Klarna's virtual settlement card — which must **never** be represented as the cardholder's funding instrument in dispute evidence.

This is an industry-wide reality (Chargeflow, Stripe, Adyen, ChargebackGurus all document it), not a DisputeDesk limitation.

**Sources:** [PaymentDetails union](https://shopify.dev/docs/api/admin-graphql/latest/unions/PaymentDetails) · [LocalPaymentMethodsPaymentDetails](https://shopify.dev/docs/api/admin-graphql/latest/objects/LocalPaymentMethodsPaymentDetails) · [Klarna MCS](https://docs.klarna.com/merchant-card-service/) · [Shopify Help — Klarna](https://help.shopify.com/en/manual/payments/shopify-payments/local-payment-methods/klarna)

**Implication:** CE 3.0 (Visa-card-only) and FPT (Mastercard-only) correctly return `not_applicable` for Klarna. `network_reason_code` is `null` with `confidence = not_card_network` — the explicit, correct value (distinct from `unknown`, which means "a card dispute we couldn't resolve").

---

## 3. Klarna sub-product — where it lives

GraphQL `paymentMethodName` collapses every Klarna order to the bare string `"klarna"` — the real product is NOT there. It IS in the transaction `receiptJson` (Shopify Payments = Stripe under the hood):

```
payment_method_details.klarna.payment_method_category   (modern)
charges.data[0].payment_method_details.klarna.payment_method_category   (legacy)
latest_charge.payment_method_details.klarna.payment_method_category
```

Observed values: `pay_now`, `pay_later` (and Stripe documents `pay_over_time`, `pay_in_installments`, `pay_with_financing`). Read by `extractKlarnaSubProduct()` in `lib/disputes/paymentContext.ts` → `PaymentContext.klarnaSubProduct`, persisted to `pack_json.payment_context.klarnaSubProduct`.

**Why it matters:** `pay_later` (Klarna extends consumer credit) historically drives more chargebacks/problems than `pay_now` (immediate debit). cay-collective is 77.7% pay_later.

---

## 4. Klarna's dispute taxonomy & evidence contract

Klarna adjudicates on its **own** categories (not Visa 10.x/13.x). Verified against docs.klarna.com:

| Klarna category | Merchant evidence Klarna weighs |
|---|---|
| **Goods / Services Not Received** | Genuine **Proof of Delivery** per Klarna's Merchant Protection Program (MPP): carrier + tracking + delivery date + address + recipient name. **A tracking link alone is NOT sufficient.** Signature required for orders **over 750 EUR**. Digital goods: transmission date, recipient email, IP, access/use evidence. |
| **Faulty / Not as Described** | Customer communication, resolution offered (repair/replace/refund), prepaid return label, explanation of why the claim is invalid. |
| **Incorrect Amount / Invoice** | Invoice tied directly to the Klarna order; price/fee justification; any correction/refund/cancellation. |
| **Return / Refund not processed** | Refund record + timing; return status/tracking; whether a refund was owed. **Refund must post within 96h of committing** or Klarna auto-chargebacks. |
| **Unauthorized Purchase** | Shipping details + POD; customer contact history; customer-identifying info; usage status for services/tickets. |
| **High-Risk Order / Fraud** | High-risk evidence template; tightest deadline. |

**Response windows:** Unauthorized **7 days**; all other reasons **14 days**; follow-ups **7 days**; High-Risk/Fraud **96 hours**. Missing the deadline = Klarna auto-resolves for the customer. Merchants typically get **one** submission attempt — the response must be complete and lead with the strongest evidence.

**Shopify-specific nuance:** Klarna offered *via Shopify Payments*, disputed **after 2025-09-26**, flows through the **standard Shopify Payments dispute surface** (appears as a normal `PaymentDispute` / in our pipeline) — "handled the same way as a card transaction dispute." But it still carries **no genuine card network reason code** (our data confirms `not_card_network`). A legacy AT/DE/SE email-based path (7-day window) exists for pre-2025-09-26 disputes.

**Sources:** [Klarna evidence gathering](https://docs.klarna.com/payments/after-payments/disputes/evidence-gathering/merchant-evidence-gathering/) · [Klarna dispute management](https://docs.klarna.com/acquirer/klarna/after-payments/disputes/disputes-management-v4/dispute-management-overview/) · [Adyen Klarna chargebacks](https://docs.adyen.com/risk-management/chargeback-guidelines/klarna-chargebacks) · [Shopify Help — Klarna](https://help.shopify.com/en/manual/payments/shopify-payments/local-payment-methods/klarna)

---

## 5. What DisputeDesk does about it (shipped 2026-07-04/05)

| Area | Behavior |
|---|---|
| **PDF reason code** | Non-card disputes show the Klarna dispute category (e.g. "Klarna dispute — Goods not received"), never a Visa/MC code (`lib/defence/klarnaDisputeCategory.ts`). |
| **Narrative overlay** | Klarna gets a **reason-aware** overlay injecting Klarna's real evidence expectations per category (POD/MPP for GNR, resolution offer for faulty, invoice for incorrect amount, refund record for refund-not-processed, delivery+identity for unauthorized) — `lib/defence/klarnaOverlay.ts`. Card constructs (AVS/CVV/3DS/CE3.0/FPT) are hard-rejected by `validateNarrative`. |
| **Sub-product** | `pay_now`/`pay_later` classified from receiptJson + persisted (`PaymentContext.klarnaSubProduct`). |
| **Reason code** | Resolves to `not_card_network` for Klarna; the DB constraint was fixed (migration `20260705120000`) to allow this value — it had been silently rejecting every Klarna write. |
| **Session anchor** | orders/create webhook links the checkout session by **`checkout_token`** (the pixel's misnamed "cart_token"). |
| **CE 3.0 / FPT** | Correctly `not_applicable` for Klarna — documented, not faked. |

---

## 6. Explicit non-goals (do NOT do)

- **Don't** try to recover or represent the consumer's funding card for a Klarna order — it is structurally unavailable and any visible card is Klarna's virtual settlement card.
- **Don't** add `"klarna"` to the `CardNetwork` union or invent Klarna reason codes.
- **Don't** cite card-authentication signals (AVS/CVV/3DS) in a Klarna narrative.
- **Don't** widen CE 3.0 / FPT to fire on Klarna.

---

## 7. Read-only probes (for re-verification)

Under `scripts/` (need prod `NEW_SUPABASE_*` + `TOKEN_ENCRYPTION_KEY` locally):
- `probe-klarna-deep.mjs <shop> [maxOrders]` — card vs Klarna split + underlying-card detection across N orders.
- `probe-klarna-category.mjs <shop> [maxOrders]` — pay_now/pay_later distribution from receiptJson.
- `probe-klarna-underlying-card.mjs <shop>` — per-disputed-order card-behind-Klarna check.
- `backfill-session-order-link.mjs <shop> [--apply]` — link orphaned sessions by checkout_token.
- `backfill-reason-code-for-disputes.mts <disputeId...> [--apply]` — targeted reason-code enrichment.
