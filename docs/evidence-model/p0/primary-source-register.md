# Phase 0 — Primary-source verification register

**Date:** 2026-08-05 · **Scope:** Phase 0 (read-only research; approved 2026-08-05).
Every rule that the argument layer would encode is listed with its verification state:
**V-PRIMARY** (verified against the primary network document, quote below) · **V-SECONDARY**
(secondary corroboration only — not implementable as categorical policy) · **PENDING** (no
adequate source — blocks the dependent rule).

**Numbering note:** this register's S-numbers are canonical. Plan v3's D3 table uses a slightly
different assignment (it lists Visa Core Rules as S3); where they differ, the numbering here
governs and the plan's is a drafting artifact.

## Sources and extraction status

| # | Source | Status |
|---|---|---|
| S1 | **Visa, Dispute Management Guidelines for Visa Merchants, June 2024** — `usa.visa.com/dam/VCOM/global/support-legal/documents/merchants-dispute-management-guidelines.pdf` | **EXTRACTED.** The PDF's body text is Flate-compressed UTF-16BE with a +29 glyph offset (not image-encoded — an earlier note in plan v3 saying "image-encoded" was wrong and is corrected; WebFetch's extractor fails on it, a ~40-line Node script decodes it fully). Decoded text: 1.15M chars; all 52 "How should I respond" sections, the §4 Compelling Evidence chart, and the Visa Secure table recovered. Quote artifacts: `fi` ligature, bullet glyphs, `y\`→y — marked with [sic] handling below. |
| S2 | **Visa, Compelling Evidence 3.0 Merchant Readiness, Mar 2023** — `usa.visa.com/content/dam/VCOM/regional/na/us/support-legal/documents/compelling-evidence-3.0-merchant-readiness-mar2023.pdf` | **EXTRACTED** (same method). |
| S3 | **Visa, Updates and Clarifications to Dispute Rule Language** — `usa.visa.com/dam/VCOM/global/support-legal/documents/updates-and-clarifications-to-dispute-rule-language.pdf` | **EXTRACTED** (same method; ~2021-22 era — predates the Oct-2024 changes). |
| S4 | **Mastercard Chargeback Guide, Merchant Edition** (19 May 2026 build) — `mastercard.com/content/dam/mccom/shared/business/support/rules-pdfs/chargeback-guide.pdf` | **EXTRACTED 2026-08-05** from a maintainer browser-download (`Downloads/chargeback-guide.pdf`; the CDN 403s every programmatic client). Body is CID-hex behind subset fonts; ToUnicode-CMap reconstruction + de-spaced search recovers it (4.9M chars). Quote artifacts: intra-word spacing (normalized in quotes below). |
| S5 | **Visa Core Rules** (public) | **NOT YET EXTRACTED** — needed only for the Oct-2024 13.3 return-precondition *rule text* (see R-C) and regional liability-shift variance. |
| S6 | Shopify `disputeEvidenceUpdate` API | Already established in-repo: one PDF (`uncategorizedFile`) + customer name/email; no CE3.0/VROL fields. |

## The rule register

### R-A — 3-D Secure / Visa Secure and fraud-dispute protection

**Visa: V-PRIMARY.** S1, "Visa Secure Dispute Protection" (§1) — decoded verbatim:

> "Visa Secure participating merchants are protected by their acquirer from receiving certain
> fraud-related disputes, provided the transaction is processed correctly.
> **If the cardholder is successfully authenticated** — the merchant is protected from
> fraud-related disputes, and can proceed with authorization using Electronic Commerce Indicator
> (ECI) of **'5'**.
> **If the card issuer or cardholder is not participating in Visa Secure** — the merchant is
> protected from fraud-related disputes, and can proceed with authorization using ECI of **'6'**.
> **Merchant does not participate or doesn't attempt to authenticate** — the merchant is **not**
> protected from fraud-related disputes, but can still proceed with authorization using ECI of
> '7'.
> **Liability shift rules for Visa Secure transactions may vary by region.** Please check with
> your acquirer for further information."
> Footnote: "A Visa Secure merchant identified by the Visa Fraud Monitoring Program may be
> subject to disputes Condition 10.5."

And S1, Condition 10.4 "How should I respond?" — the **first listed remedy**:

> "**The transaction was authenticated with Visa Secure.** Advise your card processor that the
> transaction was Visa Secure-authenticated at time of authorization."

**Consequences (Visa):** (1) authenticated-3DS is a primary-verified 10.4 *response remedy*;
(2) **ECI 6 (attempted, issuer/cardholder not enrolled) is also protected** — the current
DisputeDesk rule treating attempted-3DS as categorically adverse is **not supportable for Visa**
and must become network-specific; (3) protection is conditional ("certain", "processed
correctly", regional variance, VFMP exclusion) — so the letter frames it as *"this dispute
appears inconsistent with Visa Secure protection"*, never a categorical "issuer lacked rights".

**(4) The conditions are load-bearing, and they BLOCK the rule until they are observable.** The
primary grants the protection *"provided the transaction is processed correctly"*, notes that the
rules *"may vary by region"*, and excludes VFMP-identified merchants. DisputeDesk holds **no**
signal for any of the three. Citing ECI 5 without them established asserts "the rule says X" where
the source says "the rule says X *if* A, B and C" — a stronger claim than the primary supports,
made to an issuer. **General rule adopted here: a verified rule whose conditions are unobservable
yields `review_required`, not a citation.** Applied to ECI 5, that means the strongest-verified
3DS state on either network is not citable today. See `3ds-network-table.md` §0(B).

**Mastercard: V-PRIMARY** (S4, extracted 2026-08-05). The 4837 chapter's *"transactions
ineligible for chargeback"* list — decoded verbatim (spacing normalized):

> "…DE 48, subelement 42 (Electronic Commerce Indicators), subfield 1 (**Electronic Commerce
> Security Level Indicator and UCAF Collection Indicator**), positions 1, 2, and 3) contained
> any of the following values of **211, 212, 217, or 242**. Examples include, but are not
> limited to, **Identity Check** and Digital Secure Remote Payment (DSRP)."

And the **MIT/CIT rule** (same chapter):

> "On related MITs, the issuer should not use this chargeback reason code to dispute a
> merchant-initiated transaction (MIT) that the issuer or cardholder determines is related to a
> prior authenticated cardholder-initiated transaction (CIT) identified with **SLI 212 or 242**
> … **The acquirer may provide specific evidence that the disputed MIT is related to a prior
> authenticated CIT in a second presentment.**"

**Consequences (Mastercard):** (1) SLI **212** (fully authenticated) AND SLI **211** (the
attempted/UCAF-collection class) both make a 4837 chargeback ineligible — the Mastercard
parallel of Visa's ECI 5/6 finding; the "attempted 3DS is adverse" rule is therefore
unsupportable on **both** networks; (2) the MIT/CIT link is a subscription-relevant second
presentment DisputeDesk does not model today; (3) values 217 and 242 (DSRP / other classes) are
protected but not applicable to current Shopify-Payments ecommerce flows. Framing stays
conditional, as for Visa.

**(4) These findings attach to RAW SLI VALUES, which DisputeDesk never observes.** The rule is
stated in DE 48, subelement 42, subfield 1. Our only 3DS input is a Shopify Payments receipt
`eci` (plus a gateway-computed `liability_shift`) — a *different encoding*. Whether receipt `eci`
02 corresponds to SLI 212, and `eci` 01 to SLI 211, is **assumed, unsampled and undocumented**;
prod holds zero attempted-class receipts to sample. **The mapping gap therefore covers every
Mastercard state, not merely the attempted class** — an earlier note in this register and in the
3DS table said "attempted class only", which was wrong and is withdrawn. Until a raw SLI becomes
observable, or the correspondence is documented *and* sampled, every Mastercard 3DS cell is
`review_required` despite the rule being V-PRIMARY. See `3ds-network-table.md` §0(A), §2.2.

### R-B — Compelling Evidence 3.0

**V-PRIMARY, two sources.** S2 (Merchant Readiness), decoded verbatim:

> "The transactions must be at least 120 days old but no older than 365 days (calculated from
> the dispute date) … must have no active fraud report … no active fraud dispute … [two matching
> data elements] between prior transactions and the disputed transaction, and **one of the two
> must be either the IP address or Device ID / Fingerprint** … Transactions must be from the
> same merchant. … To respond to a 10.4 dispute condition with Compelling Evidence 3.0 data, **an
> acquirer will submit a VROL pre-arbitration questionnaire** with all the required Compelling
> Evidence 3.0 data elements … Merchants will only be able to attempt submission of CE3.0
> criteria **once**."

S1, Condition 10.4 respond section, in-guide criteria (verbatim, artifacts normalized):

> "The cardholder has two or more completed transactions (settled 120 calendar days prior to the
> dispute) which the issuer did not report as Fraud Activity to Visa, with at least two data
> elements (device ID, device fingerprint, or the IP address) the same as the disputed
> transaction. Provide the following details of the two previous transactions (settled between
> 120–365 calendar days prior to the dispute processing date) … Effective for Disputes Processed
> on or after 19 October 2024: Date the merchandise or services were provided … The same device
> ID, device fingerprint or the IP address and an additional one or more data elements (Customer
> account/login ID, Full delivery address, device ID, device fingerprint, or the IP address)
> used in previous transactions and disputed transactions."

**Consequence:** CE3.0 is **structured acquirer/VROL questionnaire data with a one-shot rule** —
not merchant PDF prose. The earlier claim that "CE 3.0 requires raw IP/address data in
DisputeDesk's PDF" was **false and is withdrawn**. Shopify's evidence API exposes no VROL/CE3.0
fields, so DisputeDesk cannot operate the program directly; CE3.0-*style* prior-transaction
facts remain usable in the letter as ordinary corroboration under the §4 chart (below).

### R-C — `no_return_initiated` on 13.3

**Rebuttal use: V-PRIMARY.** S1, Condition 13.3 "How should I respond?" — decoded verbatim:

> "**The merchandise or services received by the customer were as described.** Provide specific
> information or documentation (invoice, contract, etc.) to refute the cardholder's claims …
> It is recommended that you address each point that the cardholder has made.
> **Returned merchandise was not received or services were not cancelled.** Advise that you have
> not received the returned merchandise and **the cardholder never attempted to return** or
> cardholder has not cancelled services. However, double check your incoming shipping records to
> verify prior to response."

**Invalidity framing: PENDING.** The June-2024 respond section contains **no** return-attempt
*precondition* language. The stronger claim ("13.3 is invalid unless the cardholder attempted a
return", eff. 2024-10-19) requires the rule text itself (S5 / the announcement). Until then
`no_return_initiated` ships as verified **rebuttal content** only — no `lead_invalidity` role.

### R-D — 13.6 Credit Not Processed remedies

**V-PRIMARY (remedies list).** S1, Condition 13.6 "How should I respond?":

> "**The sale is valid, and credit is not due.** Provide documentation and refute the validity of
> the documentation supplied by the cardholder's bank.
> The transaction is due for refund but has not yet been processed. **Accept the dispute.**
> **Credit or reversal has already been processed** for the transaction. Provide documentation of
> the credit or reversal that includes the amount and the date it was processed.
> The cardholder no longer disputes the transaction. Provide a letter or email …"

**Consequence:** "credit already processed, with amount and date" is the primary remedy —
validates `refund_record` as primary rebuttal. **"Policy acceptance is sufficient for a 13.6
outcome" is NOT stated** — policy disclosure supports "sale is valid, credit not due" but is not
listed as sufficient by itself. That sufficiency claim stays **withdrawn**; `acceptedAtCheckout`
gating stays as conservative supporting evidence.

### R-E — Delivery evidence on fraud (10.4) — the AVS-linked rule

**V-PRIMARY.** S1, §4 Compelling Evidence chart, Item 3 (10.4 column):

> "For a Card-Absent Environment Transaction in which the merchandise is delivered, **evidence
> that the item was delivered to the same physical address for which the Merchant received an
> AVS match of Y or M. A signature is not required as evidence of delivery.**"

**Consequence:** delivered-to-AVS-verified-address is *the* compelling-evidence form of delivery
on fraud disputes — and the qualifying AVS codes are **Y or M specifically**. Our
`deliveredToVerifiedAddress` logic is directionally validated; Phase 0 leaves a note to check
which AVS codes our verified-address derivation accepts.

Also from the chart (10.4 unless noted): Item 1 — photographic/email evidence linking the
receiver to the cardholder, or possession/use of the merchandise; Item 2 — pickup signature/ID
for collect-at-merchant; Item 4 — digital goods: download description + date/time + 2 of
{purchaser IP + device geolocation at transaction time, device ID + name, purchaser name/email
linked to a verified customer profile, profile access on/after the transaction date, same
device+card in a prior undisputed transaction}; Item 6 — signed order form for MOTO. Framing
caveat, §4 opening (verbatim): "**Compelling Evidence does not mandate that Visa, the Issuer, or
any other entity conclude** that the Cardholder participated in the Transaction…" — CE is
persuasive, never conclusive; the letter must not claim otherwise.

### R-F — 13.1 Merchandise/Services Not Received

**V-PRIMARY.** S1, Condition 13.1 "How should I respond?": prove delivery/pickup "by the agreed
upon date or agreed upon location — provide documentation to prove that the cardholder or
authorized person received the merchandise or services as agreed"; delivery date not yet passed;
cardholder cancelled before expected date; partial payment with balance due. Validates the
delivery-proof ladder as the 13.1 primary rebuttal.

### R-G — 12.6.1 Duplicate Processing

**V-PRIMARY.** S1: "**The charges represent two separate transactions/purchases.** Provide
information and documentation to show the two transactions are separate." (And: genuinely settled
twice → accept.) Validates the distinct-transaction-markers strategy.

### R-H — 13.2 Cancelled Recurring

**V-PRIMARY, with a dated rule.** S1: "Transaction was cancelled, but services were used —
**Effective for Disputes processed on or after 19 October 2024: provide proof the cardholder used
services after the withdrawal-of-permission-to-bill date and prior to the Dispute Processing
Date.**" Withdrawn permission + no credit → accept. Credit processed → document amount/date.
Validates the service-usage-after-cancellation strategy, now with the exact date window.

### Mastercard register (extracted 2026-08-05)

- **Identity Check liability (R-A above): V-PRIMARY** — SLI 211/212/217/242 ineligible for 4837;
  MIT/CIT second-presentment right for MITs tied to a prior authenticated CIT (SLI 212/242).
- **4853 second-presentment remedies: V-PRIMARY** — the chapter's remedy set includes *"The
  goods or services were repaired, replaced, delivered, and/or provided as agreed"*, *"Refund
  previously issued"*, *"Suspected return merchandise fraud"*, *"Invalid chargeback"*; plus
  second-presentment rights that *"the disputed goods or services were used"* and *"a fully
  enabled Identity Check transaction was used to register a PAN for future transactions"*.
  Structural note: at pre-arbitration the issuer must supply *"a new cardholder letter, email,
  message, or completed Dispute Resolution Form … dated after the second presentment and
  **specifically addressing the merchant's rebuttal**"* — our letters should be structured to
  pre-empt that reply.
- **4834 TAXONOMY CAUTION: open.** This edition's TOC lists 4834 as **"ATM Disputes — Cash and
  Currency Errors"**, not point-of-interaction duplicate processing. Before any 4834-specific
  rule ships, `lib/disputes/reasonCodeCatalog.ts`'s 4834=duplicate mapping must be checked
  against the guide's current code table (older editions differ). The matrix's duplicate column
  carries `review_required` for Mastercard until resolved.
- Full body text saved to the session scratchpad for deeper per-sub-claim extraction on demand.

## Reproduction

```
node scripts/… (Phase 0 committed the decode as a scratch procedure; the method:
inflate every Flate stream, join the PDF string literals, then decode UTF-16BE
runs by dropping the high byte and adding 29 to each glyph code; 0x34→"fi", 0x35→"fl")
```
Decoded texts live in the session scratchpad; only excerpts are committed (copyright).
