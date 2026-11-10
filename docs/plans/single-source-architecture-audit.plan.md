# One account of the order: why the single source of truth did not hold, and the plan that closes the class

**Status:** FINAL CONSOLIDATED PLAN (2026-11-05), **pending approval**. **PR 0 is approved in principle** (behaviour-preserving, subject to the parity tests in §5). **PR 1 and later PRs are not approved.** Nothing is implemented, committed, merged, deployed or rebuilt; all production access was read-only.
Supersedes `return-state-coherence.plan.md`. Related, separate: `decided-outcome-cause.plan.md` (why a dispute was won; not part of this plan, see §7 R12).
**V** = verified in source or data; **H** = hypothesis / unverified. Code: `origin/master` `87a86683` (the local checkout is behind it). Measurements are read-only prod runs on 2026-11-05 (scripts under `scripts/shopify/measure-*.mjs`, `probe-refund-semantics.mjs`, SQL `scripts/sql/_f1_*`, `_cons_*`).

## Contents
1. Verified root cause · 2. Architectural contract and design · 3. Product decisions (F-1, completeness metric, refund statement) · 4. Consumer coverage and performance · 5. Phases, dependencies, tests and release criteria · 6. Review record · 7. Residual risks

---

## 1. Verified root cause

Dispute #24612 (CREDIT_NOT_PROCESSED inquiry) shows a blue banner "a return is marked as received" and, on the same page, a *Not included* row "No return initiated"; Overview and Evidence say nothing about the return.

- `orderSource.ts:274-282` emits the fact `no_return_initiated` only when `returnStatus === "NO_RETURN"` and `!shopifyRecordsReturnOrRefund(...)` and the return scope allows. For #24612 the status was `RETURNED`, so no fact exists, but the **checklist template still expects the row**, and nothing compares an *expected row* with the order record. The row is therefore a generic missing-field placeholder.
- `orderSituation.ts` has few consumers; `evidenceLineItem.ts:1-4` claims to be the "single source of truth" for row state and imports no order situation; `decidedView.ts:357,365` derives `noReturn` from fact presence and reads no checklist; `inclusion-override/route.ts:97-135` checks registry and checklist membership only; the loaders select the same pack row but walk `evidence_items` separately.
- `contradictionGate.ts:106-150` drops *collected sections* refuted by another source; it cannot see a template row that has no section.
- Earlier efforts each unified a different thing (a predicate, a category registry, a row state, a display). **None unified the applicability of an expected row against the order record.** That is the missing authority.
- A second read-time authority already existed unnamed: `packShowsReturnOrRefund(sections)` (`returnRequestConfirmation.ts:73`, gates the return question at `workspace/route.ts:1271` and `return-request-confirmation/route.ts:89`). Two parallel authorities with different rules for absent shapes are the same defect again.
- **Why the 'earlier' designs failed (maintainer-verified):** `reconcileChecklistWithCollectedFields` (`checklistReconcile.ts:109-169`) never calls `resolveItemStatus`; `resolveItemStatus` (`completeness.ts:599-672`) checks waived and present *before* the mode; stored items carry no `requirementMode` (`evidenceItem.ts:40-57`); DB templates cannot carry newer modes (`completeness.ts:214`); and `completeness.ts` already holds two copies of the mode rules (`resolveRequirement` `:241-299`, an inline switch `:620-672`). **A requirement mode cannot express this rule; it belongs to the field.**

---

## 2. Architectural contract and design

### 2.1 The contract (what must hold)

1. **Three separate questions, three separate owners.** *Factual truth* (what the order record says: `orderSituation`, refund statement), *applicability* (does an expected checklist row make sense given that record: one authority, below), *bank eligibility* (what may go into a filing: `factPredicates`, `alwaysAdmissible`, `bankInclusion`, gates). This plan changes the first two for merchant-facing reads and **does not change the third.**
2. **Three-state facts:** *known*, *contradicted*, *unknown*. `unknown` never hides anything (it fails open for display).
3. **One applicability authority** for expected rows, which delegates to the same decision the collector uses to emit the corresponding fact. The authority holds no rule of its own.
4. **Read-time correction** of stored and decided disputes. No rebuild, no resubmission, no rewrite of stored `checklist_v2`, `completeness_score`, `facts_json`, `plan_input_hash`, letters or PDFs.
5. **Bank-facing data is out of the blast radius** and every PR asserts it (§5).

### 2.2 The shared verdict (collector and read time use one function)

The collector cannot know returned-to-sender at emission (collectors run in `Promise.allSettled`, `buildPack.ts:495`; "no collector can consult another", `contradictionGate.ts:23-27`; reason applied after gather by `applyContradictionGate`, `buildPack.ts:547`). A literal extraction that treats an absent status as "do not emit" would drop 9 `missing` pre-stamp rows and flag 204 `available` ones, the opposite of "unknown means applicable". So the shared function is **three-state**, and returned-to-sender is **composed after it**.

```ts
// lib/disputes/returnRequestConfirmation.ts (home of shopifyRecordsReturnOrRefund / noReturnFactScope)
// The collector's existing context shape (buildPack.ts:395-404, orderSource.ts:266-269):
type ReturnScopeInput = { returnsOutsideShopify: boolean; answer: ReturnAnswer | null }
// noReturnFactScope's existing output (renamed here to avoid the clash with the input type):
type NoReturnScopePayload = ReturnType<typeof noReturnFactScope>   // { emit, returnsOutsideShopify, merchantConfirmedNoRequest }

export type NoReturnVerdict =
  | { emit: true; scope: NoReturnScopePayload }
  | { emit: false; reason: "return_on_record" | "refund_on_record" | "merchant_says_request_received" }
  | { unknown: true; why: "status_absent" }

// ONE input shape for the collector and every read-time caller; the verdict calls noReturnFactScope internally.
export function noReturnFactVerdict(i: { returnStatus: string | null; totalRefunded: number | null; returnScope: ReturnScopeInput }): NoReturnVerdict
export function returnScopeFor(settings: Settings | null, confirmation): ReturnScopeInput   // the setting gate of buildPack.ts:395-404
```

**Precedence (pinned by the parity grid against today's code):**
1. any **non-null** status other than `NO_RETURN` (including a string the status map does not recognise) → `return_on_record`. This matches the collector and today's `shopifyRecordsReturnOrRefund` (`returnRequestConfirmation.ts:65`; `orderSituation.ts:85` maps unknown strings to `"unknown"`, and `"unknown" !== "none"`). **Decision:** an unrecognised status counts as a return on record, so the return question is hidden *and* the `no_return_initiated` row is inapplicable. Measured population: 0.
2. refund total > 0 → `refund_on_record` (also when the status is null/absent).
3. status null/absent → `unknown` (`status_absent`; the collector does not emit).
4. `NO_RETURN` → `merchant_says_request_received` when the scope says not to emit, else `emit:true`. **`NO_RETURN` with an unparseable refund total emits today** (refund reads `unknown`, so `shopifyRecordsReturnOrRefund` is false); the verdict returns `emit:true` there. It must not "fail closed" and change emission.

- **Collector:** `orderSource.ts` calls `noReturnFactVerdict`, emits on `emit:true` using `scope` for the fact payload exactly as `:271-293` does, and treats `unknown` as *do not emit*.
- **Authority:** `noReturnApplicability(inputs, sections)` = verdict, then `hasReturnedToSenderShipment(sections)` composed after it. `emit:false` or returned-to-sender → inapplicable; `emit:true` → applicable; `unknown` → applicable (fail open).
- **Wrapper:** `packShowsReturnOrRefund` is reimplemented as a thin wrapper over the verdict (true for the return/refund `emit:false` reasons; the `unknown` mapping is pinned against today's boolean over every persisted shape). `noReturnCountsForStrength` (`:138`) stays baselined (§5).
- **`returnScopeFor(settings | null, confirmation)`** takes over `buildPack.ts:395-404` (the setting gate). The catch-fallback "→ off" (`:405-411`) stays at the **call site**, because a pure function cannot contain a try/catch around an async load. `loadReturnRequestConfirmation` returns null on a DB error (`returnRequestConfirmation.ts:98-104`), so at build time a failed answer read yields *setting on, answer null*; emission is the same as before, and a test pins the fact payload for that input.
- **Fact-side readers named and left alone** (baselined with reasons): `factPredicates.ts:101,351,358`, `alwaysAdmissible.ts:112`.

### 2.3 The applicability authority and its table

In `lib/automation/completeness.ts` (where `resolveRequirement` lives; `lib/evidence/model/definitions.ts` is rejected as a home because it imports `completeness.ts`, a cycle):

```ts
interface OrderContext { …existing…; noReturnFact?: NoReturnApplicability }   // undefined = unknown = applicable
type Applicability = { applicable: true } | { applicable: false; reason: string }  // reason is a CODE, never English

function modeApplicability(mode, ctx, field?): { required; collectable; unavailableReason? }  // ONE body

const FIELD_PRECONDITIONS: Partial<Record<EvidenceFieldKey, (ctx: OrderContext) => Applicability>> = {
  no_return_initiated: ctx => ctx.noReturnFact?.applicable === false ? ctx.noReturnFact : { applicable: true },
};
export function fieldApplicability(field: string, ctx: OrderContext): Applicability
export function inapplicableFields(ctx: OrderContext): ReadonlySet<EvidenceFieldKey>
```
The table is a registry of *which fields have a world precondition*; each entry delegates to the single decision that governs that field's collector. Reasons are codes (CLAUDE.md rule 5); the existing English reasons at `completeness.ts:252-287` are not copied.

### 2.4 PR 0: behaviour-preserving consolidation (approved in principle)

`resolveRequirement` returns `required` and takes no `field`; `resolveItemStatus` needs `field` for the `inTransit` reason (`:621`) and has no `required`; the v1 callers (`:341,357`) pass `(mode, ctx)` only and persist output in `pack_json.completeness.checklist` (`buildPack.ts:1069-1074`). So `modeApplicability(mode, ctx, field?)` returns `required` too and applies `inTransit` only when `field` is passed.

PR 0 contains: (a) merge of the two mode switches; (b) `hasReturnedToSenderShipment` made null-safe; (c) `returnScopeFor` and `noReturnFactVerdict` extracted, `orderSource.ts` calling them; (d) parity tests. **Parity per caller:** (i) `resolveRequirement` byte-identical over every `RequirementMode × OrderContext`; (ii) `resolveItemStatus` byte-identical over every mode × context × `{present, waived, absent}` × `field ∈ {delivery_proof, other}`; (iii) persisted `pack_json.completeness.checklist` and `checklist_v2` byte-identical for fixed disputes; (iv) the collector's emission and fact data byte-identical over the full verdict input grid; (v) `returnScopeFor` identical to today's inline code including the null-answer input. **PR 0 is behaviour-neutral except (b):** today `hasReturnedToSenderShipment` throws on malformed sections (`contradictionGate.ts:163-169`); measured malformed shapes in prod: **0 of 446** latest packs, so (b) is defence, not a fix of an observed failure. PR 0 adds no applicability consumer and no UI change; `orderContext.noReturnFact` stays unset. It is bank-adjacent (the collector feeds the bank path), so its only evidence of safety is the parity suite; it is reverted by a plain revert.

`derive.ts:443` is **not** part of this plan: no production caller passes `orderContext` to `deriveCaseEvidenceModel` (`route.ts:889`, `buildPack.ts:980`, `planForCase.ts:124`).

### 2.5 Build-time chain (unchanged by PR 1)

```
buildPack.ts:747  orderContext = { isFulfilled, hasCardPayment, avsCvvAvailable, hasShippingEvidence, hasRefund, hasReturnedToSenderParcel, paymentFamily }
                  noReturnFact UNSET → fieldApplicability = applicable → output byte-identical
→ evaluateCompletenessV2(reason, collectedFields, waivedItems, templateItems, orderContext)          completeness.ts:684
     per row: resolveItemStatus(mode, ctx, isPresent, waivedItem, field)                             :599
          waived → "waived" · present → "available"  (precedence unchanged at build time)
          else   → modeApplicability(mode, ctx, field) ⊕ fieldApplicability(field, ctx) → "unavailable" | "missing"
→ reconcileChecklistWithCollectedFields(checklist, collectedFields)                                  buildPack.ts:787
→ deriveCompletenessMetrics(reconciled) → stored completeness_score / submission_readiness
```
The later, measured build-time adoption sets `orderContext.noReturnFact = noReturnApplicability(...)` (§5, step B1).

### 2.6 Read-time chain (stored and decided disputes, no rebuild)

```
assembleEffectiveChecklist({ storedChecklist, packSections, evidenceItems, returnsOutsideShopify, returnAnswer, packCycle })   NEW lib/packs/effectiveChecklist.ts
  checklist = normalizeChecklistV2Shape(storedChecklist) ?? []      (existing: handles null and {items:[]})
  sections  = normaliseSections(packSections)                        (arrays / null entries / fieldsProvided ?? [])
  ctx       = { noReturnFact: noReturnApplicability({returnStatus, totalRefunded, returnScope: returnScopeFor(settings|null, confirmation)}, sections) }
  reconcileChecklistWithCollectedFields(checklist, collected, { applicability: f => fieldApplicability(f, ctx) })
       existing steps (drop retired, flip, append) THEN drop a row iff applicability is false AND status ≠ "available"
  returns { checklist, droppedForRecord, contradictedAvailable }
```
Reconcile contains **no field name**; it receives a function and applies the same shape of rule as its existing retired-field drop (`checklistReconcile.ts:132`). Read time calls only the field half because stored statuses encode the mode half (re-running `evaluateCompletenessV2` on read is impossible without collected fields, DB templates and live order context, `waive/route.ts:24-31`).

**Callers that supply `returnAnswer`, `returnsOutsideShopify` and `packCycle`:** the workspace route, the decided loader, the include endpoint (gains one `disputes` query for the response cycle; it today selects only the pack, `inclusion-override/route.ts:110-115`), **and `app/api/packs/[packId]/route.ts`** (the embedded pack page's feed). Without them a consumer diverges from the workspace whenever the merchant says the request was received.

**Decided view:** `buildDecidedView` runs in the browser and reads no checklist. The loader (`loadDecidedViewInputs`) computes `inapplicable = inapplicableFields(ctx)` from the pack sections it already selects (`pack_json`, `loadDecidedResponse.ts:188`) plus answer/setting; `DecidedViewInputs` (`decidedView.ts:44-74`) gains an optional `inapplicable: ReadonlySet<string>` (existing fixtures unchanged). The `noReturn` row is omitted iff `inapplicable` has `no_return_initiated` **and** it would otherwise read missing (kept as "had" via `returned_parcel_outcome`).

### 2.7 The cases

| case | build time | read time (effective) |
|---|---|---|
| `missing`, no collected section (the defect) | PR 1 unchanged; later `unavailable(code)` | dropped |
| `available` that the record contradicts | stays `available` | **kept and flagged** (`contradictedAvailable`, logged), never hidden: hiding a row whose fact may be filed would show the merchant less than the bank sees. Measured 0. |
| `waived` | stays `waived` | dropped when inapplicable; stored waive record untouched. Measured 0. |
| stored `force_include` / `force_exclude` | n/a | row dropped, so no row for the override map to attach to; `pack_json.inclusionOverrides` untouched. The endpoint rejects `force_include` on an inapplicable field with a distinct code; `force_exclude` unchanged. |
| Absent status (pre-stamp pack) | unset → applicable | `unknown` → applicable. **213 rows (204 `available`, 9 `missing`):** the 204 unchanged; of the 9, **3 have a processed refund and are legitimately dropped** (`refund_on_record`, step 2), 6 have no refund and stay. No inference from event prose in PR 1. |
| Unrecognised status | collector silent | `return_on_record` → dropped (a rule, 0 packs) |
| Code vs DB templates; appended rows | field-keyed, mode-independent | same |
| Stored shape `{items}` / null checklist | n/a | normaliser. Measured: array 444, `{items}` 0, null 2. The include endpoint's `(pack.checklist_v2 ?? []) as ChecklistItemV2[]` + `.find` (`:127-129`) would throw on `{items}`: replaced by the normaliser. |
| Returned-to-sender | collector cannot know; gate removes sections | composed → dropped |
| Refunded with no return · merchant says request received (setting on) | unchanged | `emit:false` → dropped; measured 0 · 0. A stale answer with the setting **off** does not drop (gate in `returnScopeFor`). The assembler takes the **pack's** cycle (`packCycle`); an answer recorded for another cycle is ignored; tested for cycle-1 pack + cycle-2 answer and the reverse. Read time uses the *current* setting and answer, build time used those at build, so a verdict can differ after a setting change: a deliberate, listed exception. |

### 2.8 The class guard, at its real strength

Nearly every `auto`/`conditional_auto` field has an emission guard (about 14: `shipping_tracking`/`delivery_proof` `fulfillmentSource.ts:729,745`, three policies `policySource.ts:84`, `customer_communication`, `avs_cvv_match`, `activity_log`, `customer_account_info`, `ip_location_check`, `fraud_risk_screening`, `tds_authentication`, `shopify_protect_coverage`, `refund_record`, `no_return_initiated`). Most mean "no evidence found", where a `missing` row is correct. A test cannot tell "the world makes this impossible" from "evidence absent" mechanically, and collector inputs (live GraphQL, ipinfo, Gorgias, receipts) are not the read inputs, so identity delegation is only possible for fields whose inputs are persisted (`no_return_initiated`, `refund_record`). The guard is therefore **a reviewed classification, completeness-enforced, not a proof**:

- `lib/evidence/model/emissionClassification.ts` (beside the collectors; **no collector code edited**) assigns every `auto`/`conditional_auto` field in `CANONICAL_EVIDENCE` a class: `world_precondition` (must have a `FIELD_PRECONDITIONS` entry; today `no_return_initiated`), `evidence_absent` (a `missing` row is correct), `needs_decision` (listed with an owner and a dated trigger; shrink-only).
- Every assignment carries a one-line justification and the per-field classes are snapshotted in the repo so any reclassification is a reviewed diff. Reclassifying `needs_decision` → `evidence_absent` is not credited as progress.
- **Cross-validation** against the existing per-field lists (`SYSTEM_DERIVED_FIELDS`, `concreteContribution.ts:63`; `SOURCE_OUTSIDE_MERCHANT_CONTROL`): `canMerchantUpload(item)` takes `{field, collectionType}` (`concreteContribution.ts:98-106`), so the test calls it with each **code template's** collection type. `evidence_absent` must imply `canMerchantUpload` or carry a written reason; every pure-`auto` field outside the two lists needs a written reason, and the count of such reasons is reported and **may not exceed a checked-in baseline** (so the check cannot degrade into "write a reason").
- **Collector-parity test, per verdict reason** (not "applicable exactly when the collector emits"): `emit:true` ⇒ collector emits and row applicable; `return_on_record` / `refund_on_record` / `merchant_says_request_received` ⇒ collector silent and row inapplicable; `status_absent` ⇒ collector silent and row **applicable** (a documented, deliberate asymmetry). After PR 0 both sides call the same verdict, so this holds by construction; it catches wiring/table mutations, not a wrong verdict. A wrong verdict is caught only by the hand-written cells (§5).

This forces the *decision* to be made and recorded for every field; it does not prove the decisions right. The remaining risk (a field classified `evidence_absent` that is really world-impossible) is stated in §7.

### 2.9 Where applicability is decided after this plan

`modeApplicability` (one body, merged from two) and `fieldApplicability` (delegating per field), behind `resolveRequirement`/`resolveItemStatus`; reconcile receives the function as a parameter; the endpoint, decided loader, workspace route, pack page and API route call the assembler or the authority; `packShowsReturnOrRefund` is a wrapper. `contradictionGate` keeps section suppression; `orderSituation` keeps interpreting the order. **Applicability is still not literally one function**: it is decided by the mode half (template-dependent `required_if_*`), the field half, the wrapper, and the per-field lists reconciled by the §2.8 test. Independent interpretations that remain, named and baselined with reasons: `factPredicates.ts`, `alwaysAdmissible.ts`, `buildPack.hasRefund`, the counsel ledgers, `caseStrength`, `noReturnCountsForStrength`.

---

## 3. Product decisions

### 3.1 F-1: the 75 missing critical `refund_record` rows (DECISION)

**Finding (V, all from `origin/master`).** `refund_record` stands for three concepts and delivers one:
- **(a) Refund status:** what Shopify records. The collector emits the field only when the refunded total is above zero (`orderSource.ts:235`; section only if entries exist, `:206`).
- **(b) Refund evidence (what the field actually delivers):** proof a refund was completed. `canonicalEvidence.ts:261,720` rate it Strong only when `refundStatus === "processed"` and amount > 0. The live label is "Refund record" (`messages/en.json:747`), described "Proves a refund was actually issued…" (`:1217`). The winning strategy is `credit_not_processed_refund_record.ts`.
- **(c) Refund justification (why no refund was owed):** exists **only as a label** in the decided view ("Refund record, or why no refund was due", `en.json:1020`, `decidedView.ts:364`). No collector, field or upload produces it. The justification really lives in `refund_policy` (critical and required for CNP, `completeness.ts:533`), `no_return_initiated` and customer communication, which are already on the CNP template.
- **Template mechanism:** on CNP the row is `critical` with mode `recommended`, so `resolveRequirement` never consults `hasRefund` (`:531`). On FRAUDULENT it is `required_if_refunded` and becomes `unavailable` without a refund (`:481`, `:650-660`). CNP lacks that mechanism.
- **Merchant ask:** `refund_record` has `collectionType` `conditional_auto` and is not in `SYSTEM_DERIVED_FIELDS`, so `canMerchantUpload` is true and an "Add" call-to-action renders. Uploading fills the row (`available`) and raises the score, but the file becomes a `manual_evidence` fact (`factClassifier.ts:~1384`), **not** a `refund_record` fact, so it lifts the score and changes nothing bank-facing. **0 prod `evidence_items` were ever uploaded against `refund_record`:** the ask has never been satisfied by any merchant.
- **Bank-facing effect of the missing row:** none directly. `derivePackageMode` returns `narrow` whenever no `refund_record` *fact* exists (`factClassifier.ts:1205`), independent of the row. Defence-package enqueue skips only on coverage, a flag or pack status (`enqueue.ts`). The row's only gating channel is **auto-save**: critical weight 1.0 (`PRIORITY_WEIGHT`, `:589`), readiness `ready_with_warnings`, blocked by `score < auto_save_min_score` (`autoSaveGate.ts:35`).

**Population (latest pack per dispute; `_f1_*.sql`).** 194 packs carry the row; **75 are critical + missing, all `ready_with_warnings`**: CNP no refund **69**, CNP zero-amount entry 4, FRAUDULENT zero-amount entry 2. Shops: whj8db-1q 49, cay-collective 22, 6a8848-dd 2, blume-box 2 (the blume-box rows are FRAUDULENT; its canonical score at threshold 60 is already above). **63 of the 75 sit below the shop's threshold of 80 because of this row alone; removing or filling the row lifts all 63 to ≥ 80** (stored 47–76 → 57–96). Statuses of those: 9 open `needs_response`, 15 `under_review`, 8 `submitted_confirmed`, the rest decided. **Whether the 63 would have been auto-saved is not verified** (rule mode, the strength gate and the fatal-loss gate also apply and were not replayed); 63 is an upper bound.

**Why the ask is not truthful for CNP with no refund.** The collector cannot produce the record (no refund exists). The merchant's defence is a policy plus no return received (`en.json:2060` already says "no refund was owed"). Telling the merchant to add a "refund record" is untruthful, and any file satisfies it (score by any file).

**Options evaluated.**
| option | effect | verdict |
|---|---|---|
| **A. Copy + upload-affordance fix** (no score/applicability change) | stored score, `checklist_v2`, hashes and bank outputs unchanged; removes the false ask and the score-by-any-file path | **Adopted, in PR 1** |
| **B. Reason-conditional applicability** (`required_if_refunded` on CNP, as FRAUDULENT) | the 63 cross 80: an **auto-filing change** for packs whose facts remain `narrow` | **Correct end state, but a separate maintainer decision (F-1b)** |
| C. Split into `refund_proof` + `no_refund_justification` | new registry entry/domain/actions/copy/DB-template migration/prompt-module reconcile; no collector for the justification; duplicates `refund_policy` | Rejected |
| D. Mark non-critical | same crossings as B, keeps a permanent unsatisfiable row | Rejected |

**Decision.**
- **F-1a (in PR 1, no score or submission effect):**
  1. `disputes.signalLabel.refund_record` description (`en.json:1217`) becomes a neutral statement: "Shopify's refund record, shown when a refund exists."; the decided-view label `:1020` is aligned to the same meaning; the `refundRecord.notIncluded` reason (`:2060-2062`) is rewritten to a statement true in every refund shape: "Shopify records no confirmed refund amount on this order." (six locales; it carries no claim that a refund does or does not exist, and no 'your defence is…' sentence).
  2. **`refund_record` becomes merchant-non-uploadable inside `canMerchantUpload` itself** (a field-level rule, no new input). Why this is sufficient: the collector adds the field only when the refunded total is above zero (`orderSource.ts:233`) and reconcile then marks the row `available`, so a *missing* `refund_record` row already means "no confirmed refund amount". `canMerchantUpload` decides the upload button in at least nine places (`OverviewTab.tsx:990,1678,1894,2008`, `useDisputeWorkspace.ts:156`, `caseStrength.ts:582,1321`, `completeness.ts:922,950`) and the list (`serverFacts.ts:195`, which selects only `checklist_v2` and cannot see the refund situation); a row-builder-only change would leave the Overview "Add" button and a half-state at `OverviewTab.tsx:1894`. Effects, all intended and listed as a **deliberate exception**: the list attention bucket stops counting `refund_record` as merchant-actionable on the 75 packs (9 open); a merchant can no longer attach a file to this row (0 ever did; such a file only became a `manual_evidence` fact). Stored score and readiness are unchanged (the CNP row is critical, and `completeness.ts:922,950` already skip critical rows). If a merchant refunded outside Shopify, proof belongs on `supporting_documents` (a `manual` slot on CNP, PRODUCT_UNACCEPTABLE and FRAUDULENT) and the explanation on `refund_policy` / customer communication, all of which remain uploadable. **The rule is field-level, so it also applies on PRODUCT_UNACCEPTABLE, where `refund_record` is `recommended` (`completeness.ts:503`):** on rebuild this changes `recommended_actions` (`:922`, persisted and printed in the PDF) and the `caseStrength` improvement hint (`:582,1321`). Not bank-facing and not in the hash, but listed here as deliberate exceptions. The same rule is applied to `no_return_initiated` (§4.2).
  3. Tests: stored score, `checklist_v2`, facts, letters, PDFs and `plan_input_hash` unchanged for the 75; the three disputes and a CNP no-refund fixture show no upload button and the neutral reason; `checklistFieldCopy.test.ts` and `verify-i18n-parity` pass.
- **F-1b (own PR, NOT approved; decision owner: maintainer; trigger: before any change to scores):** switch CNP `refund_record` to `required_if_refunded` **at read time only first** (assembler precondition, no stored change). Prerequisites, all measurable before approval: replay the auto-save gate for the 9 open + 15 under-review disputes with the row inapplicable and list those that would newly auto-save; decide whether CNP thresholds are rebased instead; show the maintainer before/after on ≥ 10 disputes; then, and only then, the build-time template change. **`needs_decision` for `refund_record` in the classification registry is closed by this decision, not before:** until F-1b is decided the entry stays `needs_decision` with owner "maintainer" and this section as its reason.
- **Is F-1 "resolved rather than renamed"?** The *truthfulness* defect (the ask, the copy, the false upload route) is resolved by F-1a with no effect on any submission decision. The *score/submission* question (a never-satisfiable critical row holding 63 packs under the threshold) is explicitly isolated as F-1b with a named owner, a measured prerequisite and a quantified effect. It is not left undefined; it is deliberately gated because the change would alter filing behaviour.

### 3.2 Completeness metric presentation (DECISION)

**Facts (V; `_cons_packs.sql`).** Stored `completeness_score` is read by the auto-save gate (`autoSaveGate.ts:35` via `resolveEffectiveCompleteness`, `pipeline.ts:677`), the canonical decision hash (`deriveCaseAutomationDecision`), the deadline cron (`defence-package-deadline-submit/route.ts:381`), `saveToShopifyJob.ts:276`, `reconcileParkedAutoDisputes.ts:130`, manual save (`save-to-shopify/route.ts:70`, rejects 0); no billing use. blume-box alone uses a canonical snapshot score at threshold 60 (`completenessActivation.ts`). Write routes (upload, parcel-outcome, cardholder-acknowledgement) recompute the stored score from the stored checklist. Dispute-page tabs do not render the score; the embedded pack page (`packs/[packId]/page.tsx:502,940`), `SubmissionSidebar.tsx:52-57`, the portal dispute and pack pages (`portal/disputes/[id]/page.tsx:622,697`; `portal/packs/[packId]/page.tsx:248`) and the evidence PDF (`renderPdfJob.ts`, `EvidencePackDocument.tsx:79`) do.

**The affected packs (re-measured today; this supersedes the earlier "24 + 4 + 3 = 31"):**
| group | shop | n | stored → effective | readiness | threshold | crossing |
|---|---|---|---|---|---|---|
| return on record | whj8db-1q | 23 | 68 → 76 | `ready_with_warnings`, unchanged | 80 | none |
| returned to sender | cay-collective | 3 | 47 → 52 | unchanged | 80 | none |
| returned to sender | whj8db-1q | 1 | 47 → 52 | unchanged | 80 | none |
| pre-stamp, processed refund | cay-collective | 3 | 89 → 100 | `ready`, unchanged | 80 | none (both ≥ 80) |

**30 packs**, not 31: the earlier 24th return-on-record pack was not found in today's run (the `under_review` one; probably rebuilt since); this is recorded as a reconciled difference, not hidden. Both shops have auto-save enabled, `enforce_no_blockers=true` and one enabled rule (the fallback in `auto` mode); all 30 packs have status `ready`. **No crossing in either direction.**

**Decision.**
1. **One merchant-facing metric: "Evidence completeness" = `deriveCompletenessMetrics(effective checklist)`**, produced by **one function `merchantCompleteness(pack)`** (in `lib/packs/effectiveChecklist.ts`) used by **every** merchant page that shows a percentage: the embedded pack page, `SubmissionSidebar`, both portal pages and the PDF. **No page-local rule** (the earlier "interim display rule: effective only when ≥ 1 row was dropped" is **withdrawn**: it is a special case only one page would use).
2. **The stored `completeness_score` stays internal** (automation, the decision hash, gates). Merchants do not need both numbers; showing both puts a stale figure beside the right one.
3. **Where the stored number is quoted to a merchant** (the `auto_save_blocked` event text and the `PACK_BLOCKED` timeline entry quote "N% below M%"), the figure is labelled **"at build"** in PR 1. The `PACK_CREATED` timeline score is a historical record and stays as built.
4. **PR 1 blocker (measure first):** reconcile already flips rows and drops retired fields without recomputing the score (`workspace/route.ts:545-553`; the "112 packs" figure is the retired-field count quoted at `checklistReconcile.ts:124`, **not** a measurement of flipped rows, so Phase 0 (h) measures the whole population), so `merchantCompleteness` changes the displayed percentage on those too. Before PR 1: compute stored vs effective for all 112 (and all packs), list every threshold crossing per shop, and list packs where the displayed number moves by more than 10 points. If any crossing exists on an open dispute, the maintainer sees it before the decision is final; the fallback is to show the percentage only where stored and effective checklists agree, never a per-page rule.
5. **Future build-time adoption** (§5 step B1) makes stored = effective for new builds; it is gated on the same crossing query (above) plus the `plan_input_hash` question (Phase 0 b), and ends the "at build" labelling need for new packs.

### 3.3 Refund statement: zero-amount refunds (DECISION)

**Facts (V from source; none of this was rendered, see §5 Phase 0).** `orderSource.ts:233-237` stores a zero-total refund entry in `packs.section.refundHistory` with `refundStatus: "none"` and `fieldsProvided: []`, so no `refund_record` payload exists for it; of 25 stored evidence items with `refundStatus:"none"`, 0 carry `refund_record`, which makes `refundPresentation.ts:74` ("No refund issued") unreachable from stored data but a copy of the wording used elsewhere. The pack stores **no transaction status**, only `refunds[{id,createdAt,note,amount,currency}]`, so failed, pending, later-successful and transaction-less entries are **indistinguishable** from a zero entry in any stored pack. Matched by refund id to live Shopify: **28 stored zero entries, 26 disputes: 18 now positive SUCCESS, 9 FAILURE-only, 1 PENDING** (`Refund.totalRefundedSet` = sum of SUCCESS transactions in 278 of 278 live entries). `pending` is therefore rejected (false for 9 of 28).

**Today's contradictions (V from source).** Every surface says "none" for a zero entry, and two surfaces can disagree after the planned banner copy: `OrderSituationNote` (new `recorded_no_amount` copy) beside the `heldUnrefunded` banner ("…no refund has been issued", `heldOrCancelledUnrefunded` reads only the amount); NO_RETURN with a zero entry (9 packs) shows "No refund issued · customer never initiated a return" on the Overview card; the pack viewer lists 0.0 entries whose zero guard `!== "0.00"` does not match a stored "0.0"; `refundedAt` on a positive refund is the *latest* entry's date, which can be a failed 0.0 entry (`orderSource.ts:219-221`).

**Decision: one contract, one vocabulary.** New `lib/disputes/refundStatement.ts`:
```ts
type RefundKind = "none" | "recorded_no_amount" | "some" | "unknown"
refundStatementFromPackSections(sections): { kind; amount?; currency?; refundedAt?; asOf } | null   // the ONLY reader of order.totals.refunded and refundHistory.refunds[] for merchant copy
refundStatementTokens(stmt): I18nToken    // disputes.refundStatement.{none,recordedNoAmount,some,unknown}.{title,detail}, six locales
```
- `none` = the order section stores `totals.refunded` and it reads **exactly 0**, **and** there are no refund entries (no refund section, or an empty `refunds[]`). **A pack that never stored `totals.refunded` is `unknown`, not `none`** (`orderSituation.ts:28-30,88-90` treats an absent amount as unknown), so "Shopify records no refund" is only ever shown when the amount was actually recorded; Phase 0 (j) counts packs lacking `totals.refunded`. `recorded_no_amount` = ≥ 1 entry and total 0; `some` = total > 0; `unknown` = a refund section without a `refunds[]` array (an older shape; today this reads "none", so it is a **listed, counted exception**).
- Copy (en, translated ×6): `none`: "Shopify records no refund on this order (as of {date})."; `recorded_no_amount`: "Shopify records a refund entry on this order with no confirmed amount (as of {date})."; `some`: "{amount} refunded on {date}."; never "pending", "started" or "issued" for `recorded_no_amount`, and **no sentence outside this namespace says "no refund"**.
- **Two further "no refund" consumers found by the final review (V) and fixed in PR 1:** (i) the stored English `unavailableReason: "No refund was issued on this order"` (`completeness.ts:278,658`, persisted in `checklist_v2`, rendered at `OverviewTab.tsx:1963` and `EvidenceBuilderSection.tsx:355`, driven by `hasRefund` which reads only the amount): stored data is not rewritten, so the **read-time line-item builder replaces that reason with the refund statement's tokens** whenever the row is `unavailable` for the no-refund reason (it also violates CLAUDE.md rule 5 as stored English; the builder never shows the stored string); (ii) the strength reason `disputes.strengthReason.returnedToSender.returned_unrefunded` ("no refund has been issued", `returnedToSender.ts:100-112`, fires when `refunded < disputeAmount`, so it is **false on partial refunds**): copy-only change in PR 1 to a statement true for every refund amount below the disputed amount ("The refund on record is less than the disputed amount." ×6); the trigger is a strength input and is not changed.
- Consumers moved onto it in PR 1: `OrderSituationNote`, the `heldUnrefunded` body, `refundRecord.notIncluded` (§3.1 F-1a), `buildRefundPresentation` (its `titleNone` branch and the `refundStatus === "none"` check are deleted; the `NO_RETURN` card's title today is `titleNone`, "No refund issued" (`en.json:2297`); it is replaced by a **new** title key "No return initiated" (six locales) and gains a refund clause **only** when `kind === "none"`; `buildRefundPresentation` receives the refund statement as an added input), the pack viewer's zero guard (numeric comparison). The `refundedAt` date for a positive refund is taken from the entries with a positive amount in the presentation helper only; the collector's data field is not changed (bank-adjacent).
- **Guard:** a test runs the six cases (no entries; zero entry; failed; later successful; entry without transactions; positive) through **every** consumer and asserts no two statements about the same dispute disagree; a grep invariant forbids "no refund" strings outside the namespace.
- **Bank-facing paths are not touched (V):** the `refundStatus` write at `orderSource.ts:237`; `no_return_initiated` emission (`:274-282`, via `shopifyRecordsReturnOrRefund` → `resolveOrderSituation`, which does not learn the new kind); `buildPack.ts:739-741` (`hasRefund`); `fatalLoss.ts:118-138` (`refund_issued`, needs a positive amount); `canonicalEvidence.ts:727`; `factClassifier.ts:960-972`; `factPredicates.ts:317-327`; `claimGuards.ts:184`; `evidenceBasisRows.ts:256`; letters and the counsel ledger (`creditNotProcessedLedger.ts:64`); `planForCase.ts` and `caseSelectionContext.ts` contain no refund reads. `hasReturnOrRefundOnRecord` (`orderSituation.ts:134`) has no callers and is deleted.
- **Verification set (Phase 0 renders the real output before PR 1):** #24612 (`2903f245-aabf-402f-920f-c22a711bdc71`: RETURNED, zero entry), #24510 (`18f3c0a3`: RETURNED, zero entry), #24599 (`ae3814d1`: IN_PROGRESS, no refund section → `none`), a failed refund (#92719 `c1bbfa4a`, #99511, #98483, blume-box #352801/#352803), a later-successful one (#100017, #99413, #99445), a pending one (#96919), NO_RETURN + zero entry (#104499, #24215), and a transaction-less entry (only live examples exist: blume-box #371371/#371402/#371360/#371348, not disputes; a synthetic fixture covers it). **Unverified:** whj8db-1q's token returns "Invalid API key", so its live state could not be re-matched today; its counts rest on the earlier run.

---

## 4. Consumer coverage and performance

**Completion point.** *All merchant-facing surfaces agree* when **PR 1, PR 2 and PR 5** are merged and the cross-surface matrix (§5) is green for the verification set. Until then the dispositions below say exactly which surface still differs.

### 4.1 Disposition of every consumer (from the final inventory; `origin/master`)

| surface (file:line) | reads | can show a wrong claim? | disposition |
|---|---|---|---|
| Workspace route `app/api/disputes/[id]/workspace/route.ts:533-556` → Overview, Evidence, Review, `deriveMissingItems` (`useDisputeWorkspace.ts:1095-1123`), `nextAction` | reconciled stored `checklist_v2` | **Yes**: "No return initiated" missing row; inflated missing/not-included counts | **Fixed in PR 1** |
| Decided view (`DecidedWorkspace.tsx:152,530-548`, `decidedView.ts:357`) | facts | **Yes**: coverage `x / N` and the `noReturn` row | **Fixed in PR 1** (`inapplicable`) |
| Include endpoint `inclusion-override/route.ts:111-130` | stored checklist | `force_include` allowed on an inapplicable field | **Fixed in PR 1** |
| Embedded pack page `packs/[packId]/page.tsx:502,546-559,940`, feed `app/api/packs/[packId]/route.ts:298` (`select *`, already includes `pack_json`) | raw stored rows, v1 fallback, stored score; counts recomputed client-side | **Yes**: row, count, % (and its own score and counts already disagree after an optimistic completion) | **Fixed in PR 1** (effective rows, v1 fallback closed, `merchantCompleteness`) |
| `SubmissionSidebar.tsx:52-57` "Evidence: N%" | stored score prop | different % from the effective one | **Fixed in PR 1** (mounted from the pack page; same function) |
| Gate/timeline text quoting the stored score (`auto_save_blocked`, `PACK_BLOCKED`) | stored score | "68% below 80%" beside a page saying 76% | **Fixed in PR 1** ("at build" label) |
| Portal pack page (`portal/packs/[packId]/page.tsx:248,347-357`), portal dispute page (`portal/disputes/[id]/page.tsx:622,697`) | v1 `checklist`, stored score, `/api/disputes/[id]` packs | **Yes**: a "Return Status" row, stored % | **PR 5** (same shared function; portal usage unmeasured: Phase 0 d) |
| Evidence-pack PDF (`renderPdfJob.ts:35,70`; `EvidencePackDocument.tsx:79`) | v1 checklist, stored score, "N blocker(s)" | "Completeness: 68%" and ✗ on "Return Status" | **PR 5** (generated on demand; not the bank letter) |
| Dispute-list chips (`api/disputes/route.ts:407-412`, `serverFacts.ts:124-129,195`) | `pack_json->case_assessment`; stored `checklist_v2` through `deriveConcreteContribution` | **Latent**, not live today: `canMerchantUpload` returns true for `no_return_initiated` only when the stored row carries `collectionType: "conditional_auto"`; the 6 open measured packs have none, but current templates stamp it (`completeness.ts:502,532`; 9 prod packs already carry it, 1 of them `missing`). A rebuilt pack with a return on record would show "add evidence" for a row the merchant cannot add. | **Fixed in PR 1** by the same field-level rule as F-1a: `no_return_initiated` becomes merchant-non-uploadable inside `canMerchantUpload` (it is never merchant-produced and is not in `FIELD_ACTIONS`; the return-request answer is its real channel), so the list can never show "add evidence" for it (§4.2) |
| Stored `unavailableReason` "No refund was issued on this order" (`completeness.ts:278,658`; `OverviewTab.tsx:1963`, `EvidenceBuilderSection.tsx:355`) | stored `checklist_v2` | **Yes**: beside the `recorded_no_amount` note on a zero/failed entry | **Fixed in PR 1** (read-time replacement, §3.3) |
| Strength reason `returned_unrefunded` (`returnedToSender.ts:100-112`) | refunded < disputed amount | **Yes**: "no refund has been issued" is false on a partial refund | **Fixed in PR 1** (copy only, §3.3) |
| Dashboard stats (`api/dashboard/stats/route.ts:102`) | pack count only | no | **Unaffected** (reads no checklist/score) |
| Evidence-needed / evidence-ready / pack-saved emails (`sendEvidenceNeededAlert.ts`, callers `buildPackJob.ts:583`) | section content (carrier proof, Gorgias review); header states it is "NOT from checklist field-presence" | no return/refund statement, no score | **Unaffected** (read from source; asserted in the matrix) |
| `PACK_CREATED` timeline "Score: N%" (`buildPackJob.ts:98`) | build-time score | historical record of what was true at build | **Unaffected**, kept "as built" |
| Admin metrics (`api/admin/metrics/route.ts:24`), intelligence registry | stored score | internal | **Unaffected** |
| Automation, deadline cron, `saveToShopifyJob`, `save-to-shopify/route.ts:70`, `reconcileParkedAutoDisputes` | stored score/readiness | not a display | **Out of scope by contract** (§2.1.5) |
| Bank path (`caseSelectionContext`, `buildDefencePackageJob:306`, `enqueue.ts:131`) | stored rows | not merchant-facing | **Unchanged**, asserted |
| Outcome email | `facts`, `who`, `next` | no | **Unaffected**, asserted in the matrix |
| CSV export | no checklist/score export found | no | **Unaffected: grep only** (the disputes CSV builder in `disputeListHelpers.ts` / `disputes/page.tsx` was not opened; Phase 0 d confirms) |

### 4.2 Lists: no assembler, no new column (decision after the final review)

Applying the assembler to the list means selecting `pack_json->sections`: **avg 16.8 KB, max 131 KB per pack vs 0.66 KB for the checklist (~25×)**; at the 100-row page cap that is about 1.7 MB per call. Rejected. A SQL jsonpath projection cannot replace the check because `sectionShowsReturnToSender` is TypeScript logic.

**Adopted: the list's only exposure is `canMerchantUpload`** (lists show no percentage and no return statement), so it is closed by the same **field-level** rule as F-1a: `no_return_initiated` and `refund_record` are never merchant-uploadable. This needs no migration, no backfill, no new query and no new column, and it makes the latent contradiction (R11) impossible regardless of how a pack was built. The `record_verdict` column below is **not planned**; it is kept here only as the fallback if a later measured list contradiction cannot be closed field-level.

*Fallback design (not planned):* persist one small column `evidence_packs.record_verdict` with **five** values `return_on_record | refund_on_record | returned_to_sender | no_return | unknown` (`NO_RETURN` and an absent status must stay distinguishable, or the merchant's answer cannot be reapplied correctly) and `null` for failed builds, computed in TypeScript by `noReturnFactVerdict` + the returned-to-sender composition, **written in the same build update as the checklist**, and backfilled for the latest pack of each dispute (about 446 prod rows) by an offline single-column update script (no rebuild, no `pack_json` rewrite). The merchant's answer and setting are applied at read time, not stored (so the column cannot drift with them). The list applies the applicability rule to the column before `deriveConcreteContribution`; the column rides in the existing narrow select (the select to extend is `serverFacts.ts:122`, ≈ 20 bytes per row). **The one open question** is reapplying the merchant's answer on the list: the answer is on `disputes`, so either the list's existing disputes select already carries it (to be confirmed in Phase 0 e) or the list ignores the answer for the `no_return` value, which can only make the row *visible* where read time would hide it (fail open, stated as an exception). **`merchantCompleteness` stays ONE isomorphic function** (§3.2); there is no second `effectiveCompleteness` function and no column path unless this fallback is ever adopted. Migration applied dev then prod with the DB-target guard (CLAUDE.md rules 0–1); the backfill is read-verified before and after.

---

## 5. Phases, dependencies, tests and release criteria

### 5.1 Phase 0 (read-only; PR 1 does not start until these are closed)

(a) How `evidenceLineItem` renders an `unavailable` row (`:1279`). (b) Whether `missing`/`unavailable` rows enter `plan_input_hash`. (c) `workspaceAssessment.ts`, `evidence/model/assessment.ts`, `completenessSnapshot.ts`, `useDisputeWorkspace.ts:578`. (d) Portal and PDF usage; the CSV builder; whether the v1 column can carry the filter. (e) Whether the list's attention counts this row. (f) Re-run populations with the real `hasReturnedToSenderShipment`. (g) Classify every `auto`/`conditional_auto` field in the registry by reading each collector's guard. **(h) The stored-vs-effective measurement over ALL packs (§3.2 item 4), with a threshold-crossing list per shop.** **(i) Render the real output of §3.3's verification set on current master (not source reading), including the `refundPresentation.ts:74` dependency (H).** (j) Count refund sections lacking a `refunds[]` array. (k) Per-pack measurement for acceptance 7: packs with ≥ 1 zero-amount entry and `totals.refunded == 0`.

### 5.2 PR sequence (each to `develop`, then `master` only on your in-chat go; no dispute is rebuilt or resubmitted)

| PR | contents | depends on | status |
|---|---|---|---|
| **PR 0** | merged `modeApplicability`; null-safe gate predicate; `returnScopeFor`; `noReturnFactVerdict`; collector parity; §2.4 parity suite | nothing | **Approved in principle** |
| **PR 1** | (PR 1 notes: the portal pack page shares the `/api/packs/[packId]` feed (`portal/packs/[packId]/page.tsx:155`), so PR 1 **adds** effective fields to that response and never overwrites `completeness_score`; the save check at `packs/[packId]/page.tsx:427` stays on the stored score; the pack page recomputes counts in the browser after an upload, so **`merchantCompleteness` is one isomorphic function** that the server calls on the assembled rows and the client calls on the same effective rows (no second function exists); the include endpoint and decided loader read `evidence_packs.response_cycle` (migration `20260927120000:53`) instead of adding a `disputes` query, which needs `response_cycle` added to the loader's pack select (`loadDecidedResponse.ts:186`); that loader also runs in `disputeEffectsDispatcher` and `sendOutcomePostedAlert`, so the extra answer/setting reads add queries to the webhook path and are measured in Phase 0.) `OrderContext.noReturnFact`; `FIELD_PRECONDITIONS`; `emissionClassification.ts` + classification, cross-validation and collector-parity tests; reconcile option; assembler + brand; consumers: workspace route, decided loader/view, embedded pack page + its API route (v1 fallback closed), `SubmissionSidebar`; include-endpoint guard + normaliser fix; `refundStatement.ts` + its consumers; F-1a (copy, upload affordance); `merchantCompleteness` and the "at build" labels; copy ×6; `docs/technical.md`; help article if merchant-visible | PR 0; Phase 0 (a)–(k) | **Not approved** |
| **PR 2** | return banner on the decided Overview and Evidence (re-read the design first, rule 8) | PR 1 | Not approved |
| **PR 3** | raw-read scan as a vitest with a checked-in, reasoned baseline (**no `ci.yml` change**: the ratchet token was by its own description not a guard; the baseline diff is reviewed in the PR) | PR 1 | Not approved |
| **PR 4** | *(withdrawn: lists are closed in PR 1 by the field-level `canMerchantUpload` rule, §4.2; numbering kept so references stay stable)* | | |
| **PR 5** | portal pages + PDF onto the single `merchantCompleteness` (server-side assembler output; no column path) | PR 1 | Not approved |
| **F-1b** | `refund_record` applicability for CNP (read time first) | the decision in §3.1 | **Gated on the maintainer** |
| **B1** (later, measured) | build-time `orderContext.noReturnFact`; transaction-status persistence is separate | PR 1, Phase 0 (b), crossing query | Not planned yet |

**Rollback.** PR 0 and PR 1 persist nothing new: a plain revert. PR 0 touches a bank-adjacent collector (parity evidence is its safety case); PR 3 adds a vitest scan whose baseline can block unrelated merges if it is wrong (revert independently). No PR adds a column or touches `ci.yml`.

### 5.3 Red → green → mutation (one working branch per PR, evidence preserved)

Red tests travel **only with the PR that fixes them** (PR 1); PR 0 carries parity-only evidence and is never red. (1) Commit 1: tests only, against stable entry points on master (route handler, decided-view builder, line-item builder, collectors); record the failing run, which must fail on assertions about the bug (not on a missing module and not on missing i18n keys). (2) Commit 2: the implementation; record the passing run. (3) Mutation: for each consumer inject the no-op and, separately, remove the field-table entry; record each red. (4) The merged PR is the squashed result with all required checks green; the three recorded runs go in the PR body. No failing CI is ever merged.

### 5.4 Tests

- **Oracle:** about 50 hand-written representative cells covering every case in §2.7 and every verdict reason; the full grid (`returns × refund × template × stored row × shape × override × reason × {live, decided}`) is checked only by **properties** (with a return on record no consumer emits a "no return" claim; `unknown` leaves output unchanged; the effective checklist is idempotent).
- **Real-assembly matrix:** the production handlers run (workspace route, assembler, line-item builder, decided-view builder fed by the real loader, include endpoint, pack API route) against a Supabase stub that supplies **only data** and **throws on any column not selected**, using rows captured from #24612/#24510/#24599 plus synthetic ones (PII stripped); client-side counts get a component-level test. **Stated limit:** the workspace route uses `.select("*")` for `disputes`, `evidence_packs`, `evidence_items`, `argument_maps` (`route.ts:199,220,250,260`), where every column counts as selected; strictness bites only on explicit-column selects (`serverFacts`, the decided loader, the endpoint); the oracle cells carry the check elsewhere.
- **Cross-consumer test on production assembly paths:** for the verification set (§3.3) and the 30 packs, every surface in §4.1 marked Fixed is rendered/derived through its real path and asserted to make **one** return statement, **one** refund statement and **one** percentage (the stored percentage appears nowhere but labelled "at build").
- **Per-consumer mutation, feasible form:** Next 15 rejects non-route exports from `route.ts` and the workspace route is a 1,362-line inline `GET`, so the plan extracts **two small modules**: `assembleWorkspaceChecklist(…, deps)` (at the assembler site, `route.ts:544`) and `handleInclusionOverride(req, params, deps)` (217 lines), each taking the applicability function as an injected dependency with a production default; the decided loader takes `inapplicableFields` the same way. The mutation test calls each extracted function with a no-op dependency and asserts that consumer's slice fails; one smoke test per consumer also runs the real exported handler. (`vi.mock` is rejected for attribution, not isolation: the workspace route calls both reconcile and `loadDecidedViewInputs`, so a red result could not be attributed to one consumer.)
- **Planted-bypass meta-test:** a temporary consumer written into the scanned roots as a string-literal read, a **property read `order.returnStatus`** and a destructured read; the scan must fail on the first two (the third is listed as residual if the scan cannot see it).
- **Raw-read scan:** string literals (`"no_return_initiated"`, `"noReturn"`, `"returnStatus"`), property access to `returnStatus`, `.select("…checklist_v2…")` in merchant-facing roots; baseline = checked-in list **with a reason per entry**. **Baseline:** a checked-in list with a reason per entry, reviewed as a diff in the PR; there is no `ci.yml` change (a PR-body token ratchet was dropped as not a real guard).
- **Registry by data dependency:** any module under the roots that selects `checklist_v2`, imports `reconcileChecklistWithCollectedFields` or `buildEvidenceLineItems` must be listed with its disposition.
- **Branded `EffectiveChecklist`, an aid only:** `getServiceClient()` is untyped (`lib/supabase/server.ts:12`), so `any` assigns to the brand; `.filter`/`.map` drop it; on the client it is a declaration; shared helpers (`caseStrength`, `whyThisCaseWins`, `riskExplanation`) serve the bank path and keep accepting plain `ChecklistItemV2[]`; write routes read raw `checklist_v2` on purpose. The brand symbol is not exported; the only producer takes `unknown`; a vitest source scan (not typed ESLint: this repo's flat config has no `parserOptions.project`) fails on `as EffectiveChecklist`.

### 5.5 Release criteria (objective)

1. The oracle cells and properties pass; the planted string-literal and property-read bypasses fail the scan; **per-consumer mutation is red for every registry entry whose disposition is "consumes assembler/authority"** (baselined left-alone modules `factPredicates`, `alwaysAdmissible`, `noReturnCountsForStrength` are exempt and listed); red/green/mutation evidence attached.
2. #24612, #24510, #24599 in sv: the return appears once as neutral information on Overview (live and decided), Evidence and Review; none of the sv strings for `no_return_initiated`, `checklist.item.noReturn` or the generic not-included reason; Overview "Not included" = rows on Review; the embedded pack page shows effective rows and no raw v1 fallback; **the `refund_record` row on these three** (missing, critical, beside the `recorded_no_amount` banner on #24612 and #24510; the no-refund-section shape on #24599) **remains, shows no upload button, shows the neutral reason, and no tab says "no refund" while another says a refund entry is recorded.**
3. **Unchanged, asserted:** the 204 pre-stamp `available` rows and the 6 pre-stamp `missing` rows without a refund; `unknown`/null situation in every consumer; for fixed disputes `plan_input_hash`, `facts_json`, letter, PDF, stored `completeness_score`, `submission_readiness`, stored `checklist_v2`. **Deliberate exceptions, listed and counted:** the displayed percentage on the packs where stored ≠ effective (the 30 measured packs plus the population measured in Phase 0 h); merchant refund copy for refund sections lacking `refunds[]`; a read-time verdict that differs from build-time emission after the setting or answer changed; the 3 pre-stamp processed-refund drops.
4. The 23 + 4 return/returned-to-sender rows and the 3 pre-stamp processed-refund rows are dropped; the 2 null checklists and a `{items}` fixture are handled without throwing; malformed sections do not throw.
5. The classification test is **red if the `refund_record` or `no_return_initiated` entries are removed**, red for any `auto`/`conditional_auto` field added without a class, and red when the count of written reasons exceeds its baseline; the collector-parity test fails when `FIELD_PRECONDITIONS['no_return_initiated']` is mutated; the `status_absent` case asserts *collector silent, row applicable*.
6. `force_include` on an inapplicable field → the distinct code; the override is retained.
7. **Refund statement:** per pack (not per entry), the packs with ≥ 1 zero entry and `totals.refunded == 0` (Phase 0 k) resolve to `recorded_no_amount` (packs that also hold a positive entry resolve to `some`); the six-case matrix passes through every consumer; the rewritten `refundRecord.notIncluded` and `disputes.refundStatement.*` strings exist in all six locales and the old sentence is gone; no "no refund" string exists outside the namespace; `refundStatus`, facts, `hasRefund`, `fatalLoss`, letters and PDFs unchanged.
8. `noReturnFactVerdict`/`returnScopeFor` parity grids prove `orderSource` emission and fact data unchanged; `packShowsReturnOrRefund` returns today's boolean over every persisted shape after becoming a wrapper (an unrecognised status is `return_on_record`, so the wrapper returns true there; there is no separate `status_unrecognised` reason).
9. F-1a: for the 75 packs the stored score, `checklist_v2`, facts, hashes and letters are unchanged; no upload button on the CNP no-refund row.
10. The raw-read scan fails on an unbaselined read and every baseline entry carries a reason; the planted-bypass meta-test is red without the scan.
11. `tsc --noEmit`, `npm test`, i18n parity, `npm run build`, `npm run release:verify` green; render check on prod data at 393/375/320 and desktop.
12. **Project completion:** PR 1, 2 and 5 merged; the cross-surface matrix green for the verification set; every row of §4.1 either Fixed or Unaffected with evidence; F-1b decided (applied or explicitly declined, with the reason recorded in §3.1).

---

## 6. Review record

- Earlier rounds (1–7) are summarised by their outcomes: the Draft 2 design was rejected on source inspection (§1); rounds 3–6 moved the precondition to the collector's own verdict, made it three-state, composed returned-to-sender, found the `packShowsReturnOrRefund` twin, replaced the generated oracle and `vi.mock` mutation with hand cells, injected dependencies and extracted modules, reconciled the classification with `canMerchantUpload`, and turned `refund_record` from a mechanism case into F-1. Round 7 (Architect: approvable with conditions; Critic: iterate) produced the unrecognised-status rule, the per-reason parity test, the corrected `canMerchantUpload` cross-validation, the `returnScopeFor` signature, the missed pack-API caller, the red/green split per PR, the per-pack acceptance unit, the narrowed mutation criterion, and the rollback note; all are integrated above.
- **Final focused review (this document), run once, 2026-11-05.**
  - **Architect: APPROVABLE WITH CONDITIONS.** PR 0 confirmed behaviour-preserving against `origin/master`. Blocking, all resolved in the text: B1 F-1a cannot live in the row builder (`canMerchantUpload` governs the button in nine places and the list) → now a field-level rule inside `canMerchantUpload`; B2 `none` refund wording did not fail closed (absent amount is `unknown`) → fixed; B3 verdict input shape described three ways and acceptance 8 named a non-existent reason → one `returnScope` input shape, reason removed. Optional, taken: new "No return initiated" title key, portal shares the pack API feed (add fields, never overwrite the score), `response_cycle` from the pack, five-valued column (now only a fallback), "112" reworded.
  - **Critic: ITERATE (two document-level blockers), now resolved.** B1 two missed "no refund" consumers (stored `unavailableReason` at `completeness.ts:278,658`; strength reason `returned_unrefunded`, false on partial refunds) → added to §3.3 and §4.1, fixed in PR 1; B2 the merchant percentage was described four ways → one isomorphic `merchantCompleteness`. Cuts taken: no `record_verdict` column/PR 4 (lists closed by the field-level rule), no `ci.yml` change, PR 5 depends on PR 1 only. Listed as deliberate exceptions: `refund_record` non-uploadable also changes PRODUCT_UNACCEPTABLE `recommended_actions` and the improvement hint. Not taken: dropping the emission registry (cheap, kept).
  - **Disagreements recorded, not forced:** the Architect's earlier antithesis (two read-time predicates would be smaller) and the Critic's view that deferring F-1b is partial deferral both stand (§7 R3, R4). The Critic's remaining optional point: add a cycle test for a reopened dispute (answer for the current cycle at build vs `packCycle` at read) to PR 1's tests.
  - **This final text, after the two sets of fixes, has not been re-read by either reviewer.** By your instruction no further review round was run.

## 7. Residual risks and unresolved objections

- **R1. Narrowed, not closed.** The classification forces a decision per field but cannot verify it; undeclared collector guards, SQL/views/scripts, dynamic field names, the client, fact-presence readers and surfaces outside the registry escape. The completion point (§4) covers the inventoried merchant surfaces; a new independent interpretation is made *hard to add unnoticed* (scan, registry, reasoned baseline), not impossible.
- **R2. Parity by construction.** After PR 0 the collector and the authority call the same verdict; the parity test catches wiring/table mutations, not a wrong verdict; only the hand-written cells catch that.
- **R3. Bank-adjacent extraction.** Extracting the verdict touches the collector (PR 0). Mitigation: byte-identical parity grids; no consumer changes in PR 0; plain revert. **Unresolved objection (Architect):** two read-time predicates would fix every measured row with a smaller change; the extraction is chosen because it keeps collector and checklist from diverging, at this stated cost.
- **R4. F-1b.** Until decided, 63 packs stay below their threshold because of a row that cannot be satisfied; the truthful copy (F-1a) does not change that. The classification registry carries `refund_record` as `needs_decision`. **Unresolved objection (Critic):** deferring the score effect is partly deferral of the same class; recorded, with the decision owner and prerequisites in §3.1.
- **R5. Display change beyond the 30 measured packs.** `merchantCompleteness` moves the displayed percentage on packs where reconcile already diverged from the stored score; measured in Phase 0 h before PR 1.
- **R6. Unrecognised status.** Treated as `return_on_record` (0 packs); `status_absent` is applicable while `status_unrecognised` is a return on record: a deliberate difference.
- **R7. Setting drift.** Read time uses the current `returns_outside_shopify` and answer; a changed setting can differ from build-time emission.
- **R8. Transaction status not persisted.** Pending/failed/settled cannot be told apart historically; the copy claims only what is recorded. Persisting `refunds[].transactions[].status` is a separate plan after the `plan_input_hash` question.
- **R9. One merchant supplies most of the measured population** (23 of 30 on one shop); other templates and merchants are covered by tests, not by population.
- **R10. A contradicted `available` row** is kept and logged (`contradictedAvailable`) but, in PR 1, not rendered as a visible flag (0 observed; §2.7's "flagged" means logged and returned by the assembler); stored facts are not corrected (bank-facing).
- **R11. Latent list contradiction** (current templates stamp `conditional_auto` on `no_return_initiated`) is closed in PR 1 by the field-level `canMerchantUpload` rule; no live occurrence existed.
- **R12. Outcome cause** (73% of recent wins have no DisputeDesk evidence; refund-closed inquiries; `recovered` overstated) stays in `decided-outcome-cause.plan.md`. The maintainer asked for it to be part of the effort; it is split because it adds a column, event parsing and a stats redefinition. This is recorded as an unresolved disagreement.
- **R13. Other domains** (delivery ×10 readers, 3DS presence, two-clock fulfilment) remain backlog.
- **R14. Not rendered.** Section 3.3's matrix is read from source; Phase 0 i renders it before PR 1.

---

## 8. Phase 0 results (2026-11-06, prod `aokhplydttxtebvbeuzc`, read-only, latest pack per dispute, 448 packs)

Method: `npm run db:query:prod -- --read-only` (guard ran per command); effective % computed by the real `reconcileChecklistWithCollectedFields` + `noReturnFactVerdict` + `deriveCompletenessMetrics`. Scripts: `scripts/sql/_phase0_*.sql` (uncommitted).

- **(b)** Missing/unavailable checklist rows do **not** enter `plan_input_hash`. The hash covers candidates (from `CaseEvidenceModel` records) and `reviewItems`, and both persisted-hash paths pass `reviewItems: []` (`buildDefencePackageJob.ts:424`, `caseSelectionContext.ts:165`). Applicability changes therefore cannot stale a defence package.
- **(h)** 447 packs, 2 with null/unparseable `checklist_v2`, 445 scored. Stored column vs re-derived stored checklist differ on 25 (score edited after build). Stored -> reconciled (existing behaviour, not PR 1) differs on 55. **Reconciled -> effective (the PR 1 effect) differs on 26 packs**: 23 `won`, 3 `needs_response`, all pack status `ready`; delta +8 to +11 points; **0 crossings of 80** (reconciled vs effective, and stored column vs effective, among those 26). Whole-population stored column vs effective: 15 crossings, **all driven by reconcile or post-build edits, not by PR 1**; 14 are on filed/closed disputes and 1 (e5da0042 / 535efddc) is on an archived pack with a `needs_response` dispute (col 67, effective 89). 12 packs move by more than 10 points (stored -> effective), 9 of them from reconcile alone. Changed by shop (stored -> effective): e5da0042 33, d595d90a 23, 6648353c 22, c497df8d 3.
- **(i)** Real output on the verification set: #24612, #24510 (RETURNED, zero entry): verdict `return_on_record`, stored `no_return_initiated=missing`, refund line renders **"No refund issued"** with no amount, i.e. the contradiction with the return banner is reproduced. #24599 (IN_PROGRESS, no refund section): verdict `return_on_record`, no refund line (null). #104499, #24215 (NO_RETURN + zero entry): emit; "No refund issued | The customer never initiated a return". All eight pre-stamp packs (#100017, #92719, #96919, #98483, #99413, #99445, #99511) have `returnStatus` null: verdict `unknown`, stored row `available`, refund line "No refund issued" (#99445 has two zero entries). `refundPresentation.ts:74` is reachable from section data (zero entry) and is what renders "No refund issued" today. Failed / later-successful / pending / transaction-less cannot be told apart in stored data (as stated in 3.3).
- **(j)** Refund sections lacking a `refunds[]` array: **0 of 35**. Order sections lacking `totals.refunded`: **0 of 404** (44 packs have no order section at all; 247 order sections lack `returnStatus`, the pre-2026-10-02 stamp gap).
- **(k)** Packs with >= 1 zero-amount refund entry: **26**; of those with `totals.refunded == 0`: **25**.
- **(f)** Real returned-to-sender predicate over latest packs: 13 packs. 5 are `NO_RETURN` (gate-suppressed: 4 row `missing`, 1 no row); 8 have null `returnStatus` (verdict `unknown`, so no PR 1 effect). Other `no_return_initiated` rows: NO_RETURN available 123; null-status available 204; IN_PROGRESS missing 20; RETURNED missing 3; null-status missing 5.
- **(a)** `evidenceLineItem` is a derivation module (`lib/argument/evidenceLineItem.ts`), not a render function. The Overview "Evidence collected" list filters `unavailable` rows out (`OverviewTab.tsx:1677`, coverage `:989`), so the stored English `unavailableReason` caption (`:1962-1963`) is unreachable there; `lib/argument/evidenceStatus.ts:64-66` renders "Not included" for `unavailable` as hard-coded English. The embedded pack page maps `collectable === false` to `unavailable` (`packs/[packId]/page.tsx:554-558`) and the display of the reason there was not traced. Correction to 3.3 item (i): the stored reason is shown on a path not yet confirmed; confirm in PR 1 before relying on the "read-time replacement" claim.
- **(c)** `workspaceAssessment.ts:151-156` counts only `missing` rows (blockers, critical gaps) and ignores `unavailable`; `completenessSnapshot.ts:149-156` reads the persisted `completeness_score` (gate); `useDisputeWorkspace.ts` reads the checklist only for toast labels, optimistic `completedFields`, and `deriveMissingItems` (`missing` + `canMerchantUpload`). `assessment.ts` `completenessChecklistFromModel` already emits `unavailable` for non-applicable fields. No file special-cases `no_return_initiated`.
- **(d)** Portal pack page `:248` and dispute page `:622,:697` show the stored `completeness_score`; the PDF cover prints it (`EvidencePackDocument.tsx:78-79`) and its checklist has only `present` (no unavailable/missing distinction). No "Return Status" text in portal or PDF code. The disputes CSV (`disputes/page.tsx:441-533`) has no completeness or checklist columns: **Unaffected**.
- **(e)** The list's attention counts do not use `completeness_score` or the row: `merchant_action_required` = blocking/requested attention reasons; a missing `no_return_initiated` row can only make `concreteContribution` "recommended", which is not in the counted set. **Unaffected.**
- **(g)** Auto/conditional_auto fields and their no-emit guards are tabulated in the agent report; the only field whose guard is a verdict is `no_return_initiated`. `refund_record` emits an empty `fieldsProvided` when the total is <= 0 (consistent with F-1). `tds_authentication` and `device_session_consistency` `collectionType` were not examined.
- **Webhook-path queries:** `loadDecidedViewInputs` is called from `disputeEffectsDispatcher.ts:565`. Adding the answer and setting reads there costs +1 settings read and +1 confirmation read (the latter only when `returns_outside_shopify` is on); `response_cycle` comes from the pack select, so no `disputes` query is added.

**Remaining PR 1 blockers after Phase 0:** none of (a)-(k) blocks PR 1; two items are open inside PR 1: (1) confirm how the embedded pack page displays `unavailableReason` (a); (2) the 1 archived-pack crossing is outside PR 1's effect and needs no gate. The maintainer decision on the 15 reconcile-driven stored-vs-effective gaps (stored column is stale on 25 packs) is a separate item from PR 1.

**Done when:** `rawReadScan.test.ts` has no `open` baseline entries for the return/refund patterns, `refundStatement` is read by the dispute page (`ownerCoverage.test.tsx` > `dispute.refundStatement is read`, no `.fails`), and `completenessModeParity`, `orderSourceNoReturnParity` and `noReturnFactVerdict` stay green.
