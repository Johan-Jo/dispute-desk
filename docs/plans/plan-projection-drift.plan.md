# Plan-projection drift — the merchant tabs do not read the plan

**Status:** proposed (revised 2026-09-22) · **Date:** 2026-09-21 · **Owner:** unassigned
**Verified against:** `develop` @ `7721a04b` — all five key files byte-identical to that commit in this working tree.
**Trigger:** blume-box dispute `4576ee51-53ec-4ed2-8c66-65b04bb31d72` — the
Overview and Evidence tabs claim "Used as positive bank argument · 3" and
list *IP & location consistency* as "Cited in the PDF as decisive proof".
The PDF's Evidence Basis lists one row. The IP fact was never in the letter.

---

## 1. Verdict

**The single source of truth works. Nothing downstream reads it.**

`CaseArgumentPlan` got this case right. On the live pack
(`1ae01792-8f46-45d6-a3eb-61470ce6bbbe`, prod, 2026-09-21 11:52 UTC):

```
ip_location_check   EXCLUDED   not_argument_relevant
```

The PDF is a projection of the plan, so the PDF is also right. The three
merchant tabs are not projections of anything — they re-derive their own
answer from `checklist + payload`, and that answer disagrees.

This is **not** a bug in `deriveArgumentPlan`, in the reason-code modules,
or in the `ip_location` exclusion. Those are all correct and must not be
changed. The defect is a missing wire plus four independent re-derivations
that the migration did not delete.

### 1.1 The invariant — three distinct authorities, not one

*(Revised 2026-09-22. The first draft's invariant — "no plan-excluded field
appears positive" — is necessary but insufficient: it passes a row that is
plan-included yet never reached the document, which is the same lie in the
other direction.)*

Every **affirmative merchant claim** must be backed by the authority that
actually licenses it. Three different claims, three different sources:

| Merchant-facing claim | Authority required | Wrong source to use |
|---|---|---|
| **"Authorised for this argument"** | membership of a **record** in `plan.included` | field-level category / `bankEligible` |
| **"Included in the letter"** | a **complete, verified document provenance map** for that package version (§1.2) | argument authorisation, eligibility, or `facts_json` |
| "Submitted to Shopify" | submission evidence for **that same package version** | the evidence pack's `saved_to_shopify_at` |

**The first row's wording is load-bearing.** `plan.included` licenses
*"authorised for this argument"* and nothing stronger. It does **not**
license "used as", "used as positive bank argument", or any past-tense
statement of actual use — those require document provenance, which the plan
does not carry. The current UI string "Used as positive bank argument" is
therefore wrong on its face even for a plan-included record, because
authorisation precedes composition and composition can still drop it.

**"Decisive proof" is a separate claim and is not in scope.** The current
string "Cited in the PDF as decisive proof" bundles two assertions:
*inclusion* (provenance) and *strength* (decisiveness). This plan replaces
it with the neutral **"Included in the letter"**. A strength claim may only
be reintroduced with its own justification and its own authority — the
fact's `strength`/category is about evidential quality, not about whether
the letter leaned on it. Do not smuggle the old adjective back in.

Three rules follow, and they are the acceptance criteria for this work:

1. **Authorisation ≠ document inclusion ≠ submission.** A record may be
   authorised yet absent from the document (plan-included, then dropped in
   composition or filtered by `bankIncludedFacts`), or included in v3's
   document while v4 is a draft — and where the map is missing or
   incomplete, **neither** can be asserted (§3.5). Each claim is checked against its own
   source, for a **named package version**.
2. **Never infer inclusion from eligibility.** "This fact is the kind of
   fact an issuer may see" does not license "it is in the letter". This is
   the `?? bankEligibleField` fallback in §3.5 and it is the direct cause
   of the trigger screenshot. Equally, **never infer inclusion from
   authorisation** — that is the same error one layer later.
3. **Never require equal counts.** `plan.included` (records),
   `facts_json` (aggregated bank-eligible facts) and PDF sections have
   legitimately different cardinalities — 8 / 1 / 1 on the trigger pack.
   Assertions are **set-membership and provenance**, never `length`
   equality. A count-equality test would fail on correct packs and would
   pressure someone into "fixing" the letter to match the UI.

### 1.2 Document provenance — the concrete mapping

*(Added 2026-09-22, replacing the hand-wave "`facts_json` ∩ composed
blocks", which is **not** a definition and, read literally, undercounts.)*

A record is **included in the letter** for package version *V* iff it is
represented in at least one rendered surface of *V*'s document. There are
**five** such surfaces, and narrative citation IDs cover only one:

| # | Surface | Derived from | Record attribution |
|---|---|---|---|
| 1 | **Evidence Basis table** | `buildEvidenceBasisRows(facts)` (`evidenceBasisRows.ts:360`) | **Direct** — one row per fact. Takes the whole fact list, so a fact appears here having been cited in no prose at all. |
| 2 | **Narrative blocks** | LLM sections surviving `projectFromPlan` | **Direct** — per-section citation IDs. The only surface that carries them. |
| 3 | **Deterministic theses** | `renderThesis` (`pdf/renderThesis.ts:104`) | **Traceable** — from the approved facts the thesis is built over. |
| 4 | **Chronology** | `buildChronologyEvents(meta, approvedFacts)` (`chronology.ts:259`) | **Mixed** — rich-timeline path draws on `context.timelineEvents`; the fact path is attributable. Trace where possible, else `unknown`. |
| 5 | **Case Details + deterministic fallback paragraphs** | `buildCaseDetailsRows` (`render/caseDetails.ts:108`); `composePdfBlocks` fallbacks (`:95-107`) | **Traceable via claim authority** — see below. |

**Therefore: do not treat narrative citation IDs as the complete inventory
of rendered evidence.** Doing so misreports surface 1 (a fact in the
Evidence Basis but cited in no prose would be labelled "not included") and
describes surfaces 3-5 not at all.

**Deterministic prose IS backed by evidence on the canonical route.**
*(Corrected 2026-09-22 — the previous text asserted the fulfilment fallback
renders "with no approved fact behind it". That describes the **pre-F6
defect**, which was fixed, not current behaviour.)* `projectPackageFromPlan`
passes `fulfillmentClaimAuthority: hasFulfillmentClaimAuthority(composeFrom)`
into the composer (`projectFromPlan.ts:251`), and `composeFrom` is the
plan-included ∩ bank-included fact list (`:238`). That authority derives from
approved order facts whose own `fulfillmentStatus` is FULFILLED, or a held
`delivery_occurred` capability (`fulfillmentClaimAuthority.ts`). **Missing
explicit citation IDs does not mean missing supporting evidence.**

**Rule: trace the supporting records where possible; otherwise report
attribution as `unknown`.** For a surface whose authority derives from an
identifiable fact set, the producer records those `recordId`s as supporting
that surface. Where a surface genuinely cannot be traced to records (e.g.
the chronology's rich-timeline path, which draws on `timelineEvents` rather
than facts), attribution is **`unknown`** — never silently "no record", and
never a licence to assert inclusion.

**Required mapping.** The producer emits, per package version, an explicit
`recordId → rendered surface(s)` map covering all five, plus a per-surface
`attribution: direct | traced | unknown`, persisted with the package (see
P1b) rather than recomputed by the reader. Consumers read that map; they
never re-derive provenance from `facts_json` and never infer it from the
narrative alone.

---

## 2. Measured scope (prod, 2026-09-21)

All figures from `--linked` against `aokhplydttxtebvbeuzc` (prod), guard
confirmed per command. Queries retained in `scripts/sql/` (§9).

| Metric | Value |
|---|---|
| Packs carrying a plan | **172** |
| Disputes with ≥1 `not_argument_relevant` exclusion | **171** |
| Disputes where the plan excluded `ip_location_check` | **111** |
| …of those, payload is `bankEligible` → UI shows it as a positive bank argument | **111 / 111** |
| Plan-excluded fields the evidence model still marks **citable** | **919 rows / 171 disputes** |
| Affected packs already **submitted to Shopify** | **4** |
| Affected packs at `status='final'` | 0 |

**171 of 172 measured plan-bearing packs are affected.** That is the
population this plan measured — the latest `defence_packages` row per
dispute **where `plan_json IS NOT NULL`**. It is *not* a claim about every
pack in production: packs generated before the plan existed carry
`plan_json = null` and were out of scope.

**Population is defined by the data, not by the flag** (D7a). Fleet-wide,
**252** `defence_packages` rows carry a persisted plan (earliest
2026-08-14) against 525 without. A package's plan does not disappear when
`CANONICAL_PIPELINE` is off — only this reader's view of it does. Within the
measured population the drift is effectively universal, which is enough to
act on.

### Per-module breakdown of the `ip_location_check` exclusion

| Reason module | Disputes | same_city | same_country |
|---|---|---|---|
| `inr_product_not_received` | 44 | 8 | 36 |
| `product_unacceptable` | 31 | 9 | 22 |
| `generic_fallback` | 28 | 12 | 16 |
| `credit_not_processed` | 7 | 0 | 7 |
| `duplicate_processing` | 1 | 0 | 1 |

Other fields excluded by the plan but still surfaced: `customer_account_info`
(83 disputes), `cancellation_policy` / `refund_policy` / `shipping_policy`
(~106 across modules), `activity_log` (83), plus `delivery_proof` and
`shipping_tracking` under `credit_not_processed` (6 each — note these are
*critical* categories elsewhere, so the mislabel is not always harmless).

### A second, independent gap — the 8 → 1 shortfall

*(Corrected 2026-09-22. The first draft said section dropping made the
shortfall legitimate. That is **wrong** and the correction matters, because
the wrong explanation would have licensed the very claim this plan exists to
stop.)*

`facts_json` carries **fewer** rows than `plan.included` on **127 of 172**
packs (avg 5.8 vs 9.8). On the trigger dispute it is 1 vs 8.

**Verified mechanism** (`buildDefencePackageJob.ts:487-489`, `:733`) — two
sequential filters, then persistence:

```ts
planFacts = bankIncludedFacts(
  selectPlanFacts(activePlan.plan, activePlan.factsByRecordId).includedFacts,
);
…
facts_json: planFacts
```

Section dropping happens **after** this and does **not** reduce the
persisted list. So the shortfall has exactly two possible origins, and they
are not interchangeable:

| Origin | Meaning | Detection |
|---|---|---|
| **A — missing record→fact mapping** | the plan authorised a record for which no fact was supplied | `selectPlanFacts(...).missingRecordIds` nonempty ⇒ `plan_fact_mismatch`, package **non-fileable** (`documentValidation.ts:119`) |
| **B — bank-inclusion filter** | the fact existed and was authorised, but `bankIncludedFacts` judged it not issuer-showable | expected and benign; the plan and the classifier answer different questions (see the F1/F3/F6 comment) |

Because A makes a package non-fileable, a **fileable** pack's shortfall
should be entirely B. That is a testable prediction, not an assumption, and
it is exactly what §10 requires be checked. **Do not assume all 127 are
defects; do not assume they are harmless.**

**What this changes for THIS fix:** nothing about the 127 is in scope, but
the invariant must not read `facts_json`'s shortfall as licence to claim the
missing evidence was cited. A plan-included record whose fact is absent from
`facts_json` is **authorised and uncited** — §1.1's second row — and must be
labelled as such.

### Severity

Merchant-facing. On the trigger pack the letter is correct and the tab is
false: a merchant reading "Cited in the PDF as decisive proof" for an absent
fact will stop collecting evidence that would actually help — and on the 6
`credit_not_processed` disputes the mislabelled field is `delivery_proof`,
a `criticalCategory`.

**What this plan does NOT claim:** that no issuer ever saw an unsupported
claim. That is a statement about every letter ever filed and nothing here
measured it. What *is* verified is the structural guard:
`documentValidation.ts:116-119` raises `orphaned_claim` for a section citing
an unauthorised record and `plan_fact_mismatch` for nonempty
`missingRecordIds`, and a failure makes the package non-fileable rather than
downgrading to a warning. That is good evidence the issuer-facing path is
defended **on the canonical route**; it is not a survey of filed letters.
Verifying the stronger statement is listed in §10 as an open item.

---

## 3. Root cause — four re-derivations, one wire

### 3.1 The missing wire

`app/api/disputes/[id]/workspace/route.ts:~915` computes `canonicalPlan` and
passes it to `buildWorkspaceAssessment` (line ~932). Eighty lines later
(line ~1020) it calls `deriveEvidenceLineItems` — **without the plan**:

```ts
const canonicalPlan = canonicalPipelineEnabled() && … ? plan_json : null;

const workspaceAssessment = buildWorkspaceAssessment({ …, plan: canonicalPlan });

const evidenceLineItems = deriveEvidenceLineItems({
  checklist, facts, payloadByField, contributions,
  packSavedToShopify, excludedFields, attachmentUploadFailures,
  inclusionOverrides, reasonFamily, internalSignalsByField, overrideHistoryByField,
  // ← no plan
});
```

The plan reaches the assessment. It stops before the line items.

### 3.2 Four surfaces that answer "is this fact in the letter?" independently

| # | Module | Inputs | Plan-aware? |
|---|---|---|---|
| 1 | `lib/argument/evidenceLineItem.ts` — `usedAsPositiveBankEvidence` | checklist + payload | **no** (0 refs) |
| 2 | `lib/defence/factClassifier.ts` — `isFieldBankEligible(fieldKey, payload)` | fieldKey + payload | **no** |
| 3 | `lib/argument/caseStrength.ts` — `computeContributions` | checklist + payload + `reason` | **no** |
| 4 | `lib/evidence/model/definitions.ts` — `citation.eligibility` / `citableIds` | seeded from `factClassifier` R4 | **no** |

Verified by `grep -c "CaseArgumentPlan\|plan_json\|allowedFactCategories"`:
all four return **0**.

Each is structurally incapable of knowing the fact was excluded.
`isFieldBankEligible` takes `(fieldKey, payload)` — there is no parameter
through which the reason module could reach it. The category says the fact
is *good*; only the plan knows it is *irrelevant to this argument*. The four
surfaces all answer the first question and none asks the second.

### 3.3 Why the evidence model disagrees too

`lib/evidence/model/definitions.ts` seeds citation policy from
`factClassifier` (rule R4) and relevance from `REASON_TEMPLATES_V2` (R3) —
a **different source** from the plan's `allowedFactCategories`. Hence the
live record:

```json
"relevance": "not_applicable",
"citation": { "eligibility": "eligible" },
"citableIds": ["ip_location_check#0"]
```

It calls the fact *not applicable* and *eligible to cite* in the same
object. `no_return_initiated` — which the plan **included** and which the
PDF's Evidence Basis **does** carry — is also `"relevance":
"not_applicable"`. So the model's relevance axis is uncorrelated with the
plan's disposition; `REASON_TEMPLATES_V2` and `allowedFactCategories` are
two independent spellings of argument relevance.

**This is a consumer problem, not a model defect.** *(Clarified
2026-09-22.)* `citation.eligibility: "eligible"` is a correct statement of
*general* bank eligibility and is **not** wrong here — see P4. The error is
that merchant surfaces read `citableIds` as if it answered "is this in
**this** package's argument", which it never claimed to. The fix is to stop
asking the model that question, not to change its answer.

### 3.4 Why a week of work did not catch it

`lib/pipeline/contracts/argumentPlan.ts` states the rule:

> Nothing downstream of the plan may decide whether a fact belongs in the
> letter. […] If a consumer needs a fact that is not in `included`, the
> answer is to fix the plan, never to add a second predicate.

The migration enforced this on the **package** side — `projectFromPlan`,
`documentValidation`, `selectFileablePackage`, the PDF — and left the
**merchant-surface** side on the legacy path. The route comment at
`workspace/route.ts:~1047` shows the sweep catching a sibling:

> This was the fourth inline spelling of the bank-inclusion rule, and the
> last one outside its owner.

True of `factsInPdf`. Not true of `usedAsPositiveBankEvidence`, thirty
lines above it in the same function, which kept computing its own answer.
The audit fixed the list next to the defect and did not enumerate every
render site — cf. `[[feedback_audit_all_render_sites]]`.

**And no test would have caught it.** `deriveArgumentPlan.test.ts` (25) +
`planForCaseIsAnAdapter.test.ts` (15) + `evidenceLineItem.test.ts` (43) +
`projectFromPlan.test.ts` (13) = **96 tests, all green**, on a defect
affecting 171 of 172 packs. No test file in the repo imports both
`deriveEvidenceLineItems` and the plan. Every surface is tested in
isolation against its *own* inputs, so each is self-consistent and the
set is incoherent. The invariant "the tabs and the letter agree" is not
expressed anywhere in the suite.

### 3.5 The false-citation fallback — eligibility standing in for inclusion

*(Added 2026-09-22.)* Beyond the missing wire, `evidenceLineItem.ts` contains
a second, independent defect that the wire alone does **not** fix.

`resolveSubmissionMethod` (`:1090-1098`) admits `bank_argument` via branch
(b) — *"the categorizer's own category is strong/moderate — the signal
stands on its own even before the LLM narrative is generated"* — i.e. **with
no approved fact at all**. The positive flag then reads (`:1524-1527`):

```ts
const usedAsPositiveBankEvidence =
  includedInBankArgument &&
  (strengthContribution === "strong" || strengthContribution === "moderate") &&
  (lookup?.includeInBankNarrative ?? bankEligibleField);
```

The `??` is the bug. When no fact exists, `lookup` is `undefined` and the
expression falls back to `bankEligibleField` — **eligibility substituting for
actual inclusion**. A row with no fact, no narrative and no document
therefore renders as "Used as positive bank argument / Cited in the PDF as
decisive proof".

Branch (b) is deliberate and was the right call for the draft state it was
written for (blume-box 306080eb: a Strong AVS row reading "context, not
decisive proof"). **The error is not the branch, it is the copy** — a
pre-generation row is being described in past-tense document language.

**Required distinction (P2 must implement both labels):**

| Provenance state | Permitted statement |
|---|---|
| **No package generated yet** | *"Eligible for this argument"* — a statement about the record, making no prediction about a document that does not exist |
| **Complete, verified map CONTAINS the record** | *"Included in the letter"* |
| **Complete, verified map EXCLUDES the record** | *"Authorised but not included in this document"* |
| **Map missing, unreadable, or incomplete** | *"Cannot be determined"* — never a negative claim either |

**"Absent from the map" is only a negative when the map is complete and
verified.** *(Corrected 2026-09-22 — the earlier "absent document
provenance ⇒ authorised but not included" turned an unknown into a
confident negative, which is the same defect as turning eligibility into a
confident positive.)* A missing, partial or unreadable map licenses
**neither** direction: the honest answer is *"cannot be determined"*.
Completeness is a property the producer asserts (P1b) — a reader may never
infer it from the map merely being present.

Two wordings are **banned** for a generated package:

- *"expected to be used"* — a prediction about a document that already
  exists and already settled the question. For a generated package the
  answer is knowable; predicting it is a way of avoiding looking.
- *"not yet cited"* — "yet" implies a pending future inclusion. Once the
  package is generated, a record absent from its document is not *pending*;
  it is **absent from that version**. A later version is a different package
  making its own claim.

With a valid plan present, the `??` fallback must not apply. The answer
comes from the table above: *"included"* only on a complete verified map
containing the record; *"authorised but not included"* only on a complete
verified map excluding it; otherwise *"cannot be determined"*.

**Consequence for the trigger dispute:** the first draft asserted the count
"drops 3 → 2". **Withdrawn.** That pack predates P1b, so it carries no
provenance map: every inclusion claim on it resolves to *"cannot be
determined"* until U11 settles whether historical provenance is
reconstructible. The honest post-fix state is an authorisation count plus an
undetermined inclusion count — **not** a smaller positive number. The number
is an *output* of P1/P1b/P2, not an input; P2's exit criterion is per-row
provenance state, not a target count.

### 3.6 Package identity — three claims, three different rows

*(Added 2026-09-22.)* The workspace route resolves **two different**
`defence_packages` rows (`:692-711`) and takes the submission flag from a
**third** object:

- `defencePackageLatest` — `order by version desc limit 1`, **any status**.
  Supplies both `factsJson` (`:718-719`) and `canonicalPlan` (`:918-920`).
- `defencePackageBankFacing` — `status = 'submitted'`.
- `packSavedToShopify` — `!!packRow.saved_to_shopify_at` (`:1026`), from the
  **evidence pack**, not from either package row.

Measured in prod (2026-09-22): of 237 packs with a latest package and 99
with a submitted one, **28** have `latest ≠ submitted`, and **8** are flagged
saved with no submitted package row at all.

So on ≥28 packs the tabs describe a **draft** (latest) while the submission
badge reflects a **different, older** version — and "Submitted to Shopify"
is currently derived from neither. Each claim in §1.1 must name its package
version explicitly; a row's "cited" claim must resolve against the package
that actually produced the document being described.

---

## 4. Design decisions (settle before coding)

**D1 — The plan is the authority; the tabs project it.** Not "make
`bankEligible` reason-code-aware". That would add a *fifth* independent
spelling of the rule, which is precisely what the contract forbids.
`deriveEvidenceLineItems` gains a `plan` input and *reads* the disposition.

**D2 — A plan-excluded fact stays visible to the merchant, correctly
labelled.** It is not deleted from the tab. `not_argument_relevant` is
merchant-meaningful — "we hold this, it does not help *this* claim". It
moves out of the positive bucket and gains an honest reason. Deleting the
row would recreate the failure the contract names: *"a fact excluded
silently is indistinguishable from a fact that was never collected"*.

**D3 — `ip_location` stays excluded. The reason modules do not change.**
The exclusion is correct and deliberate (`alwaysAdmissible.ts:26-28`). This
plan changes what we *say*, never what we *file*. No `avoid` list, no
`allowedFactCategories`, no module is edited. **Any diff touching
`lib/defence/reasonCodes/**` is out of scope and must be rejected in review.**

**D4 — Display contributions and the persisted score are DIFFERENT things.
Only the display side is in scope.**

*(Rewritten 2026-09-22. The first draft claimed these facts "inflate case
strength" and that "strength gates auto-save". Verified against the code,
that was **wrong**.)*

- `buildWorkspaceAssessment` takes strength from **`snapshot.strength`**,
  never a fresh score (`workspaceAssessment.ts:136-138`), and labels
  `contributions` **"DISPLAY ONLY. Labels, not a band"** (`:176`).
- The real scoring path is `buildPack.ts` → `buildCaseAssessmentSnapshot`
  → `deriveCaseAssessment` → `calculateCaseStrength`
  (`lib/evidence/model/assessment.ts:205,231` — *"The ONE place
  `calculateCaseStrength` is called from"*), with
  `deriveCaseAutomationDecision` reading `assessment.strength.overall`
  (`:242`).
- `checklistFromModel` skips `relevance === "not_applicable"` before scoring
  (`assessment.ts:135`, `:180`). On the trigger pack `ip_location_check`
  carries that relevance.

**What follows — and what does not.** A falsely-positive UI row does **not**
establish that the persisted score includes the field: the two paths are
distinct, so the UI is not evidence about the score either way.

**It does not follow that the scoring impact is zero.** The `not_applicable`
skip is a statement about *one* axis on *one* pack, and plan exclusion and
model relevance are independent (§3.3 — they are uncorrelated). A
plan-excluded record whose relevance is **not** `not_applicable` would be
scored today. Whether such records exist, and how many, is **unmeasured** —
that is U4, and P3a exists to answer it. **No prediction of zero impact is
made here.**

Consequence: correcting `computeContributions` is a display fix
(P3b-i) that stands on its own. Any actual scoring-policy change is a
separate decision (P3b-ii) resting on P3a's measurement, not on an argument
from the `not_applicable` skip.

**D5 — Scope is NOT read-path-only, and history is NOT free.**
*(Corrected 2026-09-22 — the earlier "fixes history at no cost" assumed a
pure read-path change. Introducing a persisted provenance map (§1.2, P1b)
makes this a producer + persistence + read-path change.)*

- **Authorisation** claims are read-path only: `plan_json` already exists on
  252 packages, so correcting how it is read does fix those for free.
- **Inclusion** claims are not: existing packages carry **no provenance
  map**, because nothing has written one yet. They render *"cannot be
  determined"* until historical provenance is verified (U11) — which is the
  honest state, not a regression.

**`facts_json` is not a substitute for the map.** It is the package's own
immutable bank-eligible fact list — a *different source*, answering "what
was authorised and issuer-showable", not "what the rendered document
attributed to which record". Nor may the map be reconstructed from today's
live evidence: that is a different source again, and using it would
manufacture a confident claim about a historical document (P1).

**No claim is made that submitted letters were correct.** *(Corrected
2026-09-22.)* This plan measured the merchant-facing projection, not the
content of filed documents. What is verified is narrower: the canonical
route runs a deterministic validator that makes `orphaned_claim` /
`plan_fact_mismatch` non-fileable (`documentValidation.ts:116-119`). That is
a structural guard on that route — not a survey of what was filed, and it
says nothing about legacy-route packages. Whether any filed letter violates
today's checks is **U7**, open.

Note this cuts both ways: because no such claim is made, **no resubmission
decision is implied either**. If U7 surfaces violations, remediation is its
own decision with its own approval.

**This promise holds only while the change stays display-side.** If P3b ever
alters real scoring, it does not hold: `calculateCaseStrength` feeds a
**persisted snapshot** guarded by `inputHash` + `policyVersion`. Changing
scoring policy means bumping `ASSESSMENT_POLICY_VERSION`, which marks every
stored snapshot stale and forces rebuilds — with automation re-deciding on
the new numbers. That is a fleet-wide rebuild, not a backfill-free change,
and it must be costed before it is chosen.

**D6 — Sequence the SCOPE-EXPANDING work behind the measurement; do not
gate the repair on it.** *(Corrected 2026-09-22 — the first version made the
display fix wait on the scoring investigation.)*

- **P0-P2 and P3b-i (display) do not depend on P3a.** They correct what the
  merchant is told, using authorities that already exist. Holding an honest
  label hostage to an unrelated scoring question would leave a known-false
  claim on screen for no benefit.
- **Only P3b-ii (actual scoring policy) waits on P3a**, because only it
  changes numbers.

The two tracks share no code path: P3b-i filters display rows, P3b-ii would
change `calculateCaseStrength` inputs. Landing P3b-i first is also what
makes P3b-ii measurable in isolation.

**D7 — Distinguish read-failure from staleness, and current claims from
historical ones.** *(Rewritten 2026-09-22 — the first version conflated
"stale" with "untrustworthy" and treated a disabled flag as proof that no
plan exists. Both are wrong.)*

**D7a — A disabled flag is not evidence of absence.** `plan == null` in the
route means *"this reader did not load a plan"*, never *"no plan was ever
derived"*. `canonicalPipelineEnabled()` is read **per call** and is
deployment-scoped (`activation.ts:89-91`), so flipping it off makes
`canonicalPlan` null for packs whose plan is still sitting in `plan_json`.
Measured: **252** prod `defence_packages` rows carry a persisted plan
(earliest 2026-08-14). Treating those as "legacy" would restore exactly the
affirmative legacy claims this plan removes, on packs that *have* an
authority to read. Legacy means **`plan_json IS NULL` on the package row**,
which is a fact about the data, not about this process's env.

**D7b — Staleness is about *current* evidence; it does not retract
*historical* facts.** A package goes stale when today's evidence no longer
hashes to what it was generated against. That says nothing about what its
PDF contained or whether it was submitted — those are settled, package-bound
facts. So staleness must **not** blank them:

| Claim | Scope | Effect of stale `inputHash` |
|---|---|---|
| "Included in the letter (v3)" | **package-bound, historical** | **Preserved** — v3's document is what it is |
| "Submitted to Shopify (v3)" | **package-bound, historical** | **Preserved** — submission already happened |
| "Authorised for this argument" | **current** — derived from the live plan | **Withheld** — the authority is stale |
| readiness / strength / next action | **current** | **Withheld** — `needsRecalculation` |

Blanking a verified historical statement because *other* evidence moved
would be its own dishonesty, and would train merchants to distrust the
audit trail precisely when they need it.

**D7c — Read failure is SOURCE-SPECIFIC.** *(Corrected 2026-09-22 — the
earlier "withholds everything" over-reached.)* An unreadable **plan**
invalidates claims that depend on the plan; it does **not** invalidate
independently stored evidence:

| Unreadable source | Withheld | Still permitted |
|---|---|---|
| **Plan** (malformed / unsupported `planVersion`) | *"Authorised for this argument"* — the authority cannot be read | *"Included in the letter"* from a verified provenance map; *"Submitted"* from a submission receipt — **neither depends on the plan** |
| **Provenance map** | *"Included in the letter"* **and** *"not included"* — §3.5 | authorisation from a readable plan; submission from a receipt |
| **Submission record** | *"Submitted to Shopify"* | authorisation and inclusion |

Each of the five P1 inputs carries its own read state and gates only its own
claim. Collapsing them into one "everything is unknown" is as wrong as
collapsing them into one confident answer — it discards verified facts
because a *different* source failed to parse.

Parse failure must be explicit and asserted, never a silent `catch → null`,
because a swallowed parse error is indistinguishable from genuine legacy and
lands back in D7a.

---

## 5. Work plan

### P0 — Lock the invariant in a failing regression *(do this first)*

Write the regression, prove it red on `develop`, then land it **enabled
together with the P1/P2 fix in the same PR**.

**No committed `.skip`.** *(Corrected 2026-09-22 — the first draft proposed
committing it skipped, which is a disabled test masquerading as a guard; a
skipped test is indistinguishable from a deleted one in CI.)* Red locally,
green-by-fix in the PR, and the PR description shows the red run.

- `tests/unit/planProjectionAgreement.test.ts`
- Fixture: the real blume-box INR case (plan excludes `ip_location_check`,
  payload `same_country` + `bankEligible: true`).
- Assertions, per §1.1 — **set-membership and provenance, never counts**:
  1. no row claims *authorised for this argument* whose **record** is
     absent from `plan.included`;
  2. no row claims *included in the letter* except from a **complete,
     verified** provenance map containing the record, for the named package
     version — and no row claims *not included* from a missing or
     incomplete map (§3.5);
  3. no row claims *submitted* without submission evidence for that same
     version;
  4. no row renders an affirmative claim while any required input is
     `unknown` (P1 read-states).

**Exit:** the test fails on `develop` for the stated reason; the failure
output is quoted in the PR.

### P1 — Project the plan at RECORD level

*(Rewritten 2026-09-22. The first draft's `excludedByField` map is **unsafe**
and must not be built.)*

`deriveArgumentPlan.test.ts:180-189` — *"matches a review item by recordId,
never by fieldKey — multi-record fields"* — includes `delivery_proof#parcel-b`
while excluding `delivery_proof#parcel-a`. **Both share one `fieldKey`.** A
field-level veto would suppress the included parcel; a field-level pass would
resurrect the excluded one. Either way the plan's decision is destroyed.

Required shape — two explicit steps, never collapsed:

1. **Record-level disposition.** Resolve each record id against
   `plan.included` / `plan.excluded`. This is the authority
   (`includedRecordIds` / `excludedRecordIds` already exist in
   `lib/argument/plan`).
2. **Explicit field/row aggregation.** Aggregate record dispositions up to
   the rendered row with a **stated rule** — e.g. a field is positive only
   if ≥1 of its records is included *and* that record is the one the row
   represents. Mixed included/excluded under one field is a first-class
   case with its own test, not an accident of `Map` collision.

**With a valid plan present, a record absent from `plan.included` must not
inherit positive authorisation from any legacy predicate** — not
`bankEligible`, not `naturalCategory`, not `contributesStrongOrModerate`.
The plan is the authority; the legacy predicates are not a fallback.

#### P1 data contract — `plan?: … | null` is NOT sufficient

*(Added 2026-09-22.)* A nullable plan cannot support §1.1: it carries
authorisation only, has no package identity, no document provenance, no
submission provenance, and collapses four distinct read states into `null`.
The input must carry all five:

| Input | Source | Type / states |
|---|---|---|
| **Record identity** | `plan.included[].recordId` / `excluded[].recordId`, matched to each checklist row's record(s) | `recordId: string` per record — **never** keyed by `fieldKey` alone (P1 body) |
| **Package identity** | `defence_packages.id` + `.version` + `.status` of the row the claims describe (§3.6) | `{ packageId, version, status }` — explicit, not implied by "latest" |
| **Document provenance** | the persisted `recordId → surface[]` map of §1.2, written by the producer | `Map<recordId, DocumentSurface[]>` where surface ∈ `evidence_basis` \| `narrative` \| `deterministic_section` |
| **Submission provenance** | that package version's own submission record (`submitted_at` / `shopify_response`), **not** the evidence pack's `saved_to_shopify_at` | `{ submittedAt, responseRef } \| null` |
| **Read state** | explicit, per source below | see the four states |

**Four read states — `unknown` is not `absent`.** Collapsing them is how a
missing input becomes a confident negative:

| State | Meaning | Rendering |
|---|---|---|
| `legacy_no_plan` | `plan_json IS NULL` on the package row (D7a) | legacy path, byte-identical |
| `present` | plan read and validated | project it |
| `unreadable` | malformed / unsupported `planVersion` (D7c) | **unknown** — no affirmative claim |
| `not_loaded` | this reader did not fetch it (flag off, query skipped) | **unknown** — *not* `legacy_no_plan` |

Each of the five inputs carries its own state. Document provenance can be
`unknown` while authorisation is `present` — that is exactly the historical
case below.

**Where historical provenance cannot be established, render the unknown
state.** Packages generated before the provenance map exists have no record
of what their PDF contained. The honest answer is *"cannot be determined"*.
**Do not reconstruct it** by re-deriving from today's `facts_json`, today's
evidence, or today's plan: that manufactures a confident claim about a
historical document from current inputs, which is this defect's own logic
re-applied. Backfilling provenance for old packages is a separate,
explicitly-scoped exercise (**U11**), not a fallback inside the reader.

- `DeriveEvidenceLineItemsInput` gains the five inputs above (not a bare
  nullable plan).
- Pass them at `workspace/route.ts:~1020`, with the package identity
  resolved per §3.6 rather than defaulting to `defencePackageLatest`.
- **`collapseDeliveryRows` must be audited in this PR.** It picks one
  survivor across `DELIVERY_FIELDS` by rank and rewrites `reason` /
  `reasonToken` / `displayLabelToken` (`evidenceLineItem.ts:1380-1424`).
  Delivery is precisely the multi-record field from the test above.
  Representative selection must not promote an excluded record, and the
  reason-replacement path (`useProofReason`) must not overwrite an
  exclusion reason with proof copy. If the survivor is excluded and a
  sibling is included, the rule for what renders must be written down and
  tested — not left to the existing rank sort.
- `legacy_no_plan` (**`plan_json IS NULL`**, not "flag off") ⇒ legacy path
  byte-identical. `not_loaded` / `unreadable` ⇒ unknown state (D7a, D7c).
  Stale ⇒ D7b: historical package-bound claims preserved, current claims
  withheld.

**Exit:** P0 green; `evidenceLineItem.test.ts` (43) still green; the
mixed-record and delivery-collapse cases covered; null-plan regression green.

### P1b — PRODUCER: persist the document provenance map

*(Added 2026-09-22. §1.2 requires a map nothing currently writes, so this is
a producer and persistence change, not a read-path one. It must land before
or with P1 — P1 consumes what this writes.)*

**Storage.** A new column on `defence_packages` (e.g.
`document_provenance_json`) rather than a nested key inside an existing blob,
so it can be queried, indexed and backfilled independently, and so its
absence is a plain `NULL` rather than an ambiguous missing key.

**Shape.** Per record, the surfaces it reached and how it was attributed:

```
{
  provenanceVersion: number,      // own version, NOT plan/policy version
  complete: boolean,              // producer's assertion (see below)
  records: { [recordId]: { surfaces: DocumentSurface[],
                           attribution: "direct" | "traced" | "unknown" }[] },
  unattributedSurfaces: DocumentSurface[]   // rendered, traceable to no record
}
```

`DocumentSurface` enumerates all five of §1.2 — `evidence_basis`,
`narrative`, `thesis`, `chronology`, `case_details_or_fallback`.

**`complete` is an assertion, never an inference.** The producer sets it
`true` only when every rendered surface was walked and attributed (or
explicitly recorded as `unattributedSurfaces`). A reader treats `complete:
false` — and a `NULL` column — as *"cannot be determined"* (§3.5). This is
the flag that stops "map present" being silently read as "map complete".

**Schema version.** `provenanceVersion` is independent of `PLAN_VERSION` and
`ASSESSMENT_POLICY_VERSION`: the map describes a rendered artifact, not a
policy, so it must not force snapshot staleness or rebuilds (D5, P3b-ii).

**Artifact identity — write only for the artifact actually produced.** The
map is written in the same transaction that persists the document it
describes, keyed to that `defence_packages.id` + `.version`, and only on
**successful** production. A failed, skipped or superseded generation writes
no map. Never write a map for a document that was not produced, and never
carry one forward to a new version — a new version re-renders and gets its
own.

**Existing packages.** No backfill in this step. They have `NULL` and render
*"cannot be determined"* for inclusion claims. Whether historical provenance
can be reconstructed at all is **U11**, and it is a separate exercise with
its own verification — not a fallback inside the reader.

**Exit:** the map is written for newly generated packages; a reader with a
`NULL` or `complete: false` map renders the unknown state; no existing
snapshot is invalidated.

### P2 — Honest merchant copy for `not_argument_relevant`

- Reason token per exclusion reason, all six locales
  (`[[feedback_translate_on_add]]`). Draft EN: *"Held on file. It does not
  support this specific claim type, so it is not cited in the letter."*
- Wire `merchantReasonToken` from the plan through to the row (the plan
  already carries it — `packs.argumentPlan.exclusion.notArgumentRelevant`).
- Bucket: out of *positive*, into a context/held bucket in
  `EvidenceUsedSection.tsx`.
- **Remove the `?? bankEligibleField` fallback on the plan-present path**
  (§3.5). The replacement branches on the **provenance state**, not on the
  presence of a fact: a missing or incomplete map yields *"cannot be
  determined"*, never a negative.
- **Four distinct labels**, per §3.5's table — no package yet / included /
  authorised-but-absent / cannot-be-determined. The banned wordings
  ("expected to be used", "not yet cited") must not appear for a generated
  package.
- Replace the strength-bundling string **"Cited in the PDF as decisive
  proof"** with the neutral **"Included in the letter"** (§1.1). Do not
  reintroduce a decisiveness adjective without its own authority.
- `npm run verify-i18n-parity`.

**Exit:** all six locales present; no English in `lib/`; **every remaining
positive/cited row on the trigger dispute is matched to actual document
evidence, row by row.**

*The first draft's "count drops 3 → 2" is **withdrawn** (§3.5): the honest
count is an output of this work, not a target. Do not assert 2 — assert
provenance per row and report whatever number results.*

### P3a — Measure the REAL assessment path *(measurement only)*

*(Rewritten 2026-09-22 — the first draft measured `computeContributions`,
which is display-only (D4) and therefore measures nothing about scoring.)*

Measurement must exercise the **actual** path, not the display helper:

`buildPack.ts` → `buildCaseAssessmentSnapshot` → `deriveCaseAssessment` →
`calculateCaseStrength` → `deriveCaseAutomationDecision`
(`assessment.strength.overall`).

Report, per open dispute:

1. `overall` band **with** the current `checklistFromModel` vs a
   plan-filtered checklist — establishing empirically whether the two ever
   differ. **No prediction is offered.** In particular, do not reason from
   "`not_applicable` is already skipped": plan exclusion and model relevance
   are independent (§3.3), so a plan-excluded record with any other
   relevance is scored today. The measurement must **enumerate** those
   records, not assume they are absent.
2. Any dispute where the bands differ — those are the candidates for a real
   scoring change.
3. The automation decision either way, explicitly including **early filing
   vs deadline hold** (`hold_for_deadline` / `park_for_review`), since a
   band move can change *when* we file, not just whether.

`[[feedback_canary_before_bulk]]` — read 2–3 cases in full before the sweep.

**Exit:** a table of band movements + automation-decision changes, plus the
enumeration from (1). **If the delta set is empty, P3b-ii is dropped and no
scoring change is made.** P3b-i is unaffected either way — it never waited
on this (D6).

### P3b — Display contributions (independent), and separately any policy question

Two clearly separated pieces:

**P3b-i (display, in scope, does NOT wait on P3a).** `ContributionInput`
gains the record-level plan input; plan-excluded records do not produce
display rows. This makes "What supports your case" agree with the tabs.

It touches `computeContributions` only, which `buildWorkspaceAssessment`
labels **"DISPLAY ONLY"** and which no scoring path reads — so it cannot
move a band **by construction**, not by prediction. Assert that structurally:
pin `snapshot.strength` byte-identical across the change. (This is a claim
about which code P3b-i edits, not a forecast about scoring — cf. D4, where
no zero-impact prediction is made.)

**P3b-ii (scoring policy, NOT in scope without explicit approval).** Only if
P3a shows real divergence. Then it is a policy change, and it carries:
`ASSESSMENT_POLICY_VERSION` bump → every persisted snapshot stale →
fleet-wide rebuild → automation re-decides. Specify freshness/policy-version
handling and rebuild cost **before** proposing it. D5's no-backfill promise
does not cover this.

### P4 — Reconcile the evidence model (919 rows)

*(Rewritten 2026-09-22. The first version required
`citation.eligibility` to become ineligible when the plan excludes a record.
That is **wrong** and is withdrawn — it conflates two different properties
and would feed plan decisions back into the model's own inputs.)*

**`citation.eligibility` and plan authorisation are different properties.**

- `citation.eligibility` — *general* bank eligibility: may an issuer see
  this kind of fact at all? A property of the record, stable across
  arguments.
- `plan.included` — *package-specific* argument authorisation: does this
  record belong in **this** argument, under **this** reason module?

A record can legitimately be **generally eligible** and **not authorised
here** — that is the IP fact's exact situation, and both statements are
true simultaneously. Overwriting the first with the second would destroy
the general property (it is the same record, eligible on the next dispute)
and, worse, would make the plan's output an **input** to the evidence model
that the plan itself reads — a feedback loop where the model can no longer
be re-derived independently and a bad plan becomes self-confirming.

**Therefore this repair does not change the evidence model at all.** It
**projects** two separate record sets at read time:

- `authorisedRecordIds` = `plan.included`
- `includedInDocumentRecordIds` = §1.2 document provenance

The model keeps `citation.eligibility`, `citableIds` and `relevance`
untouched. Consumers stop reading `citableIds` as a statement about *this*
package's argument, because it never was one.

**Registry and scoring redesign are moved OUT of this repair.** Reseeding
R3 from `allowedFactCategories`, reconciling the `relevance` axis, and
anything touching `DEFINITION_REGISTRY_VERSION` are a separate piece of
work, tracked under **U8**. That is not deferral for tidiness: `relevance`
gates **scoring** (`checklistFromModel` skips `not_applicable` before
`calculateCaseStrength` — `assessment.ts:135`, `:180`), so reseeding it is
a scoring-policy change wearing a registry diff's clothes and inherits every
constraint in D5/P3b-ii (`ASSESSMENT_POLICY_VERSION`, stale snapshots,
fleet-wide rebuilds). It must not ride along with a display repair.

**Scope of P4 as it now stands:** projection only — teach the merchant
surfaces to read the two sets above instead of `citableIds`. The 919
conflicting rows are then reported correctly **without** any model write.

### P5 — Make the class unfixable-again (CI invariant)

Per `[[feedback_fix_the_class_not_the_instance]]` — the wire alone is an
instance fix; without this, surface #5 reintroduces it.

**The static `allowedFactCategories` guard is SUPPLEMENTARY and would not
have caught this defect.** *(Corrected 2026-09-22.)* The four offending
consumers have **zero** references to that symbol — that is precisely why
they drifted. A grep-based guard detects a *future* consumer that names the
list; it is blind to one that re-derives the same answer from
`category`/`payload`, which is the actual failure mode. The **behavioural**
guard below is the primary defence; the static rule is a cheap extra.

- **Primary — end-to-end contract test (§6 Layer 0).** Spans package
  generation/persistence → workspace projection → rendered claim.
- Contract test: for a matrix of (reason module × field × payload) fixtures,
  assert every merchant-facing **package-specific authorisation** signal
  agrees with the plan. Enumerate modules from the registry so a new module
  fails until covered.

  **Not general bank eligibility.** *(Corrected 2026-09-22.)*
  `citation.eligibility` / `isFieldBankEligible` answer "may an issuer see
  this kind of fact at all" — a property that is *supposed* to differ from
  plan disposition (P4), and a record is routinely eligible-and-unauthorised.
  Asserting those agree would encode the conflation this plan removes and
  would fail on correct data.
- Lint/AST guard. The naive rule ("nothing outside `plan/**` and
  `package/**` may name `allowedFactCategories`") is **wrong** — a grep
  returns 14 legitimate files: the eight reason modules that *declare* the
  list, `registry.ts`, `types.ts`, `alwaysAdmissible.ts`,
  `narrativeWriter.ts` and two admin/prompt read-only surfaces. The guard
  must distinguish **declaring** from **consuming**:

  - *Allowed to declare:* `lib/defence/reasonCodes/**`, `lib/defence/types.ts`.
  - *Allowed to consume:* `lib/argument/plan/**`, `lib/defence/package/**`,
    `lib/defence/narrativeWriter.ts` (the issuer-facing writer, which
    legitimately receives the merged list).
  - *Read-only / display:* `lib/defence/admin-queries.ts`,
    `app/api/admin/defence-package/prompt-modules/route.ts`,
    `lib/defence/promptModuleGuidanceKeys.ts` — allow-listed explicitly,
    with a comment, so a new consumer cannot hide among them.
  - *Everything else — and specifically any file under `lib/argument/`
    other than `plan/**`, or any `app/(embedded)/**` file — fails.*

  Implement as an enumeration test over the file list (the cron-gate test
  is the pattern), with the allow-list written out so adding to it is a
  visible diff that a reviewer must approve.
- Update `docs/technical.md` in the same commit
  (`[[feedback_docs_update]]`).

---

## 6. Testing strategy

The user's requirement: *serious testing of every single code line that
treats this as part of the plan.* Isolated per-surface tests are what let
this ship — every surface was green against its own inputs.

**Layer 0 — End-to-end producer → document → render *(the decisive one)*.**
*(Revised 2026-09-22.)* One test spanning **package generation and
persistence → the produced document → workspace projection → the rendered
merchant claim**.

**Three stages, and the middle one is mandatory.** *(Comparing the UI against
the producer's own map would recreate the original failure in a new place:
map and UI agree while the PDF says something else — two self-consistent
surfaces and a false composition, exactly the 96-green-tests pattern.)*

1. **Document vs map.** Independently inspect the **generated document /
   rendered output** — walk its Evidence Basis rows, narrative blocks,
   theses, chronology and Case Details/fallback paragraphs — and verify that
   its actual record attribution **matches the persisted map**. The map is
   the thing under test here, not the oracle.
2. **Workspace vs map.** The projection reports exactly what the verified
   map says.
3. **Labels vs projection.** Merchant-facing strings match the permitted
   statement for each provenance state (§3.5).

A test that skips stage 1 does not demonstrate completion. **Completion is
demonstrated by the document, not by the existence of a canonical type, a
persisted map, or isolated green tests.**

Required cases (all of them, per the §1.1 authorities):

| # | Case | Asserts |
|---|---|---|
| 1 | Excluded IP with a bank-eligible payload | the trigger defect |
| 2 | Plan-**included** record absent from document provenance | "included" is not inferred from authorisation |
| 2b | Record in the **Evidence Basis** but cited in **no** narrative block | §1.2 — narrative IDs are not the whole inventory |
| 2c | **Deterministic fallback / thesis / chronology / Case Details** rendered | §1.2 surfaces 3-5 — attribution **traced** to the authorising records where derivable (`hasFulfillmentClaimAuthority`), `unknown` where not; never silently "no record" |
| 2d | Producer map **disagrees** with the rendered document | stage 1 — the map itself is under test |
| 2e | Map present but `complete: false` | "cannot be determined"; absence from an incomplete map is not a negative |
| 3 | Record absent from **both** plan sets | no disposition ⇒ no affirmative claim |
| 4 | Mixed included/excluded records under **one** field | record-level projection (P1) |
| 5 | Delivery-row collapse + exclusion copy | `collapseDeliveryRows` preserves disposition and reason |
| 6 | Latest **draft** vs older **submitted** version | package identity (§3.6, 28 prod packs) |
| 7 | Evidence changed after generation (stale `inputHash`) | **D7b** — historical "included/submitted (v3)" preserved; current authorisation withheld |
| 7b | Historical package with **no** provenance map (`NULL`) | unknown state; **not** reconstructed from `facts_json` or current evidence (D5, P1, U11) |
| 9c | Plan unreadable **but** provenance map and submission receipt valid | D7c — inclusion + submission still asserted; only authorisation withheld |
| 8 | **`plan_json IS NULL`** (genuine legacy) | byte-identical legacy behaviour |
| 9 | Malformed / unsupported `planVersion` (`unreadable`) | D7c — withhold, never fall back |
| 9b | Plan **exists** but flag off (`not_loaded`) | D7a — unknown state, **not** legacy |
| 10 | Actual assessment + automation effects | only if P3b-ii proceeds |

**Layer 1 — Agreement.** Plan vs each surface, same fixture. Matrix: every
reason module × each of its excluded categories × {bank-eligible payload,
negative payload, no payload}. Enumerated from the registry, so a new module
fails until covered.

**Layer 2 — Projection purity.** Assert the tabs *cannot* re-derive: a
fixture where plan and category disagree must follow the plan. Guards the
"never add a second predicate" rule behaviourally.

**Layer 3 — Legacy regression.** Every P1/P3b change: a package with
**`plan_json IS NULL`** ⇒ output byte-identical to today. Protects genuinely
pre-plan packages.

Note this is **not** the flag-off path: a plan-bearing package read with the
flag off is `not_loaded`, which must render the unknown state, not legacy
behaviour (D7a). Both cases need their own test — Layer 0 cases 8 and 9.

**Layer 4 — Replay against prod shapes.** Replay the 171 affected packs'
real `plan_json` + payloads through the new derivation. Assertions are
**record-level**, with the field/row aggregation stated explicitly (P1):

- no **record** absent from `plan.included` carries an affirmative
  authorisation claim;
- no **record** is reported as included in the letter except from a
  complete, verified provenance map containing it — and absence from a
  missing or incomplete map is reported as *"cannot be determined"*, never
  as *"not included"*;
- for each rendered **row**, the aggregation from its record dispositions
  matches P1's stated rule — including rows backed by several records,
  where a field-level assertion cannot distinguish a correct mixed row from
  an incorrect uniform one.

A field-level assertion would pass on the `delivery_proof#parcel-a/-b` case
while the rendering is wrong, which is why it is not used. Pattern exists:
`d1BillingMatchReplay.test.ts`.

**Layer 5 — Render sites.** `[[feedback_audit_all_render_sites]]`. The
complete set, enumerated from
`grep -rln "usedAsPositiveBankEvidence\|usedAsPositiveBankArgument"` over
`lib/ app/ components/` (11 files — not a from-memory list):

| File | Role |
|---|---|
| `lib/argument/evidenceLineItem.ts` | producer (P1) |
| `app/api/disputes/[id]/workspace/route.ts` | wire + `submissionSummary.counts` (P1) |
| `app/(embedded)/…/hooks/useDisputeWorkspace.ts` | client count |
| `app/(embedded)/…/tabs/OverviewTab.tsx` | the "3" badge |
| `app/(embedded)/…/tabs/useEvidenceSections.ts` | section assembly |
| `app/(embedded)/…/sections/EvidenceUsedSection.tsx` | bucketing (P2) |
| `app/(embedded)/…/sections/InclusionReviewSection.tsx` | inclusion review |
| `app/(embedded)/…/sections/SubmissionSummaryPanel.tsx` | summary panel |
| `app/(embedded)/…/sections/CardholderAcknowledgementCard.tsx` | `ccRow` gate |
| `app/(embedded)/…/workspace-components/types.ts` | type surface |
| `lib/demo/fixtures/workspaceData.ts` | **recomputes the counts independently** — drifts unless updated in the same commit |

`useEvidenceSections.ts` and `SubmissionSummaryPanel.tsx` were missing from
this list on the first pass and were caught only by running the grep. That
is the failure mode of this plan in miniature: enumerate from the tool,
never from recall.

Per CLAUDE.md #3: `npm test`, `npx tsc --noEmit`, and `npm run build`
(UI + routes touched).

---

## 7. What is explicitly NOT changing

- Reason-code modules (`avoid`, `allowedFactCategories`) — **D3**.
- The `ip_location` exclusion, or its absence from `alwaysAdmissible`.
- `deriveArgumentPlan` — it is correct.
- The PDF / Evidence Basis — already a faithful projection.
- Already-submitted packs — **not** revisited by this repair. No claim is
  made here about whether their letters were correct (**D5**); that question
  is **U7**, and any remediation is its own decision.
- **Issuer-facing policy, in any form.** No change may be made to what we
  file in order to make the UI agree with it. If the tab and the letter
  disagree, the tab is what changes. Stated explicitly because the cheapest
  way to make a count-equality test pass is to widen the letter, and that
  would convert a display bug into an evidentiary one.
- **Actual scoring policy** (P3b-ii) — out of scope absent P3a evidence and
  explicit approval.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| **Field-level veto destroys a multi-record plan decision** | P1 record-level projection; Layer 0 case 4; delivery-collapse audit |
| **Eligibility keeps standing in for citation** | §3.5; remove `?? bankEligibleField`; Layer 0 case 2 |
| **A malformed/not-loaded plan silently restores legacy claims** | D7a/D7c; Layer 0 cases 9 + 9b; parse failure explicit, never `catch → null` |
| **Staleness blanks verified historical claims** | D7b; Layer 0 case 7 — package-bound facts survive; only current claims withhold |
| **Provenance read from narrative IDs alone** | §1.2 (five surfaces); Layer 0 cases 2b + 2c |
| **Producer map and UI agree while the PDF differs** | Layer 0 **stage 1** — the document is inspected independently; case 2d |
| **Missing/incomplete map read as "not included"** | §3.5 state table; `complete` flag (P1b); Layer 0 case 2e |
| **Deterministic prose assumed unbacked** | §1.2 — `hasFulfillmentClaimAuthority` derives from plan-included facts; trace, don't assume (U10) |
| **`facts_json` used as a stand-in for the map** | D5 — different sources; Layer 0 case 7b |
| **Plan decisions fed back into the evidence model** | P4 — project two record sets; never write `citation.eligibility` |
| **"Cited" resolved against the wrong package version** | §3.6; Layer 0 case 6 (28 prod packs already diverge) |
| P3b-ii turns into a fleet-wide rebuild unnoticed | D5 qualified; policy-version + rebuild cost specified before proposing |
| Null-plan path regresses (flag off / old packs) | Layer 3 + Layer 0 case 8 |
| Deleting the row instead of relabelling | D2; merchant is owed the reason |
| Scope creep into reason modules | D3; reject any `reasonCodes/**` diff |
| Demo fixture drifts from real derivation | Layer 5 includes `demoFixtureContract` |
| Chasing count equality between records / facts / sections | §1.1 rule 3; assertions are set-membership only |

---

## 9. Reproduction

```bash
# Prod, guard per command. Never pipe through tail.
npm run db:query:prod -- --file scripts/sql/_plan_drift_scope2.sql --output table
npm run db:query:prod -- --file scripts/sql/_ip_payload_drift.sql   --output table
npm run db:query:prod -- --file scripts/sql/_evmodel_vs_plan.sql    --output table
```

Trigger dispute: `4576ee51-53ec-4ed2-8c66-65b04bb31d72` (blume-box,
`inr_product_not_received`, pack `1ae01792-8f46-45d6-a3eb-61470ce6bbbe`).

Verified counts on that pack:

| Surface | Count | Note |
|---|---|---|
| Overview / Evidence tabs | **3** | incl. *IP & location consistency* |
| `plan_json.included` | **8** | argument-relevant facts (incl. duplicates per record) |
| `plan_json.excluded` | **6** | all `not_argument_relevant`, incl. `ip_location_check` |
| `facts_json` | **1** | `no_return_initiated` only |
| PDF Evidence Basis | **1** | `no_return_initiated` |

The three numbers disagree three different ways, which is the point: there
is no single count in the system. `plan.included` (8) is record-level and
counts before composition; `facts_json` (1) is the bank-eligible subset the
producer persisted; the tabs' 3 is computed from neither.

**P0's assertions are record-level set-membership, never count equality:**

- no **record** outside `plan.included` carries an affirmative authorisation
  claim;
- no **record** lacking document provenance (§1.2) is reported as included
  in the letter;
- each rendered **row** aggregates its records' dispositions by P1's stated
  rule.

Note what is deliberately *not* asserted: that any of these counts converge.
They are legitimately different, and only per-record *disposition* is
comparable. A field-level version of these assertions is insufficient — see
Layer 4.

---

## 10. Open uncertainties and the exact verification each needs

*(Added 2026-09-22. Nothing here is assumed resolved; each item names the
command or artefact that would settle it.)*

| # | Uncertainty | Exact verification required |
|---|---|---|
| U1 | Is the 127/172 `facts_json` shortfall origin **A** (missing record→fact) or **B** (bank-inclusion filter)? §2 predicts fileable packs are all B. | Instrument `selectPlanFacts(...).missingRecordIds` per pack and cross-tabulate against `document_validation_passed` / `document_failure_codes`. Prediction: `plan_fact_mismatch` ⇒ never fileable. A fileable pack with nonempty `missingRecordIds` falsifies it and is a Sev-2. |
| U2 | Which package version does each merchant claim actually describe today? | Read the workspace payload for the **28** prod packs where `latest ≠ submitted` and record, per claim, which row supplied it. Query: `scripts/sql/_pkg_identity_split.sql`. |
| U3 | Do the **8** packs flagged `saved_to_shopify_at` with **no** submitted package row represent a real submission? | Join to `shopify_response` / `submitted_at` on every version for those packs; decide whether the evidence-pack flag or the package status is authoritative. Until settled, "Submitted to Shopify" cannot be derived from either alone. |
| U4 | Does plan-filtering the scored checklist ever change `overall`? **No prediction is offered** — plan exclusion and model relevance are independent (§3.3), so the `not_applicable` skip does not bound the answer. | P3a: first **enumerate** plan-excluded records whose relevance is *not* `not_applicable` (those are scored today); then run both checklists through `calculateCaseStrength` for every open dispute and report the delta set. Empty delta ⇒ P3b-ii is dropped. |
| U5 | Does a band move change **when** we file, not just whether? | Feed P3a's deltas through `deriveCaseAutomationDecision` and diff `hold_for_deadline` / `park_for_review` / early-file outcomes. |
| U6 | For an excluded delivery record whose sibling is included, what should render? | Enumerate prod packs with ≥2 `delivery_proof`/`shipping_tracking` records under one field and mixed disposition; decide the rule with the maintainer **before** coding `collapseDeliveryRows`. Not inferable from the existing rank sort. |
| U7 | How many submitted packages violate **today's specified checks**? | Replay `documentValidation` over historical `narrative_json` + `plan_json`; count `submitted` packages failing `orphaned_claim` / `plan_fact_mismatch`. **Scope of the answer:** this detects violations of those specific checks on packages that carry a plan. It does **not** establish whether any unsupported claim ever reached an issuer — legacy-route packages have no plan to replay against, and a claim can be unsupported in ways these two codes do not model. Report it as "N packages violate checks X and Y", never as a clean bill of health. |
| U8 | How does the evidence model's `relevance` axis relate to plan disposition? It reports `not_applicable` for facts the PDF **does** cite. | Tabulate `relevance` × plan disposition × `facts_json` membership across the 171 packs. This governs the **separate** registry/scoring work moved out of P4 — `relevance` gates scoring (`assessment.ts:135`), so any reseeding inherits D5/P3b-ii's rebuild constraints. Not a P4 blocker: P4 is projection-only and touches no model field. |
| U9 | Are there consumers of `usedAsPositiveBankEvidence` outside the 11 enumerated files (e.g. emails, PDFs, admin)? | Re-run the Layer 5 grep across `app/ lib/ components/ emails/ scripts/` at implementation time and diff against the §6 table. Enumerate from the tool, never from this list. |
| U10 | For each deterministic surface (§1.2 #3-5), how far can rendered prose be **traced back** to the records that authorised it? | Per surface, determine whether the authorising records are derivable. Fulfilment fallback: **yes** — `hasFulfillmentClaimAuthority(composeFrom)` names the approved facts (`projectFromPlan.ts:251`). Thesis: trace the facts it renders over. Chronology: the fact path is traceable, the `timelineEvents` path may not be. Case Details: mostly order metadata, likely `unknown`. Produce a per-surface verdict `direct` / `traced` / `unknown`; only genuinely underivable ones become `unattributedSurfaces`. **Do not assume any surface is unattributable — check each.** |
| U11 | Can document provenance be established for packages generated before the §1.2 map exists? | Determine whether `narrative_json` + `facts_json` suffice to reconstruct provenance **for that historical document**, and at what confidence. If not reconstructible, those packages render the unknown state permanently. **Do not** reconstruct from current evidence (P1). Scope this before any backfill. |
