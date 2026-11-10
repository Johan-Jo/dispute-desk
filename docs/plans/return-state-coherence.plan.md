# One story about the return, on every tab of the dispute page

> **SUPERSEDED (2026-11-05) by `docs/plans/single-source-architecture-audit.plan.md` (Draft 2).** Kept for the evidence in §1 and the review record. Do not implement from this file: its `orderSituationRows.ts` post-processing and relabel option were rejected there (§6).

**Status:** DRAFT 2.2 (2026-11-05), ralplan, **pending approval; nothing built**. Draft 1: Architect + Critic (ITERATE). Draft 2: Architect (endorse with edits). Draft 2.1: Critic (ITERATE, six changes). This draft applies all of them (§11); the row design is now option R (relabel in place), with S and G kept as D-1 alternatives. Nothing here is built. **Follow-on to** `docs/plans/order-situation-drives-dispute.plan.md` (rev 7): that plan made the return a merchant-visible fact (Phase A, in prod) and defined the consequences table (Phase B, pending). This plan closes the gaps on the *rendered page*, found on a real case.
**Trigger:** whj8db-1q order #24612, dispute `2903f245-aabf-402f-920f-c22a711bdc71` (Klarna inquiry, credit not processed, 618 SEK, **won 2026-11-04**, DisputeDesk filed nothing). The maintainer, reading the page in prod: the Review tab says a return was received and, further down, "No return initiated"; Overview and Evidence "don't even mention" it. "This is really mixed up."
**Code references:** `origin/master` at `87a86683`.

## 1. What is established

### 1.1 The case

Shopify `Order.returnStatus = RETURNED`, return created 2026-10-27, `totals.refunded = 0.0`. Same shape on #24510 (RETURNED) and #24599 (IN_PROGRESS), also won 2026-11-04. All three: `auto_save_blocked` (Weak), package `skipped / no_bank_eligible_facts`.

**Why it was won (read-only, live Shopify, 2026-11-05).** The store **did refund**, before the inquiries were decided. #24612: return created 10/27; 11/03 14:26 the merchant processed the return and refunded 479 of 618 SEK ("A kr479.00 SEK refund is pending", then the order's `refunds[]` shows an entry of **0.0**); inquiry opened 11/04 10:15; **11/04 14:37:59 "kr479.00 was refunded to Klarna for return #24612-R1"; 14:38:13 "An inquiry totaling kr618.00 was resolved in your favor. No money will be taken."** Fourteen seconds. Same sequence on #24510 (1,230 of 1,368; closed 14:52:48, 14s after the refund reached Klarna) and #24599 (829 of 899; 14:52:23). Nothing DisputeDesk did or didn't do won them: the inquiry closes when the refund lands at Klarna. **Consequence for this plan:** our pack said "refunded 0.0" / "No refund has been issued", which was **false**: Shopify reports `totalRefunded` as 0.0 while the refund is *pending* and records the refund as a 0.0 entry. `OrderSituation.refund` therefore read `none` on a refunded order (the 0.0 entry is in the pack: `refunds[].amount = "0.0"`, `precededDispute: true`). See S8 and §4.5.

### 1.2 What each surface says about the return today (verified against the code, both reviewers)

| # | surface | what it says | why | where |
|---|---|---|---|---|
| S1 | Review & forward | Banner: "return received". | `OrderSituationNote` mounted here (Phase A). | `ReviewSubmitTab.tsx:110` |
| S2 | Review & forward, Inclusion review | Row **"No return initiated — Field is on file but no usable evidence payload was emitted — Data lives outside DisputeDesk"** under *Not included*. Three false statements: the field is not "on file", "no return" is the opposite of the record, and the data does not live outside DisputeDesk (it is Shopify's `returnStatus`). | Checklist field `no_return_initiated` stays `missing`; `deriveEvidenceLineItems` does not skip `unavailable` rows, so it falls to `not_included`; `REASON_OVERRIDES` has no entry for the field, so it gets the generic reason; the callout renders for any `notIncluded` row that cannot be force-included. | `evidenceLineItem.ts:438-510, 1279, 1672-1716`; `InclusionReviewSection.tsx:439` |
| S3 | Evidence tab | **The same contradictory row**, through the line-items-only fallback. No banner. | `EvidenceUsedSection` renders the line items; the tab never mounts the note. | `EvidenceUsedSection.tsx:245-256`; `EvidenceTab.tsx` |
| S4 | **Overview of a decided dispute** | No banner **and a "No return was received" item listed as *missing*** in the decided "what wins" checklist. | `WorkspaceShell` returns `DecidedWorkspace` whenever `data.decidedView` is set; its checklist is `decidedView.ts:357,365` (`had("noReturn", c.has("no_return_initiated") || …)` for the refund and product families). With a return on record the fact is never emitted, so the item reads missing. | `WorkspaceShell.tsx:251-270`; `decidedView.ts:305-365`; `DecidedWorkspace.tsx:530-565` |
| S5 | ~~Outcome email~~ | **Removed after re-review**: `sendOutcomePostedAlert.ts:791-805` builds the view but never reads `view.checklist`. The email is unaffected. | | |
| S6 | Inclusion review, refund-record row | "No refund has been issued … your defence is that no refund was owed, not that one was already paid." Situation-blind: it is written for an order with no return and is shown unchanged with one. | `REASON_OVERRIDES.refund_record.not_included`. | `evidenceLineItem.ts:489`; `messages/en.json:2060-2062` |
| S8 | **The refund state itself is wrong.** The banner and the refund row say "No refund has been issued" while a refund was pending (and, by decision time, paid to Klarna). | `resolveOrderSituation` derives `refund` from `totals.refunded` only (`orderSituation.ts:90-94`); Shopify reports 0.0 for a pending refund. The order section's `refunds[]` carries the pending entry with amount `"0.0"`. | `orderSituation.ts:88-95`; `orderSource.ts:240-256` |
| S7 | Live Overview (non-decided) | Banner is shown (Phase A). Unaffected. | | `OverviewTab.tsx:1587` |

Draft 1 said the decided Overview and the Evidence tab "say nothing". That was wrong: they say the **opposite** (S3, S4), which is what the maintainer is reacting to.

### 1.3 Facts that constrain the design

- One server producer feeds all tabs' line items: `workspace/route.ts:1114-1142` (`deriveEvidenceLineItems`). Every consumer reads the same `evidenceLineItems` array: the route's `submissionSummary.counts` (`:1167-1187`, which has **no** not-included count), and, in the browser, the Overview "Not included" number (`OverviewTab.tsx:2310-2320`), `SubmissionSummaryPanel` (`:297-324`) and `EvidenceUsedSection`. So any change must be made to that array **before it is sent (before :1167)**; the drift class is documented at `EvidenceUsedSection.tsx:233-240`. A second producer exists: `lib/demo/fixtures/workspaceData.ts:255,283`.
- Some tabs also read the checklist directly (`useEvidenceSections.ts:909-1072`, `OverviewTab.tsx:1675`, `deriveMissingItems`). A transform on line items alone does not reach them.
- **The include endpoint does not refuse.** `inclusion-override/route.ts:97` blocks only `INTERNAL_ONLY_FIELDS` and `:131` only checks the field is in the checklist; `canBeForceIncluded` is never consulted server-side. A POST of `force_include` on `no_return_initiated` succeeds and the row then resolves to `context_only` ("in PDF"), `evidenceLineItem.ts:1188-1195`.
- Phase B step 3 (rev 7) makes the field `unavailable`; that alone changes nothing visible (S2: `unavailable` rows fall through to `not_included`), and only for builds after release. A decided pack is never rebuilt.
- Reuse, add nothing new: `lib/disputes/orderSituation.ts` (`resolveOrderSituation`, `orderSituationFromPackSections`, `hasReturnOnRecord`), `dispute.orderSituation` + `asOf` in the payload (`workspace/route.ts:501`), `OrderSituationNote` copy in six locales.

## 2. Root cause

The return is derived once but its *meaning on a row* is decided in four places that Phase A did not touch: the line-item builder's per-field reasons, the decided-view checklist, the Evidence tab's own bucketing, and the include endpoint. Each is situation-blind, and each can contradict the record.

## 3. RALPLAN-DR

**Principles**
1. One derivation (`orderSituation`); one pure module turns it into the *checklist/row consequence*. No component forms its own return sentence.
2. A row never asserts the opposite of the record. Where a checklist field ("no return") and the record ("returned") disagree, the record wins.
3. Merchant-only and **neutral**: no new bank-facing fact, no letter change; and no copy that frames the return as adverse, blames the customer or the merchant, or says anything about the strength of the merchant's defence either way (counsel stance).
4. Read-time, not rebuild-time: stored and decided packs become coherent with no rebuild, no LLM call and no email.
5. Say what is known, from which source and as of when; `unknown` says nothing.

**Decision drivers:** (1) works for decided/stored packs; (2) fixes the class, so every consumer of the row agrees, counts included; (3) zero blast radius on the bank path.

**Options**
- **A. One pure module in `lib/disputes`, applied at read time** to (i) the line items in the workspace route before the counts, (ii) the demo fixture, (iii) the decided-view checklist, (iv) the include endpoint's guard; plus mount the existing note on the two tabs without it. *(Chosen.)* Pros: one rule, all consumers; no rebuild. Cons: a transform after the builder is a second place that edits rows, so it needs the invariant test below.
- **A′. The same rule inside `deriveEvidenceLineItems`** (precedent: `collapseDeliveryRows`, `planExclusionTokenForField`). Cleaner (one producer, reaches the demo fixture and every caller), but needs rev 7 Phase B step 0 first (the Phase A import test forbids `lib/argument` importing `orderSituation`). **Follow-up:** move the rule into the builder as an input once step 0 lands.
- **B. Per-component patches.** Leaves counts wrong and repeats the instance-patching the maintainer's rule forbids.
- **C. Wait for Phase B and rebuild.** Never reaches decided disputes; Phase B step 3 does not change S2 as shown; rebuilds can email merchants.
- **D. Put the return into the pack as a section/fact.** Risks exposing an adverse fact to the bank; rejected by principle 3.

## 4. Design

### 4.1 The module: `lib/disputes/orderSituationRows.ts` (new, pure, no English strings)

`applyOrderSituationToLineItems(items, situation)`, pure and free of server imports. Identity when `situation` is null or `unknown`, or when no return is on record. **Keyed on the field and on nothing else** (not status, not method), so it also catches a row that is `unavailable`, `missing`, or already force-included by a stored override.

| field, when `hasReturnOnRecord` | today | after (recommended, D-1 option R) |
|---|---|---|
| `no_return_initiated` | "Not included" row, generic reason, outside-data callout, label "No return initiated" | **Relabelled in place from the record**, same group (*Not included*), so it stays in the list the merchant audits, counted once: `displayLabelToken` "Return recorded in Shopify" and a neutral reason token stating the source and status ("Shopify records this return as {received / open / requested / failed}. It is shown to you only and is not part of the package."); `canBeForceIncluded: false`; and a row-level flag `recordOnly: true` that `InclusionReviewSection` reads to **not** render the outside-data callout (the callout is today gated on `!canBeForceIncluded`, which would otherwise still fire: `InclusionReviewSection.tsx:439`). The one new field on the line item; no new group, no new design. |
| `refund_record`, `refund = none` | "…your defence is that no refund was owed…" | reason token `refundRecord.noRefundOnOrder`: "No refund has been issued on this order." and **nothing about the defence**. `refund = some` or unknown: unchanged. |

Why not "Kept internal": its group copy is "Signals that may weaken the case if surfaced to the bank" with the pill "Hidden from bank" (`en.json:1942, 1949`); on a won case that reads as "your return hurt you and we hid it". Why *Not included* is acceptable: its helper is neutral ("in the file but not in the package"); its cost is the "Excluded" tag, which the maintainer should see rendered before approving (D-1). **Fallback if the maintainer rejects it:** suppress the row from the line items (then the Evidence view model must skip it, since `bucketForRow` treats a *missing* item as "not loaded yet": `EvidenceUsedSection.tsx:66-85`; the skip needs `rowConsequence(orderSituation, field)` in the browser, so the module stays import-safe in the client, asserted by the invariant test).

Never read by the letter, PDF, `isBankIncludedFact`, evidence-basis rows or `plan_input_hash`. A structural test asserts none of those import it.

### 4.5 The refund state must stop saying "none" when a refund is pending (S8; must precede PR 1's copy)

`RefundSituation` gains `"pending"`: `totals.refunded` is 0 **and** `refunds[]` holds at least one entry (any amount, including `"0.0"`). `none` stays for "no refund entry at all"; `unknown` stays for absent data. `hasReturnOrRefundOnRecord` and `shopifyRecordsReturnOrRefund` count `pending` as a refund on record (they are the same predicate by the parity test). Banner copy: `refund.pending` = "A refund has been started on the order and is not yet settled." and the refund-record row says the same instead of "No refund has been issued". **Needs a probe before PR 1:** confirm on the three stored packs, and on 2 other shops' pending refunds, that a pending refund always appears as a `refunds[]` entry with amount "0.0" (they do here), and what `refunds[]` looks like when the refund settles, so `pending` is not shown forever. Consumers that read a raw refund amount (`creditTiming.ts`, `fatalLoss.ts`, `returnedToSender.ts`) are **not** changed by this plan; whether they should treat a pending refund as covering the dispute is a separate decision (it affects fatal-loss and the Weak verdict, and so what gets filed), listed in §10.

### 4.2 Where it is applied

1. `workspace/route.ts`: between `:1114` (items built) and `:1167` (counts), so the summary counts, the Overview "Not included" number and the Evidence list agree. Same for `lib/demo/fixtures/workspaceData.ts`.
2. `decidedView.ts`: the `noReturn` checklist item is **omitted only when it would otherwise read missing** and a return is on record (at `:357,365` it also counts as "had" via `returned_parcel_outcome`; that legitimate "had" is kept; test: return on record + `returned_parcel_outcome`). `buildDecidedView` runs in the browser (`DecidedWorkspace.tsx:142`); its inputs come from `loadDecidedViewInputs` (`loadDecidedResponse.ts:175`, which already selects `pack_json` at `:191`). So `DecidedViewInputs` (`decidedView.ts:44`) gains an **optional** `orderSituation`, filled in the loader with `orderSituationFromPackSections`. **One source for the banner and the checklist:** the decided banner reads the same `orderSituation` the loader returns (not a second derivation from the workspace route's own pack row at `route.ts:501`); a test asserts that for a fixed decided dispute the workspace payload's `dispute.orderSituation` and the loader's value are equal, and the open question "can the route's pack row and the loader's newest `evidence_packs` row differ for a decided dispute?" is answered in the audit before PR 1; optional keeps every existing fixture (`decidedView.test.ts:66`) unchanged. Stated side effect: the "had / N" coverage line (`DecidedWorkspace.tsx:152,548`) drops from N=4 to 3 for refund and product cases with a return; no scoring reads this checklist.
3. `inclusion-override/route.ts`: reject **only** `force_include` for `no_return_initiated` when the pack's order section shows a return on record, with a distinct error `code` (not `OVERRIDE_NEEDS_CONFIRMATION`), placed **after** the pack load (`:110-118`; `pack_json` is already selected at `:111`). Code only, no six-locale copy: the only caller (`useDisputeWorkspace.ts:897-915`) ignores the body. `force_exclude` on a hidden row is harmless and unchanged. Server-side; the button is already hidden.
4. **Evidence-tab fallback.** Under option R the row stays a line item, so `bucketForRow` finds it and the "not loaded yet" fallback never applies. (Only the suppression fallback in §4.1 needs the skip.)
5. The notes (§4.3).
6. The route's post-builder step is one pure helper shared with the demo fixture, so the data-level invariant (§7) tests one function, not two copies.

No change to `REASON_OVERRIDES` text for any situation-less case: a store with no return, or `unknown`, reads "No return initiated" exactly as today.

### 4.3 One component, two more mounts

`OrderSituationNote` already renders the merchant-only banner (copy in six locales). Mount it:
- **Decided overview**: in `DecidedWorkspace`'s Overview, **below the outcome hero** (the summary paragraph sits inside the hero box, `:463`, so "above the summary" was wrong). If the design file has no slot, ask (CLAUDE.md rule 8); do not invent a layout.
- **Evidence tab**: top of `EvidenceTab` (live and decided).
Once per tab. Review & forward and the live Overview are unchanged. Draft 1's extra "parcel record" and "decided in your favour" lines (§4.3 in draft 1) are **dropped**: `decidedSummaryParagraph` already says who responded, and a second parcel sentence risks contradicting the delivery row. Nothing new is added to the banner's wording beyond what Phase A shipped.

### 4.4 Copy

New key: `disputes.reviewTab.inclusion.reasons.refundRecord.noRefundOnOrder` only (the row is suppressed, so no row label/reason is needed; the 409 carries a code, not copy). **Six locales in the same commit** (en/de/es/fr/pt/sv; sv with alternatives per the translation-quality rule); parity script; help article (`help.embedded.*`); `docs/technical.md`.

## 5. Phases

Each is one PR to `develop`, then a `master` PR that waits for the in-chat go. Each ends with a read-only render check on prod data at desktop and 393/375/320 px.

- **PR 1 — the rule** (S2, S3-row, S4-checklist, S5, S6): the module; route transform before the counts; demo fixture; `buildDecidedView` input; endpoint guard; tokens in six locales; tests (§7); `docs/technical.md`.
- **PR 2 — the note where it is missing** (S3-banner, S4-banner): `DecidedWorkspace`, `EvidenceTab`; help article; tests.

PR 1 first: it removes the contradiction. PR 2 adds the visibility.

## 6. Audit before PR 1 (read-only)

1. Every producer/consumer of line items and of the `no_return_initiated` checklist row: route, demo fixture, `useEvidenceSections.ts`, `useReviewView.ts`, `OverviewTab.tsx:1675/2310`, `SubmissionSummaryPanel`, `deriveMissingItems` (Phase B step 3 owns that one; confirm no double change).
2. Every render site of the `noReturn` and `no_return_initiated` labels (`messages/en.json:749, 1021`): decided checklist, emails, help copy.
3. The pack detail page `app/(embedded)/app/packs/[packId]/page.tsx:167, 462, 546` renders `checklist_v2` rows directly and maps `no_return_initiated`. **Decision: in scope of PR 1 for the label only** (it applies the same pure rule to the checklist row's label when a return is on record), so no fourth surface keeps the contradiction; verified by the audit that this page is reachable from the embedded app before it is changed.
3b. Path correction: the include endpoint is `app/api/packs/[packId]/inclusion-override/route.ts`; `loadDecidedViewInputs` selects `pack_json` at `loadDecidedResponse.ts:188`.
4. Which of rev 7 Phase B step 3's rebuilds remain needed once this ships (they were partly justified by UI coherence): update rev 7 to say so.

## 7. Test plan

- **Unit:** `rowConsequence` over `returns` ({none, requested, in_progress, returned, failed, unknown}) × `refund` ({none, some, unknown}) × field; identity on `none`/`unknown`/null; idempotent.
- **Invariant (the class guard, data level):** a generator over situations; for each `hasReturnOnRecord` situation, the shared pure helper's line items (route and demo fixture) and `checklistSection` output contain no `no_return_initiated`/`noReturn`; a forced-include stored override on the field is also suppressed. One component test that the Overview "Not included" number equals the rows listed on Review for the #24612 fixture.
- **Endpoint:** POST `force_include` on `no_return_initiated` with a return on record → 409 with the distinct `code`; without a return → unchanged; `force_exclude` → unchanged.
- **Bank path:** `plan_input_hash`, facts, letter and PDF are byte-identical before/after for a fixed dispute; the import test.
- **Component:** `DecidedWorkspace` and `EvidenceTab` render the note exactly once when a return is on record, never otherwise.
- **Real data:** #24612, #24510 (RETURNED), #24599 (IN_PROGRESS) from stored packs; a no-return refund-family dispute (unchanged); a fraud dispute (unchanged).
- **Render acceptance (pass/fail, in sv):** on `/app/disputes/2903f245-…`: Overview, Evidence and Review & forward each show the banner "En retur för den här ordern är markerad som mottagen" exactly once (Overview and Evidence: new); none of them shows the sv string "Ingen retur påbörjad" (`no_return_initiated`) or the sv of `checklist.item.noReturn` while a return is on record; the no-return row reads "Return recorded in Shopify" (sv string fixed in PR 1 with alternatives) with no outside-data callout; the refund row reads the sv string of `refundRecord.noRefundOnOrder` ("Ingen återbetalning har gjorts för den här ordern.") without the defence sentence; the "Not included" count on Overview equals the number of rows listed under it on Review.

## 8. Decisions needed before PR 1

- **D-1.** Three options, for the maintainer to see rendered first: **R** (recommended) relabel the row in place from the record, in *Not included*, with a neutral reason and no callout; **S** suppress it and let the banner carry the record (simplest, least informative: on Review the banner sits above the letter card, not in the inclusion list); **G** a new neutral "On record" group (new design; needs the design file).
- **D-2.** Family scope. Proposed: the rule applies wherever the field is in the family's checklist (refund, product); the `refund_record` reason change applies wherever that row exists. Return suppression is by field, so it needs no family list.

## 9. Pre-mortem

1. **A new surface re-derives the row from the checklist** and reintroduces the contradiction. Mitigation: the invariant test iterates the producers; any new consumer is added to it in the same PR.
2. **The rule leaks into the bank path.** Mitigation: import test + byte-identical hash test.
3. **Stale status** (pack collected before the return). Mitigation: the banner's existing `asOf` line; `unknown` fails closed; the deadline cron refreshes before filing.
4. **Copy reads as blame or as a verdict on the case.** Mitigation: the plan adds no new return wording; the only new sentence is "No refund has been issued on this order."; the maintainer reviews sv before PR 2 merges.
5. **Decided design has no slot for the banner.** Mitigation: re-read the design file; ask rather than invent (rule 8).
6. **The "Excluded" tag on the relabelled row reads as adverse.** Mitigation: D-1 asks the maintainer to see option R rendered before approval; S and G stay available.
7. **Phase B step 3 later sets the field `unavailable`.** The rule is keyed on the field, not the status, so it still applies; noted so nobody "simplifies" it to a status check.
8. **The banner and the checklist read different packs.** Mitigation: one source and an equality test (§4.2.2).

## 10. Not in scope

**Open, raised by §1.1 and out of this plan:** the pipeline, the credit-timing gate and the "Weak" verdict still read a raw refund amount, so a pending refund is invisible to them. For these three it changed nothing (the inquiries closed when the refund landed), but on a case where a refund is pending and the inquiry is still open, DisputeDesk may argue or hold as if nothing had been refunded. Needs its own read-only measure (how many open disputes have a pending refund entry) before any change.

Letters and the counsel stance for a returned-and-unrefunded case (rev 7 Phase C); the checklist/`deriveMissingItems` change (rev 7 Phase B step 3); collecting the return shipment (Phase D); any rebuild; moving the rule into `deriveEvidenceLineItems` (follow-up after rev 7 step 0).

## 11. Review record

- **Architect (draft 1):** Option A right; but R1/R2 were wrong (decided Overview and Evidence show the *opposite*, not silence); `decidedView.ts` missing from scope; transform must run before `route.ts:1167`; include endpoint does not refuse server-side; "kept internal" group copy is wrong and creates a count mismatch (`EvidenceUsedSection.tsx:77`); `callout` flag redundant; demo fixture missing from audit. Synthesis adopted: `lib/disputes` module now, applied in route + demo + decided view, builder move later.
- **Critic (draft 1):** ITERATE. Same decided-view finding; D-1's group frames the return as adverse (counsel stance); R4's "your position is undercut" reasoning is a judgment on the merchant's case; §4.3 extra lines are scope creep and risk contradicting the delivery row; callout flag unneeded; acceptance needs concrete strings. All applied above.
- **Critic (draft 2.1):** ITERATE: the browser needs the rule if a row is suppressed (now only the fallback); `noReturn` also counts as "had" via `returned_parcel_outcome`; banner and checklist must share one pack; D-1 omitted the "relabel in place" option, which is more informative and needs no new design (now the recommendation); sv acceptance string; the pack detail page decided in scope (label only). All applied.
- **Architect (draft 2):** endorse with edits. S5 was false (the outcome email never reads the checklist): removed with its test; the decided-view input belongs in `loadDecidedViewInputs` as an optional field; the "counts" rationale corrected (client-side, from the shared array); `bucketForRow` fallback hazard handled; the 409 is code-only and placed after the pack load; the pack detail page added to the audit; the invariant is data-level over a shared pure helper.

**Done when:** `disputePage.renderedRealCases.test.tsx` > `#24612` and `#21037` (return received / in progress, no 'No return initiated') are green without `.fails`.
