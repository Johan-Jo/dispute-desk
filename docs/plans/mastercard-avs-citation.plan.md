# AVS citation — fail closed on both networks, and retract the live defective package

**Status:** PLAN ONLY (v7, 2026-08-26). Not started. **Contains one time-critical action — §1.**
**Deliverable:** stop emitting a standalone AVS address assertion that **no primary source authorizes on either network**; replace the Visa-specific boolean with a rule-identified, versioned citation decision; **block existing defective packages from saving**; and **replace the defective PDF now filed on `#347617` before its 2026-08-27 23:00 UTC deadline.**
**Deployment:** `master` `15fc510`, `develop` `8309eaa` — same tree; CI and Vercel green.
**Sources:** S1 — Visa Dispute Management Guidelines (§4 CE chart Item 3; general AVS guidance pp. 13, 53). S4 — Mastercard Chargeback Guide, Merchant Edition, 19 May 2026, **p. 501 (Dual Message Chargebacks)** and **p. 1189 (Dispute Processing)**.
**Evidence SQL:** `scripts/sql/avs-citation-q2-verification.sql`, `scripts/sql/avs-citation-exposure.sql` — **written locally, NOT committed to any branch.** They are not reproducible from GitHub until the Phase-1 branch lands. Every figure below is labelled with the query that produced it so it can be re-run.

> **Out of scope:** the address-delivery capability. Underivable by design
> (`claimCapabilities.ts:88-92`, adversarially tested); **v7 adds no branch to
> `deriveClaimCapabilities`**. No bank-facing AVS citation is enabled for any
> network.

---

## 0. What v7 corrects

v6 was rejected as unchanged. Every point below is re-verified against production
today, and three of them change the plan's conclusions materially.

| # | v6 defect | v7 |
|---|---|---|
| 1 | Treated `saved_to_shopify` + cron exclusion as "handled" | **WRONG, and it hid a live exposure.** Closure is `submitted_confirmed` (Shopify `evidenceSentOn`). Both disputes are **saved-but-unsubmitted with open windows**; `#347617` is **33.9 h from deadline** with a **defective filed PDF**. §1 |
| 2 | No retrospective protection | **Added.** `packageSafety` must block the assertion on persisted rows across canonical + legacy + finalize paths. §4 |
| 3 | One flat `CitationEligibility` for both networks | **Replaced** with a discriminated per-rule contract. §3 |
| 4 | `addressChainProven: boolean` | **Replaced** with `matched \| mismatched \| unknown`; mismatch → `not_citable`, unknown → `review_required`. §3 |
| 5 | "Maestro denied regardless" | **Wrong** — S4 exempts non-Mastercard-BIN Maestro CNP debit on the Single Message System. Dimensions modelled separately; unavailable → `review_required`. §5 |
| 6 | Asserted on `narrative_json` / "composed payload" | **The mutation carries only a file GID.** Tests must render the PDF, assert absence, and prove that PDF is the uploaded file. §7 |
| 7 | Arithmetic and emission language | **Corrected, and the measurement was incomplete** — a second wording existed that the query never counted. §2 |
| 8 | Called the SQL "committed" | **Withdrawn.** Staged ≠ committed. Header states this plainly; §8 commits them |

### The measurement error that mattered most

v6 counted one phrasing (`billing address matched`). Re-running today found a
**second, uncounted wording**: *"both address verification and security-code
verification were completed."* That is the wording on the **currently filed
package for `#347617`** — so v6's own headline table could not see the single
most urgent case in the corpus. `_avs_verification_phrasing.sql` finds **25
further packages** (19 on 4837, 6 on 10.4; 3 saved; 5 on still-open disputes).

Lesson recorded: a substring probe is not a measurement of a *claim class*. §7's
detector must be semantic and centralized, not a list of remembered phrasings.

---

## 1. TIME-CRITICAL — `#347617` carries a defective filed package, due 2026-08-27 23:00 UTC

**v6's "no rebuild" conclusion was wrong**, and the reason is exactly as raised:
exclusion from the deadline crons is **not** closure of the issuer window. The
code treats only `submission_state = 'submitted_confirmed'` — backed by Shopify's
`evidenceSentOn` — as closed. Both disputes are `saved_to_shopify`, i.e. filed
but not yet forwarded, and **still amendable**.

`scripts/sql/avs-citation-q2-verification.sql`, prod `aokhplydttxtebvbeuzc`,
re-run **2026-08-26**:

| Field | `#347617` | `#345459` |
|---|---|---|
| `status` | `needs_response` | `needs_response` |
| `due_at` | **2026-08-27 23:00+00** | 2026-08-31 23:00+00 |
| `window_open` | **true** | true |
| **`hours_to_due`** | **33.9** | 129.9 |
| `evidence_saved_to_shopify_at` | 2026-08-15 21:28:03+00 | 2026-08-15 21:29:23+00 |
| `submitted_at` | **null** | **null** |
| `submission_state` | **`saved_to_shopify`** | **`saved_to_shopify`** |
| version saved | 6 | 7 |

**Per-version inspection (`_347617_which_version.sql`):** v1–v5 are `failed`/
`stale`; **v6 is `status='submitted'`, `submitted_at` set, and is the file on
Shopify.** Its `paymentAuthenticationArgument` reads verbatim:

> "The available payment authentication records indicate that **both address
> verification and security-code verification were completed** for this
> transaction on the Mastercard network. … Taken together, the available
> authentication signals support the conclusion that this transaction was
> authorized by the cardholder … under Mastercard 4837."

`compound_claim: false`. This is a standalone address-verification assertion on a
Mastercard 4837 — the exact claim S4 does not authorize without merchandise sent
to the AVS-confirmed address. **It is currently the merchant's filed evidence and
will be forwarded to the issuer at the deadline.**

`#345459`'s filed v7 does **not** carry either wording (`pkgs_with_standalone_avs
= 0`) — it is not defective and needs no action.

### Required action, ahead of the code work

1. **Rebuild `#347617` and replace the filed PDF before 2026-08-27 23:00 UTC.**
   The replacement must omit the address-verification assertion entirely; the
   case still stands on CVV match and IP consistency. `saveToShopifyJob` supports
   overwrite while the window is open.
2. **Re-verify after replacement** that the uploaded file GID matches the new PDF
   and that the new PDF contains no address assertion (§7's method).
3. **Re-run the window query for every still-open dispute in the 25-package
   second-wording set** (5 are on open disputes) and apply the same treatment.

This is a live merchant-evidence correction, not a refactor, and it is the one
item in this plan that cannot wait for the PR.

---

## 2. Exposure — corrected arithmetic, and stated at the right strength

`scripts/sql/avs-citation-exposure.sql` (scope: packages whose classified
`avs_cvv_match` fact carries a citable `verificationSummary`):

| Reason code | AVS | Packs | Saved to Shopify | Emit — matched phrasing | Emit — verification phrasing | Emit any | Saved **and** emitted | Compound claim |
|---|---|---|---|---|---|---|---|---|
| 10.4 | `Y` | 21 | 10 | 21 | 0 | 21 | 10 | **0** |
| 4837 | `Y` | 14 | 6 | 14 | 0 | 14 | 6 | 3 |
| 13.1 | `Y` | 6 | 1 | 6 | 0 | 6 | 1 | 0 |
| 4837 | `Z` | 5 | 1 | 5 | 0 | 5 | 1 | 1 |
| (null) | `Y` | 4 | 0 | 4 | 0 | 4 | 0 | 0 |
| 4837 | `A` | 2 | 1 | **0** | 0 | **0** | 0 | 0 |
| **Total** | | **52** | **19** | **50** | **0** | **50** | **18** | **4** |

Arithmetic stated explicitly, per the correction:

- **52** packages eligible; **50** emit; **19 saved to Shopify**; **18 saved and
  emitted**; **4** contain a compound-claim phrase.
- Emitted **outside 10.4** = **29** (14 + 6 + 5 + 4). The earlier "24" excluded
  the five historical `4837/Z` rows **without saying so**; that exclusion is now
  explicit, and 29 is the correct total.
- The four `compound_claim` hits are on 4837 — a **Mastercard** rule whose
  requirement is *sent to*, not *delivered to*. They are not Visa Item 3
  compliance and do not make those packages authorized. Their text must be read
  individually during implementation rather than assumed either way.

**Second wording, outside the above scope** (`_avs_verification_phrasing.sql`, no
`verificationSummary` filter): **25 packages** — 19 on 4837 (3 saved), 6 on 10.4
(1 saved); **5 sit on still-open disputes**, including `#347617`.

### Evidential strength — three distinct claims

| Claim | Status |
|---|---|
| The assertion reaches `narrative_json` | **PROVEN** — queried; `#347617` v6 and `#1079` read verbatim |
| The assertion reaches the generated **PDF** | **NOT VERIFIED.** No PDF has been rendered or extracted |
| The issuer **received** it | **NOT VERIFIED.** The `disputeEvidenceUpdate` mutation carries only the uploaded file's GID — no narrative text. Receipt depends on PDF contents, which are unverified |

v6 said "emitted into the bank-facing document." Only *narrative emission* is
established. §7 makes PDF verification a required test rather than an inference,
and §1 requires it operationally for `#347617` before replacement is called done.

---

## 3. The model — rule-specific eligibility, tri-state address chain

`ceItem3Citable` is named for Visa CE Item 3; Mastercard's route is a
Chargeback-Guide second presentment. `AvsAuthority` (`avsCodeMap.ts:73`) is
`"v_primary" | "v_secondary" | "unverified"` — a **sourcing-strength** axis that
cannot name a rule. Both are replaced by an explicit rule identity.

```ts
export type CitationRuleId =
  | "visa_10_4_ce_item_3"    // S1 §4 CE chart Item 3 — COMPOUND: DELIVERED to the Y/M-matched address
  | "mastercard_4837_avs";   // S4 p.501 / p.1189 — COMPOUND: merchandise SENT to the X/Y-confirmed address

export type CitationStatus = "citable" | "review_required" | "not_citable";

/** Tri-state. A known mismatch is disqualifying; an unresolved chain is not yet decided. */
export type AddressChain = "matched" | "mismatched" | "unknown";

export type MerchandiseCoverage = "complete" | "partial" | "none" | "unknown";

/**
 * Discriminated per rule: Visa must never be gated on Mastercard-only
 * dimensions, and vice versa. Each variant names ONLY what its own source
 * requires.
 */
export type CitationEligibility =
  | {
      ruleId: "visa_10_4_ce_item_3";
      addressChain: AddressChain;
      /** Item 3 requires DELIVERY to that address. Signature explicitly not required. */
      deliveryToAddress: "proven" | "absent" | "unknown";
      merchandiseCoverage: MerchandiseCoverage;
      // No product/geography dimensions — S1 states none.
    }
  | {
      ruleId: "mastercard_4837_avs";
      addressChain: AddressChain;
      /** S4 requires merchandise SENT to the AVS-confirmed billing address. */
      dispatchToAddress: "proven" | "absent" | "unknown";
      merchandiseCoverage: MerchandiseCoverage;
      /** S4 carve-outs — see §5. Each independently resolvable. */
      maestro: MaestroDisposition;
      mainlandChinaDomestic: "yes" | "no" | "unknown";
    };

export interface CitationDecision {
  status: CitationStatus;
  ruleId?: CitationRuleId;
  reason?: string;                 // diagnostic only — never merchant or bank copy
  policyVersion: number;
  sourceEdition: string;           // "S1:2024-06" | "S4:2026-05-19"
  observedNetworkReasonCode: string | null;
  network: CardNetwork;
  avsCode: string | null;
  inputFingerprint: string;
}
```

`citableAddressVerified` becomes **derived** (`status === "citable"`), never a
primitive. `ceItem3Citable` is removed from the cell with **no context-free
replacement**. `AvsAuthority` keeps its meaning; **Mastercard normalization stays
`unverified`** (it propagates as `avsAuthority`, `payloads.ts:127,324`).

### Layers

```ts
const verification = readPaymentVerification(payload);   // context-free
const citation = resolveAvsCitation(verification, {      // contextual
  networkReasonCode,   // REQUIRED — no default
  eligibility,         // the discriminated variant for the resolved rule
});
```

`readPaymentVerification()` stays context-free. `resolveAvsCitation()` is the
sole authority on bank-facing use. The decision is **persisted onto the fact**;
**facts without one fail closed.**

Resolution order:

1. AVS result not a full match → `not_citable`
2. no rule registered for the network → `not_citable`
3. `networkReasonCode` outside the rule's scope → `not_citable`
4. `addressChain === "mismatched"` → **`not_citable`** *(a known mismatch is
   disqualifying, not merely undecided)*
5. any required dimension `unknown`, or the rule's addressed-evidence element
   `absent` → **`review_required`** — **where both networks land today**
6. all satisfied → `citable` with `ruleId`

Steps 4–5 are the substantive change: **rule-driven, not network-driven.** Visa
and Mastercard fail closed for the same structural reason — an unproven address
chain — and Visa is never evaluated against Mastercard's carve-outs.

---

## 4. Retrospective protection — block defective persisted packages from saving

The forward fix does not neutralize the ~75 packages already carrying the
assertion. Any of them can still be saved by a rebuild/finalize path.
`lib/defence/packageSafety.ts` is the correct boundary: it inspects **persisted
rows**, is already the gate on all three save paths —
`lib/automation/pipeline.ts:18`, `lib/automation/pipeline.legacy.ts:41`,
`lib/automation/finalizeAndEnqueueSave.ts:29` — and already walks every string at
any depth via `collectStrings` (deliberately a denylist-proof reader).

Its current doctrine does **not** treat the AVS wording as unsafe. v7 adds a
detector for the **claim class**, not a phrase list:

- an address/AVS verification assertion (matched, verified, confirmed, completed,
  performed — in any of the observed wordings) **presented without** the rule's
  compound element;
- evaluated identically under **canonical and legacy** settings, because a
  defective package must not become fileable by toggling a pipeline flag;
- applied to `final` packages at the save boundary, so pre-v7 rows are caught on
  the way out rather than only at generation.

**Both wordings found so far must be covered, and the detector must be the single
place this class is defined** — §2's lesson. The generator's guard, the safety
gate and the tests read the same predicate.

---

## 5. Maestro — modelled, not blanket-denied

v6's "Maestro denied regardless" contradicts S4, which carves out
**non-Mastercard-BIN Maestro CNP debit transactions processed on the Single
Message System** from the prohibition. Blanket denial is wrong in the merchant's
favour-losing direction: it would refuse a route the network permits.

```ts
export type MaestroDisposition =
  | "not_maestro"
  | "maestro_excluded"          // Maestro, and NOT the carved-out combination
  | "maestro_carved_out"        // non-MC-BIN + CNP debit + Single Message System
  | "unknown";
```

The carve-out needs three independently-resolved dimensions — BIN sponsorship
(Mastercard-BIN vs not), card product (CNP debit), and processing system (Single
vs Dual Message). **None is currently collected**; `paymentSource.ts` yields
`bin`, `cardCompany`, `lastFour`, `cardholderName`, `expirationMonth/Year`,
`wallet`, `gateway`.

Therefore: **`unknown` → `review_required`**, never a silent permit or a silent
denial. **Broad BIN prefixes are not the boundary** — ranges are reassigned and
the mapping is not a sourced contract; a BIN heuristic may raise a diagnostic
alarm but must never decide citability. Same discipline for
`mainlandChinaDomestic`: Mastercard defines an intracountry transaction by
card-acceptance location and card-issuing country, not merchant domicile; the
value is unobservable, so `unknown` → `review_required`.

**No substitute AVS letter table.** Full Mastercard letter semantics are not
public and are not needed — S4 names the qualifying codes. Processor tables
(Chase, TabaPay, Adyen, Authorize.net) disagree with one another and are not
network authority.

---

## 6. The blocker is evidence collection — no capability branch here

`docs/technical.md:5730-5736` requires all four of: an AVS result satisfying the
governing rule; the shipping address proven identical to the complete
AVS-submitted address — **currently impossible**, `orderSource.redactAddress`
discards the street line and truncates the postal code, and Shopify does not
expose the AVS-submitted address; delivery evidence naming the address; and
sufficient merchandise coverage.

**That contract also needs correcting:** it hardcodes **`{Y, M}`** as "the
governing rule" — Visa's set presented as network-generic. Under §3 it must read
*the codes named by the rule registered for the observed network*.

The capability must be network- and reason-specific:

| | Visa 10.4 (CE Item 3) | Mastercard 4837 AVS |
|---|---|---|
| Requirement | item **delivered to** the AVS-matched physical address | merchandise **sent to** the AVS-confirmed billing address |
| Signature | explicitly not required | not specified |

A single capability gated on delivery would be **stricter than Mastercard's
remedy**. Phase 2 designs collectors first; the enum follows the evidence.

---

## 7. Tests — including the PDF, which is what the issuer actually receives

**The `disputeEvidenceUpdate` mutation carries only the uploaded file's GID — no
narrative text.** Asserting on `narrative_json` or "the composed payload" does
not prove what the issuer sees. Required:

- **PDF-level assertion.** Render/extract the generated PDF for a Visa `Y` pack
  on 10.4 with an unproven address chain, and assert the address assertion is
  **absent from the extracted text** — both wordings, via the §4 shared
  predicate.
- **Uploaded-file identity.** Assert the file GID in the mutation resolves to
  **that exact PDF** (hash or storage path), so a stale or different artifact
  cannot pass while the rendered one is clean.

Plus:

- **Both networks fail closed today:** Visa `Y`/`M` on `10.4` with
  `addressChain: "unknown"` → `review_required`, `ruleId:
  "visa_10_4_ce_item_3"`; Mastercard `X`/`Y` on `4837` → `review_required`,
  `ruleId: "mastercard_4837_avs"`. No AVS sentence for either.
- **Tri-state:** `mismatched` → `not_citable`; `unknown` → `review_required`;
  `matched` **plus** the rule's addressed evidence **plus** coverage `complete`
  → `citable`.
- **Rule isolation:** a Visa eligibility object cannot be passed where Mastercard
  is resolved (type-level), and Visa is never denied for `maestro` or
  `mainlandChinaDomestic`.
- **Maestro:** `maestro_carved_out` is **not** an automatic denial;
  `maestro_excluded` denies; `unknown` → `review_required`.
- **Reason-code scope:** Visa `Y` on `13.1`/`4837`/`12.6.1`/`null` →
  `not_citable` *(4837 explicitly — `visa_10_4_fraud.reasonCodeKeys` conflates
  it with 10.4)*.
- **Non-match:** Visa `Z`/`A`/`W`/`N`/`U` → no citation, no summary.
- **Fail-closed defaults:** facts with no persisted `CitationDecision` → never
  citable.
- **Retrospective gate (§4):** a pre-v7 persisted `final` package containing
  either wording is refused by `packageSafety` under **both** canonical and
  legacy settings.
- **Audit contract:** every decision carries `policyVersion`, `sourceEdition`,
  `observedNetworkReasonCode`, `network`, `avsCode`, `inputFingerprint`.
- **Projection agreement** with the persisted decision; **deadline selection**
  unchanged across all three routes.
- `amex`/`unknown` network → `not_citable`, distinct from `review_required`.

**Verify:** `npm test`, `npx tsc --noEmit`, `npm run build`.

---

## 8. Affected surface — paths verified on disk

| Module | Change |
|---|---|
| `lib/defence/packageSafety.ts` | **§4 retrospective detector**, shared predicate, canonical + legacy |
| `lib/defence/factClassifier.ts` | **required** `networkReasonCode` on `ClassifyFactsInput` (`:91-101` — verified absent); persist `CitationDecision`; redesign `isFieldBankEligible` (`:219`) / `isUnciteablePaymentVerificationFact` (`:180`) |
| `lib/defence/factPredicates.ts` | read the frozen decision |
| `lib/defence/pdf/evidenceBasisRows.ts` | no row for a non-citable fact |
| `lib/defence/pdf/thesisTokens.ts` | no token for a non-citable fact |
| `lib/evidence/model/derive.ts` | accepts `networkReasonCode` (`:91`), ignores it — wire through |
| `lib/evidence/model/payloads.ts` | carry the decision (`:127,:324`) |
| `lib/argument/evidenceLineItem.ts` | `reasonFamily` only (`:230,:878`) — consume the decision |
| `lib/argument/internalSignals.ts` | may keep factual match; must not inherit citability |
| `lib/packs/buildPack.ts:912` | pass `networkReasonCode` |
| `app/api/disputes/[id]/workspace/route.ts:779` | pass `networkReasonCode` |
| `app/(embedded)/app/disputes/[id]/tabs/useEvidenceSections.ts` | agree with the persisted decision |
| `lib/argument/canonicalEvidence.ts` | must not re-derive citability |

**Merchant-visible change: YES.** Inclusion and citation explanations change — a
payment-authentication fact that read as bank-eligible will present as
review-required. `npm run build` required.

**SQL commit (point 8).** `avs-citation-q2-verification.sql` and
`avs-citation-exposure.sql` are written locally and **not committed**. They land
in the Phase-1 branch as its first commit, before any code change, so the
evidence is reproducible from GitHub at review time. Until that push, no figure
here should be described as GitHub-reproducible.

---

## 9. Sequencing

**Phase 0 — TODAY, ahead of the PR (§1).** Rebuild and replace `#347617`'s filed
PDF before 2026-08-27 23:00 UTC; verify the new upload; triage the 5 still-open
disputes in the second-wording set. Merchant-evidence correction, not a refactor.

**Phase 1 — one atomic PR.** Commit the SQL first; then §3 model, §4
retrospective gate, §5 Maestro dimensions, required `networkReasonCode` wiring,
§8 consumers, register corrections (retitle R-E to name Visa 10.4 **and record
that it authorizes only the compound claim**; add R-E-MC; fix the reintroduction
contract's hardcoded `{Y, M}`), §7 tests, `docs/technical.md`.

**Phase 2 — separate approval.** Address-evidence collectors, then a
network/reason-specific capability contract. If the AVS-submitted address proves
unobtainable, document the route as permanently closed.

---

## 10. Impact

| Outcome | Effect |
|---|---|
| **Live filed evidence corrected** | **`#347617`** — defective PDF replaced before deadline (§1) |
| Existing defective packages | **Blocked from saving** by §4 |
| Citations enabled | **Zero, both networks** — `review_required` by design |
| Live defect stopped | standalone AVS assertion, all reason codes, both networks |
| Merchant-visible change | **Yes** |

**Why:** production emits an assertion **no primary source authorizes on either
network** — 50 packages by one wording, 25 more by a second, **zero** making the
compound claim the rules license, and one of them is filed on a dispute due
tomorrow. Same failure class as the retired `deliveredToVerifiedAddress` claim,
which this codebase deleted rather than disabled.

**Still materially higher-priority than Phase 1** (though not than Phase 0):

1. **Fatal-loss gate** — `4837 + nothing shipped + zero prior orders`, **19
   packs of live exposure**.
2. **The merchant conversation** — 3DS at checkout (2% of transactions), fraud
   wave of July 2026: 75 disputes, 91% fraud, **52 of 74 orders shipped
   (~$8,900 of goods gone)**.

## 11. Open questions

1. **Is there any primary source authorizing a standalone AVS sentence?** None
   found in S1 or S4. Absent one, both networks stay `review_required`.
2. **Do the 4 `compound_claim` hits on 4837 satisfy S4's *sent-to* requirement,
   or are they Visa-shaped *delivered-to* text on a Mastercard case?** Read
   individually during Phase 1.
3. **Can the AVS-submitted address be obtained at all?** Gates Phase 2 entirely.
4. **Should merchants be told about historical filed packages?** Those past
   window are unamendable. Recommendation: no notification; record in the
   register.
