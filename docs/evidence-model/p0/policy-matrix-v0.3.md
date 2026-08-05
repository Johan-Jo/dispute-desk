# Reason-by-evidence policy matrix v0.3 (corrected — still a PROPOSAL, not policy)

**Date:** 2026-08-05 (rev b — Mastercard S4 extracted and incorporated; S4 is COMPLETE as a
source). Supersedes the v0.2 tables in plan v3.1. **Nothing here is implementable until the
maintainer approves this matrix.** Exit rule: an implementable cell must be **V-PRIMARY or an
explicitly approved product decision**; anything else stays excluded, blocked, or
`review_required` — unresolved rows do not block Phase 0 exit, they stay non-implementable. Verification states per `p0/primary-source-register.md` (register refs R-A…R-H):
**V-PRIMARY / V-SECONDARY / PENDING**. Vocabulary per the approved schema direction: disposition
∈ {supports, contradicts, neither}; **inclusion is a separate axis and disposition never
authorizes it**; roles apply only to included supporting facts.

Rule-classification: ✓ validated→preserved · ∆ incomplete→extended · ✗ incorrect→replaced ·
? unsupported→product decision.

## A. FRAUD family — Visa 10.4 / MC 4837

**Network rules V-PRIMARY on both networks; NO 3DS cell is citable today.** Two blocking rules
from `3ds-network-table.md` §0 govern every 3DS row: **(A)** a verified rule needs an *observable
trigger* — the primaries speak in raw wire values (Visa ECI, MC SLI) and DisputeDesk sees only a
receipt `eci`; **(B)** a verified rule needs every *condition* it carries represented by a verified
input. Visa ECI 6 and all Mastercard states fail (A); Visa ECI 5 fails (B). Raw-wire rows and
receipt-observable rows are listed separately below and must never be collapsed.

| Evidence | Disposition | Inclusion / role (proposal) | Verification | Class |
|---|---|---|---|---|
| 3DS — **Visa ECI 5** (authenticated) | supports | **`review_required`** — the rule is verified but its three conditions (correct processing, regional applicability, VFMP status) are **not observable** in our data, and a verified rule with an unobservable condition is not citable. Framing per **P-2** *if and only if* all three become verified inputs | **V-PRIMARY** rule (R-A: listed 10.4 remedy) / **BLOCKED** on unobservable conditions | ∆, blocked |
| 3DS — **Visa ECI 6** (attempted, issuer not enrolled) | supports *(per primary)* | **`review_required`** — primary says protected, current code treats it as adverse, and the gateway `liability_shift`↔ECI-6 mapping our code keys on is unverified | **V-PRIMARY** rule (R-A) / PENDING (gateway mapping) | **✗ for Visa** (current adverse rule unsupportable) |
| 3DS — **MC raw SLI 212 / 211 / 217 / 242** (*wire values*) | supports | rule verified at the wire-value level only — **no DisputeDesk cell may key on these directly**, because no raw SLI is observable | **V-PRIMARY** (S4: the four values are in the 4837 "ineligible for chargeback" list) | ∆ (rule recorded, not actionable) |
| 3DS — **MC receipt `eci` 02** (assumed → SLI 212) | supports *(if the mapping holds)* | **`review_required`** — the receipt ECI↔SLI correspondence is assumed, unsampled and undocumented | V-PRIMARY (rule) / **PENDING** (observable mapping) | ✗/∆ |
| 3DS — **MC receipt `eci` 01** (assumed → SLI 211) | supports *(if the mapping holds)* | **`review_required`** — same mapping gap; zero attempted-class receipts in prod to sample; record is never silently dropped (#352552 invariant) | V-PRIMARY (rule) / **PENDING** (observable mapping) | **✗ for MC** (current adverse rule unsupportable) |
| 3DS — no attempt (ECI 7 / absent) | neither | excluded; absence never negative | V-PRIMARY | ✓ |
| Delivery to AVS-verified address | supports | recommended / corroboration — **the CE-chart form: delivered to the address with AVS match Y or M; signature not required** | **V-PRIMARY** (R-E, chart Item 3) | ✓ (+ Phase 0 note: verify which AVS codes our verified-address derivation accepts) |
| AVS + CVV both matched | supports | recommended / corroboration; disclosure `redacted_summary` (verificationSummary, never raw letters) | V-PRIMARY (AVS in guide + chart) | ✓ |
| AVS/CVV partial or both-fail | neither / contradicts (both-fail) | excluded from argument; merchant-visible internal | V-SECONDARY | ✓/∆ (family-gating moves from the merchant mirror into canonical rules) |
| Billing address match | supports | recommended / corroboration | V-PRIMARY (chart Item 3 linkage) | ✓ |
| Prior undisputed history | supports | optional / corroboration — wording strictly tri-state; **"undisputed" only when `disputeFreeHistory === true`** | V-PRIMARY (CE3.0 in-guide criteria; chart Item 4 profile evidence) | **✗ on the thesis token** (containment C-2); ✓ elsewhere |
| CE3.0-style prior-transaction matching | supports | optional / corroboration **in the letter** — the PROGRAM itself is acquirer/VROL-only and out of DisputeDesk's reach (Shopify API has no fields) | **V-PRIMARY** (R-B — the "raw data in PDF" premise is withdrawn) | ? = P-4 for the dormant package |
| Digital-goods access evidence | supports | recommended for digital orders (chart Item 4: download description + date/time + 2 matching elements) | **V-PRIMARY** (R-E Item 4) | ∆ (service_access exists; Item 4's element list not fully captured) |
| `ip_location_check` (geo heuristic) | supports (clean match only) | optional / corroboration; country/region grain; **never conflated with CE3.0 prior-txn IP matching** | V-SECONDARY (not in the chart as a standalone item) | ✓ |
| Shopify fraud screening (ACCEPT) | supports (weakly) | optional — **? = P-3** (not in any network evidence list) | code-only | ? |
| Policies (refund/shipping/cancellation) | neither | excluded (proves nothing about authorization; module `avoid` correct) | V-PRIMARY (absent from chart) | ✓ |
| Refund record | **contradicts** | blocked from argument; drives credit/fatal gates + the exclusive `credit_already_issued` strategy; "in full" only when covered | V-PRIMARY (10.4 lists credit-processed as ACCEPT-side remedy) | ✓ |
| `no_return_initiated` | neither | excluded | — | ✓ |
| Device/session telemetry | neither | blocked + `internal_only` disclosure | code-only (deliberate) | ✓ |

## B. DELIVERY / INR — Visa 13.1 (V-PRIMARY) / MC 4853-family goods-not-received sub-claim (family remedies V-PRIMARY; sub-claim chapter extraction on demand)

| Evidence | Disposition | Inclusion / role | Verification | Class |
|---|---|---|---|---|
| Delivery-proof ladder | supports | **required / primary_rebuttal** ("provide documentation to prove that the cardholder or authorized person received the merchandise or services as agreed") | **V-PRIMARY** (R-F) | ✓ |
| Delivery date not yet passed / cancelled-before-date / partial-payment | supports | situational primary (three additional primary-listed remedies our templates don't model) | V-PRIMARY | **∆ new** — add as argument variants |
| Tracking w/o delivery confirmation | supports | recommended; frame what tracking shows, never claim delivery | V-PRIMARY-consistent + module rule | ✓ |
| Digital access / service usage | supports | primary for digital | V-PRIMARY (chart Item 4 analog) | ✓ |
| 3DS / AVS | neither | optional context per matrix cell | R-A | ∆ |
| Refund record (full) | contradicts | blocked; fatal-loss trigger | code + V-PRIMARY (accept-side) | ✓ |

## C. PRODUCT — Visa 13.3 (V-PRIMARY) / MC 4853 not-as-described sub-claim (V-PRIMARY)

| Evidence | Disposition | Inclusion / role | Verification | Class |
|---|---|---|---|---|
| Listing/description as published | supports | **required / primary_rebuttal** ("provide specific information or documentation (invoice, contract, etc.) … address each point the cardholder has made") | **V-PRIMARY** (R-C quote) | ✓ |
| `no_return_initiated` | supports | recommended / **rebuttal** — "advise that you have not received the returned merchandise and the cardholder never attempted to return … double check your incoming shipping records prior to response" (the double-check becomes a claim-guard condition). **NO invalidity framing** (PENDING R-C) | **V-PRIMARY (rebuttal)** / PENDING (invalidity) | ✓, framing ∆ deferred |
| Repair/replacement accepted | supports | situational primary (cardholder agreed + received + not re-disputed) — not modeled today | **V-PRIMARY both networks** (Visa 13.3; MC 4853 second presentment: "the goods or services were repaired, replaced, delivered, and/or provided as agreed") | **∆ new** |
| Goods/services were USED (MC) | supports | second-presentment right per MC 4853 chapter ("the disputed goods or services were used"); maps to service_access/digital usage | **V-PRIMARY (MC)** | ∆ |
| Identity-Check-registered PAN (MC) | supports | second-presentment right when "a fully enabled Identity Check transaction was used to register a PAN for future transactions" — registered-credential argument, not modeled | **V-PRIMARY (MC)** | **∆ new** |
| Quality disputes → third-party opinion | supports | merchant-suppliable manual evidence path | V-PRIMARY | ∆ (maps to supporting_documents) |
| Comms / resolution attempt | supports | recommended | V-SECONDARY | ✓ |
| 3DS / AVS | neither | **per-cell decision; today's letters cite them (see #352552 v5) — preserved pending matrix approval; 4853 label-conflict → `review_required`** | R-A + 4853 umbrella | ∆ |
| Refund record (full) | contradicts | blocked; fatal gate | V-PRIMARY (accept-side) | ✓ |

## D. CREDIT NOT PROCESSED — Visa 13.6 (V-PRIMARY) / MC (chapter not yet extracted; body text on disk, extraction on demand — rows stay review_required for MC)

Refund record incl. amount+date = **required / primary** (verbatim remedy). "Sale is valid,
credit not due" = the rebuttal frame policies+no-return support — **policy acceptance is NOT
primary-listed as sufficient by itself** (R-D; the sufficiency claim is withdrawn).
`no_return_initiated` supports the not-due frame (its home module) — ✓. Comms recommended — ✓.

## E. DUPLICATE — Visa 12.6.1 (V-PRIMARY) / MC: **4834 TAXONOMY CAUTION — review_required**

Distinct-transaction documentation = **required / primary** ("show the two transactions are
separate") — ✓ (Visa V-PRIMARY). Genuinely settled twice → accept (fatal-class) — ✓.
Refund-processed alternate primary — ✓, never argued as "chargeback invalid".
**Mastercard:** the 2026 Merchant Edition TOC lists **4834 as "ATM Disputes — Cash and Currency
Errors"**, not POI duplicate processing. Our `reasonCodeCatalog.ts` 4834=duplicate mapping must
be checked against the guide's current code table before any MC-4834 rule ships; the MC duplicate
column is `review_required` until then.

## F. CANCELLED RECURRING — Visa 13.2 (V-PRIMARY) / MC (4841 absorbed into the 4853 family per the current guide TOC: "4853/53/4850/4854")

Service usage **after withdrawal-of-permission and before the Dispute Processing Date** =
primary remedy, **effective for disputes processed on/after 19 Oct 2024** (exact window now
verified — the strategy's claim guard gains these dates) — ✓/∆. Subscription terms at enrolment:
category unreachable in code (= P-5) — ✗. Credit processed → document amount/date — ✓.
Withdrawn permission + no credit → accept — ✓ (maps to fatal-class).
**MC MIT/CIT (new, V-PRIMARY):** an MIT related to a prior authenticated CIT (SLI 212/242)
should not be disputed as 4837, and *"the acquirer may provide specific evidence that the
disputed MIT is related to a prior authenticated CIT in a second presentment"* — a
subscription-relevant remedy **not modeled today**; requires prior-CIT evidence capture
(future work item, own approval). — **∆ new**

## G. GENERAL / unmodeled / BNPL routing

Generic fallback or `unmodeledCodes` routing ⇒ plan-level **review_required** (never silently
normalized) — ∆. BNPL/Klarna: card-construct evidence (AVS/CVV/3DS/CE3.0) **blocked** at
disposition level (replacing prompt-only enforcement); Klarna GNR requires true POD per overlay —
✓ (formalized). Unknown enum → generic → review_required.

## H. Cross-family content classes

| Class | Rule | Verification | Class |
|---|---|---|---|
| Self-incriminating comms (refund/cancellation history) | `contradicts` + `internal_only`, source-agnostic (generalizes the Gorgias hard-block) | code (deliberate) | ✓→∆ |
| Fatal-loss reason text | merchant-only; bank effect = mode only | code | ✓→∆ (explicit rule) |
| Name mismatch | merchant-only + fix the "Cardholder name" row fallback (containment C-5) | code | ∆/✗ |
| Adverse prior history | `contradicts`, never bank-facing; delete the dead disclosure branch | = P-8 | ✗ |
| Missing evidence | never mentioned bank-side (prompt rule 6 → PRE-class payload omission) | code | ✓ |

## Appendix — module × evidence grid (7 × 20)

**This grid is a HUMAN-READABLE INDEX, not the encoding.** The single-letter codes below are
lossy — `N` fuses disposition `neither` with inclusion `excluded`, `C` fuses `contradicts` with
`blocked`, and neither `?` nor `·` carries *why* or *on whose authority*. Since **disposition never
authorizes inclusion**, a one-letter cell cannot express the policy (it cannot represent `neither` +
`optional`, or `supports` + `excluded`). The authoritative record for each cell is a **seven-field
object** — `disposition`, `inclusion`, `role`, `disclosure`, `rationale`, `authority`
(state + sourceRef + decisionRef), and `requiredConditions` (explicit on every cell, `[]` included)
— each field set independently and none inferred from another. **Never infer `excluded` from
`neither`.** The letters are a scanning aid only and must never be parsed.

Cell codes: **P**=primary/required · **R**=recommended · **O**=optional/context · **N**=disposition `neither` *and separately* inclusion `excluded` ·
**B**=blocked (must never appear) · **C**=contradicts→gates · **?**=product decision · **·**=review_required.
Row order = canonical evidence fields; columns = modules (F=fraud, I=INR, PU=product, CR=credit,
DU=duplicate, CA=cancelled-recurring, G=generic).

| Field \ Module | F | I | PU | CR | DU | CA | G |
|---|---|---|---|---|---|---|---|
| order_confirmation | O | O | R | O | **P** | O | O |
| billing_address_match | R | O | N | N | O | N | O |
| avs_cvv_match (both) | R | O | · | N | O | N | O |
| tds_authentication — Visa ECI 5 (blocked on conditions) | · | O | · | N | O | N | O |
| tds_authentication — Visa ECI 6 (mapping unverified) | · | O | · | N | O | N | O |
| tds_authentication — MC receipt eci 02/01 (mapping unverified) | · | O | · | N | O | N | O |
| delivery_proof | R | **P** | O | O | O | N | O |
| shipping_tracking | R | R | O | O | O | N | O |
| activity_log / service_access | R | R(digital **P**) | O | O | O | R | O |
| customer_account_info | O | O | O | N | N | O | O |
| customer_communication | R | R | R | R | O | R | O |
| supporting_documents | O | O | R | O | R | O | O |
| product_description | N | N | **P** | N | O | N | O |
| duplicate_explanation | N | N | N | N | **P** | N | O |
| refund_record | C | C | C | **P** | R | R | O |
| no_return_initiated | N | N | R | R | N | N | O |
| refund_policy | N | O | O | R | N | O | O |
| shipping_policy | N | O | O | O | N | N | O |
| cancellation_policy | N | N | O | R | N | **P**(w/ acceptance) | O |
| ip_location_check | O | N | N | N | N | N | O |
| fraud_risk_screening | ? (P-3) | N | N | N | N | N | N |
| device_session_consistency | B | B | B | B | B | B | B |

Every **·** and every generic-column cell inherits `review_required` semantics. Mastercard
variant status: fraud column — the **network rule** is V-PRIMARY (raw SLI list) but **every
observable cell is `review_required`** (receipt `eci` ≠ raw SLI); product/delivery columns
**V-PRIMARY at the 4853-family remedy level**; duplicate column `review_required` (4834 taxonomy
caution); credit column `review_required` (MC chapter extraction on demand). **All 3DS rows on both
networks are `review_required` today** — the attempted class for the mapping gap, the authenticated
class for the mapping gap (MC) or the unobservable rule conditions (Visa ECI 5). This grid remains
the checkable completeness artifact — every module × evidence cell present, none blank — but
completeness is asserted against the seven-field records, not against these letters.
