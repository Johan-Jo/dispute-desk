# Network-specific 3-D Secure disposition table (Phase 0 deliverable)

**Status:** the **network rules** are V-PRIMARY on both networks (register R-A: Visa Dispute
Management Guidelines Jun-2024; Mastercard Chargeback Guide Merchant Edition, extracted
2026-08-05). The **DisputeDesk-observable dispositions are a separate question, and as of
2026-08-05 none of them is citable** — see §0. **No 3DS rule may be generalized across
networks** — each row cites its own network source. Nothing in this table is implemented; it is
the input to the matrix approval.

## 0. Two blocking rules that apply to every row below

**(A) A verified rule is not a citable disposition unless its trigger is observable.** The
primaries speak in **raw network wire values** — Visa ECI, Mastercard SLI (DE 48, subelement 42,
subfield 1). DisputeDesk never observes a raw SLI: the Shopify Payments receipt exposes `eci` plus
a gateway-computed `liability_shift`. A rule verified against a wire value we cannot see has no
verified trigger, and assuming the correspondence would encode an unverified mapping as fact.
**Raw-wire rows and gateway-observable rows are therefore separate objects throughout this
document and in the fixtures**, and are never merged into one row or one test.

**(B) A verified rule is not a citable disposition unless every condition it carries is
represented by a verified input on the case.** Where a primary says "protected *provided* X,
subject to Y, except Z", a claim made without X, Y and Z established is a stronger assertion than
the source supports — and it would be made to an issuer. An unobservable condition therefore
**blocks** the cell: verified rule + unobservable condition = `review_required`, never a citation
with the conditions silently presumed.

**Combined consequence, stated plainly: every 3DS cell DisputeDesk could evaluate today is
`review_required`.** Visa ECI 6 and all four Mastercard states fail (A); Visa ECI 5 — the one
state with an unambiguous observable — fails (B). This is a *policy* conclusion drawn from
verified sources, not a data gap to be worked around.

## 1. Visa (Visa Secure)

### 1.1 The network rule (V-PRIMARY)

| Auth state | ECI | Network position (primary) | Rule verification |
|---|---|---|---|
| Fully authenticated | **5** | Protected **conditionally**; listed 10.4 remedy: *"advise your card processor that the transaction was Visa Secure-authenticated at time of authorization"* | **V-PRIMARY** |
| Attempted; issuer/cardholder not enrolled | **6** | **Also protected** (*"the merchant is protected from fraud-related disputes … ECI of '6'"*) | **V-PRIMARY** |
| Not attempted / merchant not participating | **7** | Not protected | **V-PRIMARY** |

### 1.2 What DisputeDesk can observe, and why nothing is citable yet

| State | Observable? | Blocked by | Disposition today |
|---|---|---|---|
| ECI 5 | **Yes** — receipt `eci` shares the primary's own vocabulary | **rule (B)** — three unobservable conditions (below) | **`review_required`** |
| ECI 6 | Value yes, but our code keys on the gateway's `liability_shift` flag | **rule (A)** — whether `liability_shift` already encodes ECI-6 protection is unverified; prod holds no ECI-6 receipt to sample | **`review_required`** |
| ECI 7 / absent | Yes | — | 3DS contributes nothing; absence is never negative evidence (existing invariant, kept) |

**The three ECI-5 conditions, and why they block it (rule (B)).** All three are stated by the
primary, and none is currently represented anywhere in DisputeDesk's data:

| Condition (primary wording) | Observable today? | Consequence |
|---|---|---|
| *"provided the transaction is processed correctly"* | **No** — we hold no processing-correctness signal | blocks |
| *"liability shift rules … may vary by region"* — the applicable region and its variant | **No** — the shop's address is not the transaction's applicable region, and inferring one from the other is exactly the presumption (B) forbids | blocks |
| VFMP-identified merchants are excluded (routed to 10.5) | **No** — we hold no Visa Fraud Monitoring Program signal | blocks |

Until each is a verified input, **ECI 5 is `review_required` despite the underlying rule being
V-PRIMARY**. Even once unblocked, the letter's claim is always *consistency with protection*,
never a categorical rights conclusion.

**Mapping to our data:** Shopify Payments `receiptJson` supplies `eci`, `liability_shift`
(gateway-computed), `authenticated`/`result`. For Visa the receipt's `eci` shares the primary's
vocabulary, so the *value* is unambiguous; what is unverified is whether `liability_shift` already
encodes the ECI-5/6 distinction per scheme rules — an assumption about the gateway's computation,
not a verified fact. **Follow-up:** sample receipts with ECI 6 (prod has none currently — the only
unshifted-3DS pack shows no `eci` at all) before relying on `liability_shift` as the Visa
disposition key.

## 2. Mastercard (Identity Check / DSRP)

### 2.1 The network rule, stated in RAW WIRE VALUES (V-PRIMARY)

These rows record what the primary says about SLI values. They are **not** dispositions for any
case DisputeDesk can see today — see §2.2.

| Auth state | SLI (DE48 SE42 SF1) | Network position (primary, verbatim-anchored) | Rule verification |
|---|---|---|---|
| Fully authenticated (Identity Check) | **212** | In the 4837 *"transactions ineligible for chargeback"* list | **V-PRIMARY** |
| Attempted / UCAF-collection class | **211** | **Also in the ineligible list** — the Mastercard parallel of Visa ECI 6 | **V-PRIMARY** |
| DSRP / other protected classes | **217, 242** | In the ineligible list; DSRP = wallet/tokenized flows | **V-PRIMARY** (list membership) |
| MIT tied to prior authenticated CIT | prior CIT SLI **212/242** | Issuer *"should not use this chargeback reason code"*; acquirer *"may provide specific evidence that the disputed MIT is related to a prior authenticated CIT in a second presentment"* | **V-PRIMARY** — new remedy, **not modeled today**; belongs in the cancelled-recurring/subscription family; requires prior-CIT evidence capture (future work item, own approval) |
| No authentication | — | Not protected | absence never negative (invariant kept) |

### 2.2 What DisputeDesk can actually OBSERVE — all `review_required`

DisputeDesk never sees an SLI. It sees a Shopify Payments receipt `eci` (and a gateway-computed
`liability_shift`). Mastercard's receipt ECI and its SLI are **different encodings**, and no
verified mapping between them is on file.

| Observable (receipt) | Assumed correspondence | Verified? | Disposition today |
|---|---|---|---|
| `eci` **02** | → SLI 212 (fully authenticated) | **No** — assumed, unsampled, undocumented | **`review_required`** |
| `eci` **01** | → SLI 211 (attempted class) | **No** — assumed; prod holds **zero** attempted-class receipts to sample | **`review_required`** |
| `liability_shift` flag | → already encodes the scheme tables | **No** — an assumption about the gateway's computation | not usable as the disposition key |
| no `eci` / no 3DS | — | n/a | absence never negative (invariant kept) |

**So the authenticated class is no better established than the attempted class.** An earlier
revision of this document said the open mapping question applied to "BOTH networks' attempted
class" — that was wrong and is withdrawn. For Mastercard the gap covers **every** state, because
the gap is between wire value and receipt value, not between authenticated and attempted.

**What would unblock it:** either a data path that surfaces the raw SLI, or documented *and*
sampled confirmation of the ECI↔SLI correspondence for this gateway. Neither exists today.

## 3. Fixture consequences (replaces F7/F8)

Fixtures must not encode unresolved policy. The former F7 ("3DS with shift = lead role") and F8
("attempted 3DS withheld from issuer") both encoded policy that is now network-conditional *and*
observability-conditional. Replacement set — note that **raw-wire fixtures and receipt-observable
fixtures are separate objects**:

| Fixture | Input class | Asserts (verified/current behaviour only) | Explicitly does NOT assert |
|---|---|---|---|
| **F7-V5** | Visa, receipt `eci` 5, `liability_shift: true` | Record exists, valid, merchant-visible on every surface; scored per current policy; **citation read from the approved policy constant, which is `review_required` while processing-correctness, regional applicability and VFMP status are unobservable** (rule B) | that ECI 5 is citable; any `lead_invalidity` role (blocked on P-2 + matrix) |
| **F7-V5-COND** | Visa ECI 5 with each condition toggled | That the cell flips to `review_required` when **any** required condition is missing, and becomes citable only when all three are verified inputs | which wording is used once citable — that is P-2 |
| **F7-V6** | Visa, receipt `eci` 6, `liability_shift` as-received | Record exists, valid, merchant-visible; **citation state = whatever the approved matrix decides — parameterized on the matrix constant**, so approving the matrix updates the fixture, not the reverse | that ECI 6 is adverse (current rule) or protective (primary suggestion) — the test reads the policy table |
| **F7-M-SLI212** | Mastercard, **raw SLI 212** | The V-PRIMARY network rule itself: given a raw SLI 212, the policy table returns the ineligibility-consistency cell | that any receipt value produces this — the input is a raw SLI and cannot be satisfied by an `eci` |
| **F7-M-SLI211** | Mastercard, **raw SLI 211** | Same, for the attempted class: raw SLI 211 is in the ineligible list | that 211 is adverse (today's rule) — the primary says protected |
| **F7-M-ECI02** | Mastercard, **receipt `eci` 02** | Record exists, valid, merchant-visible on every surface; **citation `review_required`** while the ECI↔SLI mapping is unverified, read from the policy constant | that receipt ECI 02 means SLI 212 — asserting the network outcome from a receipt value would encode the unverified mapping as fact |
| **F7-M-ECI01** | Mastercard, **receipt `eci` 01**, `liability_shift` as-received | Record exists, valid, merchant-visible; citation `review_required` per the constant; additionally pins that the record is **never silently dropped** (the #352552 invariant) | that 01 is adverse OR protected — the raw-value rule says protected, the observable is unmapped, so the constant governs |
| **F8-X** | No 3DS attempted (ECI 7 / absent) | No record fabricated; absence never penalized; no nag (`merchantSuppliable=false`) | — |

The parameterization pattern (fixture reads the policy constant it exercises) is the general
mechanism for "tests must not encode unresolved policy": red/green flips happen by changing the
approved policy table, never by editing assertions to match an assumption.

**Raw-wire and observable fixtures must never be merged.** A single fixture that takes a receipt
`eci` and asserts a network-rule outcome would bake the unverified mapping into the test suite,
where it would then read as verified behaviour. The split above is the structural guarantee that
this cannot happen by accident.
