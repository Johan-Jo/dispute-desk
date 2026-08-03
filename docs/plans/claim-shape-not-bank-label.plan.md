# Defend the claim, not the label

**Status:** measured 2026-08-03. **The union-defence machinery this plan
originally proposed is NOT justified** — see §4. Three narrower actions are.

**Raised by:** two consecutive prod disputes where the bank's label was wrong,
found only because a human read the issuer's PDF by hand.

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
  lost, never stolen, never used. The label suppressed a Mastercard **ECI 02
  liability shift** — the strongest fact in the file (fixed for 3DS in PR #502).

**The label cannot be verified.** The issuer claim and response documents are
Shopify-Admin-only — not in `disputeEvidence.disputeFileUploads`, not
resolvable by `node()`, absent from the schema even on `unstable`
(`docs/technical.md` § *What Shopify exposes…*).

## 2. Root cause of the ambiguity: Mastercard's umbrella

The two networks made opposite choices.

- **Visa split the claims.** VCR dispute conditions **13.1** (Merchandise/
  Services Not Received) and **13.3** (Not as Described or Defective) are
  distinct codes. A Visa dispute is unambiguous.
- **Mastercard merged them.** Around 2016 MC consolidated 4841 / 4850 / 4855 /
  4859 into **4853**, an umbrella covering nearly every non-fraud cardholder
  dispute: not received, not as described, defective, counterfeit, cancelled
  recurring, addendum charges. The specific claim travels as **sub-condition
  text inside the chargeback message**, not as a distinguishing number.

Shopify exposes the number and a coarse enum; the sub-condition text only
surfaces in the Admin-UI issuer claim document. So on MC 4853 the
distinguishing detail is structurally out of reach. Our own
`reasonCodeCatalog.ts` already records this — 4853 lists BOTH
`PRODUCT_UNACCEPTABLE` and `PRODUCT_NOT_RECEIVED` as fallbacks.

## 3. What was measured

`scripts/report-label-suppressed-facts.mjs` (read-only; reads our own packs and
module config — no Shopify call, no inference about the true claim). Run
against prod 2026-08-03, open disputes.

**Deliberately not measured:** a "contradiction rate" between the label and a
derived claim shape. That number describes the resolver, not reality — high
disagreement is equally consistent with bad labels and a bad resolver, and we
have two ground-truth cases to tell them apart. The 466 decided disputes cannot
help either: only **27** have an evidence pack and **9** a defence package.

### 3.1 Facts the label kept out of the letter — 64 of 106 disputes

| Category suppressed | Disputes |
|---|---|
| `no_return_initiated` | **81** |
| `payment_authentication` | **6** |
| prior_customer_history / refund_record / ip_location / shipping_tracking / delivery_proof | 1 each |

The 81 are **not a label problem**. `no_return_initiated` appears in exactly
one module's `allowedFactCategories` (`credit_not_processed`). Everywhere else
it is collected, classified bank-eligible, and dropped — whatever the label
says. Relabelling changes nothing. Separate defect, §5.2.

The 6 are the real signal: `payment_authentication` excluded under
`product_unacceptable`, `inr_product_not_received` and `duplicate_processing`.
That is the #352552 class.

### 3.2 Structurally ambiguous reason codes — 92 of 121, but only 4 that matter

| Code | Disputes | Spans | Different defence? |
|---|---|---|---|
| 4837 | 81 | FRAUDULENT / UNRECOGNIZED | **No** — same family, same module |
| 10.4 | 7 | FRAUDULENT / UNRECOGNIZED | **No** — same |
| 4853 | 3 | PRODUCT_UNACCEPTABLE / PRODUCT_NOT_RECEIVED | **Yes** |
| 4834 | 1 | DUPLICATE / GENERAL | Yes |

The 76% headline is misleading. Genuine cross-family ambiguity is **4 of 121
(~3%)**, and it is Mastercard-specific per §2.

## 4. Conclusion: do not build the union defence

Two mislabelled disputes made this feel systemic. The measurement says the
structural ambiguity a union defence would address is ~3% of volume, and both
known cases sit on 4853 — one of the three. Building a claim-shape resolver,
union `allowedFactCategories`, dual-strategy ranking and a merchant
disambiguation prompt is a large surface to carry for that.

Reconsider if any of these change: 4853 volume grows materially; a shop's mix
shifts toward Mastercard consumer disputes; or issuer responses (collected by
hand, §5.3) show mislabelling beyond 4853.

## 5. What to do instead

### 5.1 Extend the always-admissible set to AVS/CVV — small, justified now

A fact that helps under one claim type and is merely *irrelevant* under the
others must not be gated on the reason code. PR #502 shipped the first member
(3DS with liability shift, injected into `allowedFactCategories` regardless of
module). Add **AVS + CVV matched** on the same pattern: that covers the
remaining `payment_authentication` suppressions in §3.1.

Members must each answer *"can this read against us under any claim type?"*
with a test. Explicitly excluded: attempted/exempted 3DS, IP and device
signals (`avoid`-listed for good reason), fraud screening on non-fraud claims.

### 5.2 Decide what `no_return_initiated` is for — 81 disputes

Today it is collected, marked bank-eligible, and admissible in exactly one
module. Either it belongs in more `allowedFactCategories` (it is a factual
statement about return status, defensible under delivery and product claims
alike) or it should not be bank-eligible. Right now it is neither, on 81 open
disputes. Not a label problem — a module-coverage gap.

### 5.3 Leave 4853 to human judgement

Three open disputes. The sub-condition is unreachable by API (§2), so the only
way to know is to open the issuer claim in Shopify Admin — which is exactly how
#352552 was caught. Handle those by hand; do not build machinery for three.

## 6. Non-goals

- **No LLM guessing at the true reason.**
- **No overwriting `disputes.reason`.** The stored value stays what Shopify
  said. The admin override route is not extended to `reason`.
- **No merchant-facing "the bank got it wrong" copy.**

## 7. Verification

- `scripts/report-label-suppressed-facts.mjs` is the measurement of record;
  re-run it after §5.1 and §5.2 land and the suppression counts should fall to
  near zero for the categories addressed.
- Both ground-truth disputes stay documented here as the reference cases for
  any future revisit.
