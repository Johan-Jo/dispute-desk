# Network-specific 3-D Secure disposition table (Phase 0 deliverable)

**Status:** Visa rows V-PRIMARY (register R-A, Guidelines Jun-2024). Mastercard rows
**V-PRIMARY** (register R-A/S4, Chargeback Guide Merchant Edition, extracted 2026-08-05).
**No 3DS rule may be generalized across networks** — each row cites its own network source.
Nothing in this table is implemented; it is the input to the matrix approval, and rows with an
open gateway-mapping question stay `review_required` regardless of network verification.

## Visa (Visa Secure) — V-PRIMARY

| Auth state | ECI | Network position (primary) | Proposed argument disposition (fraud family 10.4) | Non-fraud families |
|---|---|---|---|---|
| Fully authenticated | **5** | Protected from fraud-related disputes; listed 10.4 remedy: "advise your card processor that the transaction was Visa Secure-authenticated at time of authorization" | `supports`; role **candidate** `lead_invalidity` phrased as *"inconsistent with Visa Secure protection"* — subject to **P-2** approval; disclosure: full (ECI + DS transaction id) | disposition `neither`; inclusion per matrix cell |
| Attempted; issuer/cardholder not enrolled | **6** | **Also protected** ("the merchant is protected from fraud-related disputes … ECI of '6'") | `supports` (same conditional framing) — **this reverses the current DisputeDesk rule** that treats non-liability-shift 3DS as adverse; see caveats | `neither` |
| Not attempted / merchant not participating | **7** | Not protected | 3DS contributes nothing; absence is never negative evidence (existing invariant, kept) | — |

**Caveats carried into any implementation (all from the primary):** protection covers *"certain
fraud-related disputes, provided the transaction is processed correctly"*; *"liability shift
rules … may vary by region"*; VFMP-identified merchants are excluded (10.5). Therefore the
letter's claim is always *consistency with protection*, never a categorical rights conclusion.

**Mapping to our data:** Shopify Payments `receiptJson` supplies `eci`, `liability_shift`
(gateway-computed), `authenticated`/`result`. The gateway's `liability_shift` flag SHOULD already
encode the ECI-5/6 distinction per scheme rules — but that is an assumption about Stripe's
computation, not a verified fact. **Phase 0 follow-up:** sample receipts with ECI 6 (prod has
none currently — the only unshifted-3DS pack shows no `eci` at all) before relying on
`liability_shift` alone as the Visa disposition key.

## Mastercard (Identity Check / DSRP) — V-PRIMARY

| Auth state | SLI (DE48 SE42 SF1) | Network position (primary, verbatim-anchored) | Proposed argument disposition (fraud family 4837) |
|---|---|---|---|
| Fully authenticated (Identity Check) | **212** | In the 4837 *"transactions ineligible for chargeback"* list | `supports`; framing per **P-2** (consistency with ineligibility, never categorical); disclosure full (DS transaction id when present) |
| Attempted / UCAF-collection class | **211** | **Also in the ineligible list** — the Mastercard parallel of Visa ECI 6 | `review_required` until the gateway-mapping question below is answered, then per approved matrix |
| DSRP / other protected classes | **217, 242** | In the ineligible list; DSRP = wallet/tokenized flows | Out of scope for current Shopify-Payments ecommerce flows pending mapping; `review_required` if ever observed |
| MIT tied to prior authenticated CIT | prior CIT SLI **212/242** | Issuer *"should not use this chargeback reason code"*; acquirer *"may provide specific evidence that the disputed MIT is related to a prior authenticated CIT in a second presentment"* | New remedy, **not modeled today** — matrix row in the cancelled-recurring/subscription family; requires prior-CIT evidence capture (future work item, own approval) |
| No authentication | — | Not protected | absence never negative (invariant kept) |

**Open gateway-mapping question (applies to BOTH networks' attempted class):** Shopify Payments
`receiptJson` exposes `eci` and a gateway-computed `liability_shift`, not raw SLI. Whether MC
ECI 01/02 in receipts maps 1:1 onto SLI 211/212, and whether `liability_shift` is already
computed per these scheme tables, is unverified — prod currently holds **zero** attempted-class
receipts to sample (the one unshifted-3DS pack carries no `eci` at all). Until sampled, every
attempted-class row (Visa ECI 6, MC SLI 211) stays `review_required`.

## Fixture consequences (replaces F7/F8 — mandate item)

Fixtures must not encode unresolved policy. The former F7 ("3DS with shift = lead role") and F8
("attempted 3DS withheld from issuer") both encoded policy that is now network-conditional.
Replacement set:

| Fixture | Asserts (verified/current behaviour only) | Explicitly does NOT assert |
|---|---|---|
| **F7-V5** — Visa, ECI 5, `liability_shift: true` | Record exists, valid, merchant-visible on every surface; citation `eligible`; scored per current policy | any `lead_invalidity` role (blocked on P-2 + matrix) |
| **F7-V6** — Visa, ECI 6, `liability_shift` as-received | Record exists, valid, merchant-visible; **citation state = whatever the approved matrix decides — fixture is parameterized on the matrix constant**, so approving the matrix updates the fixture, not the reverse | that ECI 6 is adverse (current rule) or protective (primary suggestion) — the test reads the policy table |
| **F7-M212** — Mastercard, Identity Check fully authenticated (SLI 212 / receipt ECI 02) | Record exists, valid, merchant-visible on every surface; **citation state read from the approved policy constant** (parameterized, like F7-V6) | any issuer-facing framing or role — the fixture never selects wording |
| **F7-M211** — Mastercard, attempted class (SLI 211 / receipt ECI 01, `liability_shift` as-received) | Record exists, valid, merchant-visible; citation read from the policy constant; additionally pins that the record is **never silently dropped** (the #352552 invariant) | that 211 is adverse OR protected — the network says protected, but the gateway mapping is unresolved, so the constant governs |
| **F8-X** — no 3DS attempted (ECI 7 / absent) | No record fabricated; absence never penalized; no nag (merchantSuppliable=false) | — |

The parameterization pattern (fixture reads the policy constant it exercises) is the general
mechanism for "tests must not encode unresolved policy": red/green flips happen by changing the
approved policy table, never by editing assertions to match an assumption.
