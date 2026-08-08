# Phase 0.5 containment proposals — each item separately approvable

**Status: PROPOSED, not approved.** Phase 0's approval covers none of these. Each is a narrow
fix for a defect **currently reachable in production**, shippable before and independently of the
migration. Each ships alone: own approval, own PR, own before/after diff on regenerated packages.
None restores past behaviour; none adds architecture. Reachability measured 2026-08-05
(read-only; queries reproducible).

**Amendment 2026-08-08 — the address containment series (C-11 – C-14) is appended below.**
**C-11 is no longer a proposal**: it shipped as PR-C1 (#517) and is released and
production-validated (#519). C-12 – C-14 are proposals and inherit this document's status
(proposed, not approved, each separately approvable).

| # | Defect | Reachability (measured) | Proposed narrow fix | Bank-visible effect |
|---|---|---|---|---|
| **C-1** | Unciteable 3DS reaches the LLM payload, satisfies `three_d_secure_present` for claim guards, and resolves the thesis `paymentAuthMethod` — suppressed only in the PDF table (four-predicate divergence) | **1 open dispute** (unshifted-3DS pack with a defence package) | Unify the LLM-payload filter to the Evidence-Basis predicate (`bankEligible ∧ includeInBankNarrative ∧ ¬submissionRisk`); update `narrativeWriter.bankInclusionInvariant.test.ts` which currently pins the weaker contract | Prompts/guards/thesis stop seeing facts the PDF table already suppresses. **Note (register R-A + `3ds-network-table.md` §0):** the "unciteable" class is network- *and* observability-conditional. The network rules are V-PRIMARY on both sides (Visa ECI 5/6 protected; MC SLI 211/212/217/242 ineligible), but **no DisputeDesk-observable 3DS state is citable today** — Visa ECI 6 and every Mastercard state are blocked on the gateway↔wire-value mapping, and Visa ECI 5 on three unobservable rule conditions. C-1 only makes the four surfaces agree with each other under today's rule; it decides none of those cells |
| **C-2** | Thesis token asserts "undisputed" purchase history without `disputeFreeHistory === true` | **16 live packages** carry an unverified prior-history fact with `priorOrderCount > 0`; any whose thesis includes the clause tells an issuer "undisputed" unverified | **Emit no prior-history clause at all unless `disputeFreeHistory === true`.** `true` → current wording; `null` or `false` → clause absent. (A "count-only" replacement wording was considered and **rejected**: containment removes an unverified claim, it does not invent a new issuer-facing assertion nobody approved. Any count-only clause is a separate proposal with its own justification and approval.) Matches the Evidence-Basis renderer and the repeat-customer strategy prompt, both of which already refuse the word. Primary-anchored: the CE-chart/profile evidence contemplates *undisputed* prior transactions specifically | Removes a potentially false assertion to issuers; adds none |
| **C-3** | `no_return_initiated` renders to the issuer as the word "Confirmed", sorted last (rank 999); 3 more categories share the default | **Every package citing it** (incl. #352552 v5) | Add a renderValue branch ("No return initiated or received") + `CATEGORY_ORDER` entries for `no_return_initiated`, `subscription_terms`, `digital_access_log`, `service_access` | Verified rebuttal content (register R-C) becomes legible instead of noise |
| **C-4** | PDF footer prints `packageMode` + `prompt v{n}` on every page | **Every PDF** | Remove from the footer; keep both in `defence_packages` metadata/audit | Stops disclosing internal posture (narrow/full) to issuers |
| **C-5** | "Cardholder name" Case-Details row falls back to the ORDER customer name | **Any package lacking a gateway cardholder name** | Render the row only when gateway-sourced; otherwise label "Customer name" | Stops mislabeling a name to the issuer on exactly the disputes where names diverge |
| **C-6** | Synthetic chronology assertions ("Authorisation captured against the cardholder's {network} ending in {last4}") bypass all validators | **Conditional** — packs without a rich Shopify timeline | Two requirements, both mandatory: (1) synthetic chronology events may be **derived only from verified structured inputs** actually present on the case (e.g. network + last4 read from the transaction record — never free-composed prose); (2) the derived bullets then ALSO pass `validateComposedDocument`'s phrase + claim-guard checks before render. Phrase checks alone are not authorization to manufacture an assertion | Closes the one unvalidated bank-facing text path, at the derivation layer first |

Not proposed for containment (not reachable):

| # | Defect | Why no containment |
|---|---|---|
| C-7 | Manual-evidence promotion mints `supporting ∧ bankEligible:true` | **0** `defence_manual_evidence` rows in prod; Phase 4 fixes it |
| C-8 | CE 3.0 package: raw IPs, ungated attestation, hard-coded "10.4" | Dormant — no caller; decision P-4 governs |
| C-9 | `canceled_recurring` forced `narrow` by unreachable category | **0** open SUBSCRIPTION_CANCELLED disputes; decision P-5 governs (zero-risk window to fix) |
| C-10 | Prior-chargebacks disclosure branch | Dead (grade `supporting` blocks it); decision P-8 encodes the rule and deletes it |

Recommended order if approved: C-3 and C-4 (pure rendering, lowest risk) → C-5 → C-2 → C-6 →
C-1 (touches the LLM payload; regenerate the one affected package after).

---

# Address containment series — C-11 … C-14

One defect class: **an address- or verification-shaped claim graded on data that never read the
issuer's response.** C-11 closed the delivery half of it in production. C-12 – C-14 close the
authorization half. They are listed here as one series because C-14's deletion is only safe once
C-12 and C-13 have given the address-verification semantics a real owner.

| # | PR | Defect | Reachability (measured) | Narrow fix | Bank-visible effect |
|---|---|---|---|---|---|
| **C-11** | **PR-C1** | `deliveredToVerifiedAddress` / `collectedByCustomer` graded a delivery claim STRONG from a billing-vs-shipping city+country comparison that read no AVS code | **Was: 60 packs asserted a verified address, 54 of them on an issuer `AVS = N`**; 212 package versions across 91 disputes carried the claim at release | **SHIPPED** — both derivations deleted, both keys retired at every derivation boundary, `delivered_confirmed` graded Moderate always, `address_delivery` made an underivable claim capability re-derived in narrative validation, one `packageSafety` predicate consulted at every save/forward/auto-file/deadline boundary | Unsupported verified-address delivery claims can no longer reach an issuer, on any path |
| **C-12** | PR-C2 | `avs_cvv_match` fuses two independent evidence facts (issuer AVS response, CVV/CVC response) into one record, one grade, one checklist row and one citation decision — and the match-code sets are redefined at four independent sites | **Every card pack**: prod grade census at the PR-C1 measurement — strong 27 / moderate 77 / invalid 3 (unchanged by PR-C1) | Split the fact identity and the predicate: AVS and CVV become distinct evidence facts with distinct semantics, behind **one** shared predicate owner; legacy combined payloads normalize at the derivation boundary | **Not "none".** Decision 1 makes a CVV-only match non-citable, so CVV-only citations drop out — a conservative removal whose delta must be **measured and enumerated case by case** before merge. Downstream it becomes possible to say *which* verification the issuer returned, rather than "payment authentication" |
| **C-13** | PR-C3 | Grading keys on a single network-agnostic match set (`Y A W X D M`) while the only V-PRIMARY rule we hold (register **R-E**, Visa §4 CE chart Item 3) qualifies **`Y` or `M` specifically**; unknown/missing codes are treated one way by the grader and another way by the merchant-facing signal | **Every card pack** (same population as C-12); unknown/unmapped-code count to be measured before the PR | Canonical normalization + grading map for Visa / Mastercard / Amex network AVS results; grade from the normalized value, never from the raw letter; unknown, missing and unmapped codes lose all claim/citation credit and raise an internal diagnostic without parking the dispute | Citation narrows to the primary-sourced `Y`/`M` (decision 3) instead of resting on a match set broader than the rule it invokes; delta enumerated |
| **C-14** | PR-C4 | `billing_address_match` is graded **strong** ("Strong when AVS-confirmed billing matches the cardholder") but is emitted when Shopify's **own** billing and shipping addresses share a city and country — two merchant-held addresses, no AVS, no cardholder | **Fleet census: collected 95, valid 0** (`categorizeEvidenceField` already returns `invalid`, which is the safe answer — runtime is not the defect) | Retire the key as an independent evidence-strength / claim-authority signal via the established `retiredKeys.ts` boundary; the address-verification semantics live on the canonical AVS fact from C-12/C-13 | Removes a strength/authority signal that never carried the authority its grade claimed |

## C-11 / PR-C1 — verified-address delivery-claim containment (IMPLEMENTED · RELEASED · PRODUCTION-VALIDATED)

- **Merged:** PR **#517** to `develop` (`ddd17e0c`). **Released to production:** PR **#519**
  (`develop → master`, merged 2026-08-08T14:31Z), after the three promotion migrations
  (`20260807200000`, `20260807230000`, `20260808000000`) were applied at 14:24Z.
- **The deployed gate blocks unsupported verified-address delivery claims at every
  promotion/save boundary** — the save job, the manual save route
  (`POST /api/defence-packages/[id]/submit`), the deadline cron's candidate selection, and the
  workspace readiness projection all consult the one `packageSafety` predicate. Blocked
  candidates stay viewable, with Preview and Regenerate available; a regenerated candidate is
  judged on its own merits.
- **Production read-only reconciliation:** **212 of 280 package versions blocked — exactly
  matching the pre-release census** (`2026-08-07T18:24:16.273Z`: 212 package versions across 91
  disputes). The deployed behaviour is the measured behaviour; no drift between the census and
  the gate.
- **No regeneration, backfill or remediation of the 91 affected disputes occurred.** No
  `pack_json` rewrite, no submission-state change, nothing already in Shopify altered.
  Remediation remains a separate decision and a separate PR.
- **One live-boundary refusal remains outstanding as an observational confirmation, not an
  implementation blocker.** A read-only post-cron observation query (held locally as
  `scripts/sql/prc1-post-cron-observation.sql`, not committed) records the first genuine
  production block (`defence_package_blocked_unsafe_claim` with `contentBlock=true`). Until a
  real save/forward attempt hits the gate, the correct record is "not yet exercised" — it does
  not gate C-12 and it does not reopen C-11.
- **C-11 is closed. It is not reopened or expanded by anything in this series.** Out of scope
  and unchanged by it: AVS/CVV grading, the network code map, the predicate split,
  `criticalCategories`, P-7, Slice 2.1, and all production remediation.

## C-12 / PR-C2 — AVS/CVV predicate split (PROPOSED)

**Defect.** `avs_cvv_match` is one canonical field standing for two independent facts produced by
two different checks. The grader collapses them
(`lib/argument/canonicalEvidence.ts` — strong iff both match, moderate iff either matches,
invalid otherwise), so downstream nothing can distinguish "the issuer confirmed the billing
address" from "the issuer confirmed the security code". The Visa CE chart rule we cite is an
**address** rule; a CVV-only match currently reaches the same `moderate` grade that partial
address evidence does. Compounding it, the match-code sets are defined **four** times —
`lib/argument/canonicalEvidence.ts:390-392`, `lib/argument/evidenceLineItem.ts:835-836`,
`lib/argument/internalSignals.ts:72-73`,
`app/(embedded)/app/disputes/[id]/tabs/useEvidenceSections.ts:381-382` — the last three kept "in
lockstep" by comment only.

**Containment boundary.** The split changes *identity and predicate ownership*, and applies
decisions 1 and 2. It does **not** decide which codes qualify (C-13), does **not** retire
`billing_address_match` (C-14), does **not** change completeness thresholds or the denominator,
and does **not** rewrite issuer-visible wording beyond what removing the CVV-only citation
requires. Grades for a given (AVS, CVV) pair must be reproducible from the pre-split behaviour
or the difference enumerated case by case.

**Decided inputs (see *Decision gates*).**

- **CVV-only match — decision 1.** A CVV/CVC match with no qualifying AVS result is a **valid
  internal merchant fact**: it is collected, graded, shown to the merchant and may inform
  internal diagnostics. It is **not issuer-citable**, and it **cannot satisfy an AVS/address
  claim, CE chart Item 3, or any related claim guard**. The predicate must make that
  impossible structurally, not by prompt instruction.
- **Completeness — decision 2.** PR-C2 keeps **one grouped payment-verification requirement**
  with AVS and CVV as separate **subfacts** beneath it. The merchant-visible denominator does
  not change and no threshold moves; the split is visible in what the row *says*, not in how
  many rows there are.

**Affected consumers.**

| Layer | Site |
|---|---|
| Collection | `lib/packs/sources/orderSource.ts` (emits the combined field) |
| Grading | `lib/argument/canonicalEvidence.ts` (`CANONICAL_EVIDENCE.avs_cvv_match`, `categorizeEvidenceField`) |
| Canonical model | `lib/evidence/model/payloads.ts` (typed payload + legacy `avs_result_code` normalizer), `types.ts`, definitions/derivation |
| Citation | `lib/defence/factClassifier.ts` (`payment_authentication` category, `verificationSummary` phrasing), `lib/defence/alwaysAdmissible.ts` |
| Scoring | `lib/argument/caseStrength.ts` (`isFraudAvsOnlyStrong`), `lib/evidence/model/assessment.ts` |
| Completeness | `lib/automation/completeness.ts` (`required_if_card_payment` rows, both templates) |
| Line items / merchant UI | `lib/argument/evidenceLineItem.ts`, `lib/argument/internalSignals.ts`, `app/(embedded)/app/disputes/[id]/tabs/useEvidenceSections.ts` |
| Adjacent read | `lib/argument/nameMismatch.ts` via the payload's gateway `cardholderName` (must keep working across the split) |
| Copy | `disputes.signalLabel.payment_auth` ×6 locales |

**Required migration away from the combined predicate.**

1. One shared predicate module owns AVS and CVV classification; the four duplicate code-set
   definitions are deleted, not synchronized.
2. Historical `pack_json` continues to parse: the combined shape normalizes into the two facts
   at the derivation boundary (the pattern `retiredKeys.ts` established), so no persisted data
   is rewritten and no pack is regenerated.
3. Completeness keeps **one grouped payment-verification requirement** (decision 2): AVS and CVV
   become subfacts of the existing row rather than two rows. The denominator and the thresholds
   are unchanged — this is a stated constraint of the PR, not an outcome to be discovered.

**Acceptance criteria.**

- No second definition of the AVS or CVV match sets anywhere in the repo.
- Prod read-only measurement before merge: grade, case-strength, completeness and
  citation-eligibility deltas either zero or fully enumerated per case.
- **The CVV-only citation removal is measured and enumerated, not assumed to be nil.** Every
  package version that cites a CVV-only match today is listed with its dispute, and the
  post-split citation set for each is stated. This is the one intended bank-visible delta of
  PR-C2, and it is conservative by construction (a claim is withdrawn, never added).
- No other issuer-visible wording change attributable to this PR.
- Completeness denominator and thresholds provably unchanged (decision 2).
- Legacy and current payload shapes both derive; divergence manifest stays at 0.

**Required tests.**

- Unit: the split predicate across present/absent/empty/lowercase/whitespace codes on both
  facts, plus the legacy combined and `avs_result_code` shapes.
- CI invariant (class-closing, not instance-patching): fail the build on any second definition
  of the match sets outside the owning module.
- Invariant (decision 1): a CVV-only match is present as an internal fact and **absent** from
  the citation set, the LLM payload's citable values, and every AVS/address claim guard —
  asserted on the fact layer, not on generated prose.
- Invariant (decision 2): the grouped payment-verification requirement contributes exactly one
  unit to the completeness denominator before and after the split.
- Characterization fixtures copied verbatim from prod payloads.
- Regression: `nameMismatch` still reads the gateway cardholder name; `evidenceDivergenceManifest`
  guard green.

## C-13 / PR-C3 — AVS grading and the Visa / Mastercard / Amex network-code map (PROPOSED)

**Defect.** AVS response codes are network-specific, and we grade them with one flat set
(`Y A W X D M`) applied regardless of network. The only V-PRIMARY authority we hold — register
**R-E**, Visa §4 Compelling Evidence chart Item 3 — qualifies an **AVS match of `Y` or `M`**
specifically. Our set is therefore broader than the rule it is used to invoke. Separately,
unknown and missing codes are handled inconsistently: the grader treats "not in the match set"
as not-a-match, while the merchant-facing internal signal treats the same value as a *mismatch*.

**Canonical normalization and grading.**

1. A map keyed on **(network, raw code)** → a normalized result:
   `full_match | street_match | postal_match | no_match | not_checked | unavailable | unknown`.
   Networks covered: Visa, Mastercard, Amex.
2. Every grading, citation and merchant-signal decision reads the **normalized** value. No
   consumer may branch on a raw letter.
3. **Unknown, missing and unmapped codes lose all claim and citation credit, and raise an
   internal diagnostic — they do not park the dispute.** Such a code is never a match, never
   citable, never a negative assertion about the cardholder, and never completeness credit for
   a verified address; it is recorded as an internal diagnostic (a *recorded gap*, not a silent
   fall-through) visible to us and to the merchant as an internal signal. It must **not**
   automatically set the whole dispute to `review_required`: the normal path is that the case
   simply proceeds without that credit. **Escalation happens only if a package attempts to rely
   on the code** — i.e. a claim or citation would need it to be a match — and that attempt is
   refused and escalated, not silently downgraded.
4. **Classification authority stays in the canonical rules/evidence layer**
   (`lib/argument/canonicalEvidence.ts` + `lib/evidence/model/`). No mapping, no match set and
   no grade may be defined in a UI component, a prompt, a strategy module or the LLM payload
   builder.

**Decided input (see *Decision gates*).**

- **Citation set — decision 3.** **Only the primary-sourced `Y` / `M` may enter the CE chart
  Item 3 citation path** (register R-E). Broader normalized results — `street_match`,
  `postal_match` and the rest of the current `Y A W X D M` set — remain valid for **internal
  display and internal scoring inputs only**, and are never admitted to that citation path. The
  two sets are named separately in code and never conflated.

**Acceptance criteria.**

- Every mapped code carries its authority state (V-PRIMARY / V-SECONDARY / unverified) per
  `p0/primary-source-register.md`; unverified cells stay non-citable rather than assumed.
- The CE chart Item 3 citation set is exactly `{Y, M}` (decision 3); the internal-display set is
  declared separately and cannot reach a citation.
- Unknown/unmapped code frequency measured on prod (read-only) before the PR merges, together
  with the count of packages that would have *relied* on such a code (the escalation population).
- No threshold, no strength policy and no issuer wording changed by this PR beyond narrowing the
  Item 3 citation set, whose delta is enumerated case by case.

**Required tests.**

- Table-driven per network across mapped, unmapped, empty, lowercase and whitespace inputs.
- Invariant: the citation-eligible set for the CE Item 3 address claim is exactly `{Y, M}`, and
  a `street_match`/`postal_match` result reaches internal display but never a citation.
- Invariant: an unmapped code loses grade, citation and completeness credit on **every**
  consumer and raises the internal diagnostic — one fixture asserted across all four.
- Invariant: an unmapped code alone does **not** set `review_required`; a package that attempts
  to rely on it is refused and escalated. Both halves asserted separately.

## C-14 / PR-C4 — `billing_address_match` retirement (PROPOSED)

**Defect.** `lib/argument/canonicalEvidence.ts` grades `billing_address_match` **strong**, with
the note "Strong when AVS-confirmed billing matches the cardholder". `lib/packs/sources/orderSource.ts`
emits it when Shopify's own `billingAddress` and `shippingAddress` share a city and country —
two merchant-held addresses, no AVS result, no cardholder. This is the same defect class PR-C1
retired on the delivery side, and PR-C1 deliberately left it out of scope. Fleet census:
**collected 95, valid 0** — the grader's `invalid` is already the safe answer, so this is an
evidence-semantics and ownership defect, not a runtime bug. Writing `match: true`, or reading
presence as validity, would promote geographic similarity into AVS-confirmed cardholder evidence.

**Removal.** `billing_address_match` ceases to be an independent evidence-strength or
claim-authority signal. It is retired through the `lib/evidence/model/retiredKeys.ts` boundary,
so historical `pack_json` still parses but the key can never again produce a record, a category,
a grade, a completeness credit, a citation or an LLM value — surfaced only as
`nonEvidence.operational.retiredFields`.

**Consumers that must migrate to the canonical AVS/address facts.**

| Consumer | Migration |
|---|---|
| `lib/defence/factClassifier.ts` (`billing_match` fact category, label) | Address verification is carried by the C-12/C-13 AVS fact; the `billing_match` category loses its only member |
| `lib/automation/completeness.ts` (two templates, `required_always`, priority critical) | Row removed; the address-verification requirement, if any, is expressed on the AVS fact |
| `lib/argument/evidenceLineItem.ts` (row, ordering, reason) | Row removed with its ordering entry |
| `lib/evidence/model/payloads.ts` (`{ fieldKey: "billing_address_match"; match: boolean }`) | Legacy shape parses, derives nothing |
| Merchant billing-vs-shipping internal signal (`internalSignals.ts`, `useEvidenceSections.ts`) | **Decision 4:** preserved as an explicitly **non-evidence operational note** — "billing and shipping city/country agree" — under a **new label**. Never evidence, never scored, never cited, never a claim input |
| `p0/policy-matrix-v0.3.md` row "Billing address match" | Its V-PRIMARY chart linkage is to the **AVS** fact; the authority migrates to the AVS fact, and the row is restated rather than inherited |
| `disputes.signalLabel.billing_match` ×6 locales | **Decision 4: retired, not repurposed.** The evidence label is misleading (it names an AVS-confirmed cardholder match that never existed); the operational note ships under a **new** key in all 6 locales in the same PR |

**Deletion criteria (all must hold before the key is retired).**

1. C-12 and C-13 are merged and the canonical AVS fact carries the address-verification
   semantics — the concept must have a new owner before the old one is deleted.
2. Prod read-only measurement enumerates every strength, completeness and citation delta, and
   confirms no case ends up *weaker* purely because a genuinely AVS-verified address is not yet
   represented on the new fact.
3. `claimCapabilities` re-derivation shows no narrative claim depends on the key.

**Compatibility boundaries.** Historical `pack_json` parses unchanged; nothing is rewritten; no
regeneration and no backfill; `CANONICAL_EVIDENCE_VERSION` bumps so persisted category caches
recompute.

**Required tests.** Retired-key boundary tests (no record, no category, no grade, no completeness
credit, no citation, no LLM value, present in `retiredFields`); completeness templates no longer
reference the field; divergence-manifest guard green; claim-capability re-derivation test; the
merchant billing-vs-shipping note still renders wherever it is kept.

## Dependency chain

```
PR-C2 + PR-C3  →  PR-C4  →  P-7 calibration  →  threshold approval  →  Slice 2.1 deployment
```

- **PR-C2 and PR-C3 both precede PR-C4**, and neither alone is sufficient: the split without the
  code map leaves grading on an unsourced match set, and the code map without the split cannot
  say which fact a code grades.
- **PR-C4 precedes P-7 calibration.** P-7 is blocked by the `billing_address_match` semantics,
  not by a threshold question — calibrating over a field that is collected 95 / valid 0 measures
  the defect, not the gate.
- **P-7 calibration precedes threshold approval**, which precedes **Slice 2.1 deployment**.

## Constraints carried into this series

1. **P-7 thresholds must come from the read-only calibration report**
   (`docs/evidence-model/p2/completeness-calibration-report.md`, re-run after PR-C4). **Do not
   invent thresholds** and do not carry forward a number from an earlier advisory run.
2. **Slice 2.1 remains blocked** until those thresholds are explicitly approved by the
   maintainer.
3. **PR-C1 is not reopened or expanded** by any item in this series.
4. **No remediation of the 91 affected disputes** by any item in this series — no regeneration,
   no backfill, no `pack_json` rewrite, no submission-state change. Remediation is its own
   decision and its own PR.

## Decision gates

The four questions this series could not answer for itself. **All four are now decided**
(maintainer, 2026-08-08). Each is recorded against the PR it gates: decisions **1 and 2 gate
PR-C2**, decision **3 gates PR-C3**, decision **4 gates PR-C4**. An implementation may not
re-open a gate it is downstream of, and may not pre-empt one it is upstream of.

| # | Gates | Question | **Decision** |
|---|---|---|---|
| 1 | **PR-C2** | Does a CVV-only match remain citable? | **Valid as an internal merchant fact; not issuer-citable.** It cannot satisfy an AVS/address claim, CE chart Item 3, or any related claim guard. Enforced structurally in the predicate, not by prompt wording |
| 2 | **PR-C2** | Does the split change the merchant-visible completeness denominator? | **No.** PR-C2 retains **one grouped payment-verification requirement**, with AVS and CVV as separate **subfacts**. Denominator unchanged, thresholds unchanged |
| 3 | **PR-C3** | Does the CE Item 3 citation path narrow to the primary-sourced codes? | **Yes — only `Y` / `M` may enter the CE Item 3 citation path.** Broader normalized results may be **displayed internally** but never cited |
| 4 | **PR-C4** | What does the retired `billing_address_match` name for the merchant? | **Preserve "billing and shipping city/country agree" as an explicitly non-evidence operational note under a NEW label.** The misleading `billing_match` **evidence** label is retired, not repurposed |

Consequences already folded into the sections above: decision 1 gives PR-C2 a real, conservative
bank-visible delta (withdrawn CVV-only citations) that **must be measured and enumerated** — the
PR may not claim "no bank-visible effect"; decision 3 gives PR-C3 an enumerated citation-set
narrowing; decision 4 makes the ×6 locale change a new key plus a retirement, not a rename.
