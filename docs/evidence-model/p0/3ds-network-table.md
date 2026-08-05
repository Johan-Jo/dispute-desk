# Network-specific 3-D Secure disposition table (Phase 0 deliverable)

**Status:** Visa rows are V-PRIMARY (register R-A). Mastercard rows are **PENDING** (source
blocked; register S4). **No 3DS rule may be generalized across networks.** Nothing in this table
is implemented yet; it is the input to the matrix approval.

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

## Mastercard (Identity Check) — PENDING

| Auth state | SLI/UCAF | Network position | Proposed disposition |
|---|---|---|---|
| Fully authenticated | (e.g. UCAF 2 / ECI 02) | **PENDING S4** | none may ship |
| Attempted | (e.g. UCAF 1 / ECI 01) | **PENDING S4** | none may ship |

Interim: Mastercard disputes keep current code behaviour unchanged.

## Fixture consequences (replaces F7/F8 — mandate item)

Fixtures must not encode unresolved policy. The former F7 ("3DS with shift = lead role") and F8
("attempted 3DS withheld from issuer") both encoded policy that is now network-conditional.
Replacement set:

| Fixture | Asserts (verified/current behaviour only) | Explicitly does NOT assert |
|---|---|---|
| **F7-V5** — Visa, ECI 5, `liability_shift: true` | Record exists, valid, merchant-visible on every surface; citation `eligible`; scored per current policy | any `lead_invalidity` role (blocked on P-2 + matrix) |
| **F7-V6** — Visa, ECI 6, `liability_shift` as-received | Record exists, valid, merchant-visible; **citation state = whatever the approved matrix decides — fixture is parameterized on the matrix constant**, so approving the matrix updates the fixture, not the reverse | that ECI 6 is adverse (current rule) or protective (primary suggestion) — the test reads the policy table |
| **F7-M** — Mastercard, authenticated | Record exists, valid, visible; citation per current behaviour | anything network-specific (PENDING) |
| **F8-X** — no 3DS attempted (ECI 7 / absent) | No record fabricated; absence never penalized; no nag (merchantSuppliable=false) | — |

The parameterization pattern (fixture reads the policy constant it exercises) is the general
mechanism for "tests must not encode unresolved policy": red/green flips happen by changing the
approved policy table, never by editing assertions to match an assumption.
