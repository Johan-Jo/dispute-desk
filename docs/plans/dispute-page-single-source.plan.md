# Dispute page single source — finish what was planned, and enforce consumption

**Status:** FINAL — consensus reached (ralplan r5, 2026-11-10): Critic APPROVE on r4, Architect r4 blocking items applied here. **Pending maintainer approval; nothing implemented.**
**Builds on, does not replace:** `single-source-architecture-audit.plan.md` (2026-11-05; PRs 0/1/3/5 shipped as #1091/#1092/#1093/#1094, F-1b #1102) and `order-situation-drives-dispute.plan.md` rev 7 (A/B0 shipped #1063/#1065; Phase B never built). Re-asserts `design-alignment-shared-presentation-model.plan.md` (#410) §3.1 and `plan-projection-drift.plan.md` (#760–762) §3.4.
**Separate tracks (not this plan):** wording → `dispute-status-copy.plan.md`; save-state truth → §6 track S (bank-/filing-affecting); order-situation `situationConsequences` (rev 7 steps 3, 5, 6 — completeness denominator, deadline email, NAD letter) → its own plan; filing-collapse incident.
**Code:** `origin/master` `d1b3eb1c`. Prod access read-only.

---

## 1. Why every earlier single-source effort failed

| Effort | Owner it created | Shipped | How the current page (#1098 `record/*`, `disputeRecord.ts`) defeats it |
|---|---|---|---|
| Presentation model #410 | `presentation/resolveLifecycle` — saved only from `submission_state`; `pack.savedToShopifyAt` display-only | yes | `recordInputs.ts:61-82 stageOf()` re-derives; `:69` saved on `pack.savedToShopifyAt`; `:228` same. `claimOwnership.invariant` exempts enum stages; `tests/fixtures/disputeRecordFixture.ts:214-216` sets both fields. |
| Projection drift #760–762 | `CaseArgumentPlan` + letter provenance | yes | `planProjectionAgreement` covers evidence rows only; record stage/action/decided-cited local (`recordInputs.ts:142-151`, `disputeRecord.ts:395`). |
| Order situation A/B0 | `orderSituation`; Phase B consequences table | A, B0 | Phase B never built. `OrderSituationNote` + Overview ack panel deleted by #1098. `returned_parcel_outcome` `blocking:false` (`lib/automation/completeness.ts:526`), not an attention input (`resolveAttention.ts:47-55`) → `disputeRecord.ts:847` "No action is required" on #17066. |
| Audit 0/1/3/5 | `assembleEffectiveChecklist`, `refundStatement`, `noReturnApplicability`, one assembler (§4.1) | partly | #1098 branched after #1092 (`1e42304d`) and deleted the wired surfaces as "dead"; PR body names none of it; no review; proof used 3 payloads, none with a return. Record checklist `buildChecklistRows(v)` without `inapplicable` (`disputeRecord.ts:933`). `refundStatement` built (`route.ts:516`), zero readers. Audit §5.4–5.5 tests never built; PR 2 reverted (#1097). `rawReadScan` roots already cover `app/(embedded)` and `lib/disputes` (`tests/unit/rawReadScan.ts:31-37`) — it missed #1098 because of its **patterns**, and because it is a blacklist. |
| Smaller owners | #426, #702, #1099, outcomeExplanation, assessmentPresence | yes | Bypassed: mode (`recordInputs.ts:79,222`; `RecordWorkspace.tsx:1191` reads `appliedRule.mode` raw), ungated strength band (`disputeRecord.ts:1099-1103`), second category map `FACT_CATEGORY_FIELD` (`:318-326`), local delivery classification (`:315,:407`). |

**Pattern (4×):** each plan adds an owner + a blacklist guard; nothing requires the owner to be **read**, nothing tests the **rendered** page on real cases, guards are keyed to surfaces that a redesign deletes, and enforcement steps scheduled last were dropped.

## 2. RALPLAN-DR

**Principles**
1. **One new owner only:** `merchantAsks` (registry over existing gates). Everything else is wiring to existing owners.
2. **Enforce presence, keyed by owner, not by surface** — a guard that dies with the surface it guards is no guard.
3. **The rendered page on real cases is the primary truth test;** read-tracking is secondary.
4. **Enforcement ships first and green** (`it.fails` for known gaps); plans are committed in the same PR.
5. **This plan changes no bank-facing or filing behaviour.** Anything that does is a separate track (§6) with its own canary.

**Drivers:** live contradictions on 4 prod disputes; fourth recurrence; the next redesign must fail CI.

**Options**
- **A. Patch the record page only** — recurs; kept as PR 3.
- **B. New `DisputeAccount` aggregator** — rejected: third aggregator beside `DisputePresentation`/`workspaceAssessment`.
- **C. (chosen)** Owner-keyed enforcement + rendered real-case tests first; then wire the page to existing owners; asks registry; defer bank-affecting work to separate tracks.

## 3. Enforcement (PR 1 — lands first, green)

### 3.0 PR 1 scope (explicit)
1. Extract the inline `derived` from `useDisputeWorkspace.ts:1059` into pure `deriveWorkspace(data, clientState)`; the hook calls it. Behaviour-preserving; parity test old vs new `derived` on all fixtures.
2. Render harness `tests/harness/renderDisputePage.tsx`: `renderToStaticMarkup(<RecordWorkspace …>)` inside a next-intl provider (real `en` messages), Polaris `AppProvider`, mocked `useSearchParams` (`RecordWorkspace.tsx:92`), App Bridge stub, no-op `ws.actions`; Overview or Evidence tab selectable.
3. Fixtures + the shared enrichment path (§3.1).
4. §3.2–3.5.
5. Plans committed in a separate commit (§3.6).

### 3.1 Rendered real-case tests (primary)
**Fixtures:** `scripts/fixtures/capture-workspace-fixture.mjs` (read-only) saves, per case, the workspace payload **plus a typed `EnrichSourceRows` sidecar** with exactly one field per enriched output: `evidenceSavedToShopifyAt` (dispute row), `automationMode` (route's resolved mode), `assessmentReadOk` (server query state, `gatherArtifacts.ts:87`), `outcomeInputs` (`{submittedAt, facts}`, `outcomeExplanation.ts:257`). The route and the capture script both call one loader `loadEnrichSourceRows(sb, disputeId)` — no second assembly path. It scrubs names, emails, addresses, IPs, order numbers, **shop domains and Shopify GIDs** to stable placeholders; output reviewed in the PR diff.
**No fixture drift:** every payload field this plan adds (`dispute.evidenceSavedToShopifyAt`, `dispute.automationMode`, `assessmentGate`, `asks`, `outcomeExplanation`) is produced by one pure `enrichWorkspacePayload(payload, sourceRows)` in `lib/disputes/workspacePayload/enrich.ts`, called by **both** the route and the tests. It emits tokens/ISO dates only; dates are formatted at render (the route has no locale). A later PR that adds a field adds it there, so frozen fixtures gain it without a prod deploy, and the `it.fails` can flip on develop. **Exception:** fields built in the route *before* enrichment (`presentation.lifecycle`) do not change on frozen fixtures; the #23750 assertion is therefore `stage ≠ saved` (satisfied by PR 2 reading owners), and its `save_failed` assertion is added only when #23750 is re-captured after Track S is on prod.

| Fixture | must show | must not show |
|---|---|---|
| #17066 `7aa8536c` returned-to-sender, unanswered | parcel ask on Overview; action token = parcel ask | `action.none`; `action.ack` as primary action |
| #23750 `e38c8d87` pack stamped saved, every save failed | stage ≠ saved (Track S makes it `save_failed`) | `headline.saved`; a version number |
| #24612 `2903f245` return received, CNP, won | return received; refund line from `refundStatement` | "No return initiated" |
| #21037 `defa8294` return in progress | return in progress | "No return initiated"; ack offer |
| #24285 `d65b7220` latest build failed | build-failed state | `prepared.version` |
| won, filed (blume-box, picked by query in the script, ID recorded) | `outcome.*` line; explanation when non-null | `filed.none` |
| review-awaiting (6a8848-dd, by query, ID recorded) | review ask as action | `action.none` |

**One `it.fails` per assertion** (not per row), so a partial fix flips exactly what it fixed.

### 3.2 Owner-coverage test (keyed by owner)
**Live builders** = (a) the pure builders `recordInputsFromWorkspace` → `buildDisputeRecord` and `deriveWorkspace`; (b) the §3.0 render harness over all fixtures, both tabs.
**Read semantics:** the payload is wrapped **after** enrichment (`enrichWorkspacePayload` is not a live builder) in a proxy that records only `get` on a property **below** an owner key (leaf access). `ownKeys`, enumeration, spread, `JSON.stringify` and passing the object along do not count. Planted meta-tests: a builder that only spreads `data` reads nothing; a builder that reads one leaf counts once.
**Owner keys (exact payload paths):** `presentation.lifecycle`, `presentation.attention`, `presentation.automationMode`, `effectiveChecklist`, `refundStatement`, `orderSituation`, `returnRequest`, `asks`, `assessmentGate`, `workspaceAssessment.caseStrength`, `decidedView`, `outcomeExplanation`, `evidenceLineItems`, `bankClaim`, `dispute.evidenceSavedToShopifyAt`, `dispute.automationMode`.
**Rule:** each owner key is read by ≥1 live builder; exemptions baselined with a reason. Fails today on `refundStatement` (`it.fails` until PR 2). It does **not** catch the record-checklist bypass (`useEvidenceSections` reads `effectiveChecklist`); the #24612/#21037 render assertions do.

### 3.3 Surface enumeration (by import, proven by execution)
Every `.ts`/`.tsx` file in `app/**` and `components/**` that imports `WorkspaceData`, `Workspace`, the workspace hook, or `lib/disputes/presentation` types must be either (a) **reached** by the §3.2 builders/harness when run over the fixtures — measured by v8 function coverage of that file during the harness run (≥1 exported function executed), not by the import graph, so an imported-but-unused file does not pass, or (b) a baselined exemption with a reason. Initial exemptions: the dispute list (`DesktopDisputesTable`, `MobileDisputeCard`, `disputeListHelpers.ts`), `app/(portal)/portal/disputes/page.tsx`, `DashboardRecentDisputesPreview.tsx`, `packs/[packId]/page.tsx`. Emails are out of this plan (they take their own `*Context`) and are a follow-up. Planted mutations: a new `page.tsx`, and separately a new `.ts` helper taking `WorkspaceData`, neither reached by the harness → fail.

### 3.4 Forbidden reads — `rawReadScan` per-pattern scopes
`tests/unit/rawReadScan.ts` gains a per-pattern `scope` and an owner allow-list (`app/api/disputes/[id]/workspace/route.ts`, `lib/disputes/presentation/**`, `lib/disputes/workspacePayload/**`). New patterns, scoped to `app/(embedded)/app/disputes/**` and `lib/disputes/disputeRecord.ts`:
`\bsavedToShopifyAt\b`, `appliedRule\??\.mode`, `orderSituation\??\.refund\b`, `\bbankIncludedFacts\(`, `\bFACT_CATEGORY_FIELD\b`, `\bDELIVERY_CONFIRMED\b`.
(`submissionState ===` is not added: legitimate render gates remain, e.g. `GorgiasCommsReviewSection.tsx:508`.) Baseline classes: `open` (names the PR that removes it) and `allowed` (reason). PR 1 classifies every existing hit: **`open` → PR 2:** `useDisputeWorkspace.ts:1152,1212,1225,1275` (`pack.savedToShopifyAt` decides workspace "saved" — same class as `stageOf`; moves to `dispute.evidenceSavedToShopifyAt`), `useEvidenceSections.ts:262` (`appliedRule.mode`), `recordInputs.ts:69,79,148,222,228`, `RecordWorkspace.tsx:1191`, `disputeRecord.ts` maps; **`allowed`:** `types.ts:177` (type declaration), comment at `useDisputeWorkspace.ts:930`. PR 2 leaves zero `open` entries for these patterns.

### 3.5 Fixture honesty
`tests/fixtures/disputeRecordFixture.ts:214-216` is split: one fixture with `lifecycle=saved_to_shopify`, another with only `savedToShopifyAt` + `submission_state=not_saved`.

### 3.6 Plans in git (separate commit)
Commit `single-source-architecture-audit.plan.md`, `return-state-coherence.plan.md`, the local `order-situation-drives-dispute.plan.md` edits, this plan and `dispute-status-copy.plan.md`. Each gets a line "done when: <test names> green without `it.fails`".

## 4. Wiring the record to existing owners (PR 2)

New payload fields are produced only in `enrichWorkspacePayload` (§3.1). `recordInputsFromWorkspace` projects owners only; `disputeRecord.ts` imports no state predicates; `RecordWorkspace.tsx` raw reads removed (`:1191 appliedRule.mode`, `:1170 submissionState`, `:887` local `deriveDefencePackageActionState` → presentation).

| RecordInputs field | owner | note |
|---|---|---|
| `stage` | `presentation.lifecycle` + `resolveBuildAttempt` + coverage/fatal from `workspaceAssessment` (mapping table) | `stageOf()` deleted |
| `savedAt` | new payload field `dispute.evidenceSavedToShopifyAt` (route adds it); `isTransmissionConfirmed` is boolean and gates it | not `pack.savedToShopifyAt` |
| `automationMode` | `presentation.automationMode` (from `pickAutomationAction`, `serverFacts.ts:163`); when `presentation` is null → the route's own resolved value (`route.ts:1261`), exposed once as `dispute.automationMode` | no client fallback |
| checklist rows | `effectiveChecklist` (`route.ts:569`) | not `buildChecklistRows(v)` w/o `inapplicable` |
| `refund` | `refundStatement`; `RecordInputs.refund` widened to `RefundKind` incl. `recorded_no_amount`, null when no pack | |
| `returns` | `orderSituation.returns` + `returnRequest` | |
| `strengthBand` | `resolveAssessmentGate({needsRecalculation, readOk})` computed in `enrichWorkspacePayload` from `workspaceAssessment` + `assessmentReadOk`, exposed as `assessmentGate` on the payload (client `useDisputeWorkspace.ts:1090,1163` reads it too) | |
| decided outcome | keep `outcome.*` date/amount line; **add** `outcomeExplanation` (payload, from `outcomeExplanationToken`) beside it when non-null | not a replacement |
| decided cited (no letter) | `citedFacts`/`isCitedFact` + `letterCitations.evidenceFieldOfFact` | `FACT_CATEGORY_FIELD` deleted |
| delivery | evidence line item / `deliveryPresentation` | `deliveryParts` classification deleted |

Flips the §3.1/§3.2 `it.fails` for stage, checklist, refund, strength, cited.

## 5. Merchant asks registry (PR 3)

`lib/disputes/merchantAsks.ts` → `resolveMerchantAsks(payload) → Ask[]` (`{ id, priority, offered }`), computed in the route, on the payload. Card visibility = `registry entry offered` **OR local post-answer state** (e.g. `BankClaimCard.tsx:73` `saved`), so a refetch never unmounts a card mid-confirmation. Record action = first required, else optional, else none. Required asks render on Overview (same components). **`resolveAttention` is not changed** in this plan: it feeds the dispute list, dashboard stats, portal list and the claim-divergence cron, so the record's action comes from the registry alone; a list/dashboard "answer needed" signal is a follow-up with its own count criteria. **Accepted, known mismatch after PR 3:** #17066-type disputes show the parcel ask on the dispute page while the list shows no attention flag — not a regression. Offers whose card also depends on in-flight client state (`ReturnRequestCard.tsx:45` `derived.isBuilding/isRegenerating`; parcel/ack while building) keep that as a render condition; the server sends only the offer.

| ask id | priority | gate (existing) | inputs | server-available? |
|---|---|---|---|---|
| `review_decision` | required | `canDecide` | presentation, review_state | yes |
| `bank_claim` | required | `BankClaimCard` `trigger !== null` (`:70`) | `bankClaim` | yes; `saved` stays client render state |
| `parcel_outcome` | required | `heldState.canOfferParcelOutcome` | returnedToSender (case strength), merchant answer (`merchantAnsweredParcelOutcomeFromItems` over pack items — PR 3 confirms items are on the payload or adds them via enrichment), submissionState, finalOutcome | yes |
| `return_request` | required | `ReturnRequestCard:42-44` → moved to `lib/` | `returnRequest.applies`, finalOutcome, submissionState | offer yes; build/regenerate stays render |
| `missing_evidence` | optional | pure `buildEvidenceSections(data, derived)` extracted from `useEvidenceSections.ts:862` (translator applied at render) | effectiveChecklist, line items | yes after extraction |
| `gorgias_review` | optional | `GorgiasCommsReviewSection:379-384` `gorgiasComms` present | `gorgiasComms` | offer yes; run/expanded state stays client render |
| `cardholder_ack` | optional | `heldState.canOfferCardholderAcknowledgement` | items, submissionState, finalOutcome | yes |

Parity test: on every fixture, card visibility before/after the move is identical, except the intended #17066 Overview change. Flips the #17066 and review-awaiting `it.fails`.

## 6. Separate tracks (named exceptions to Principle 5)

- **Track S — save-state truth** (changes filing/retry behaviour): `pipeline.ts:1266` writes `saving`; every post-enqueue return in `saveToShopifyJob.ts` leaves a terminal status, `save_failed` only when non-retriable/out of attempts (`claimJobs.ts:110`), Shopify 4xx non-retriable; `save_failed` re-savable (`saveToShopifyJob.ts:77`, `defence/enqueue.ts:83`, `save-to-shopify/route.ts:54-57`); success clears `submission_failed`; `resolveLifecycle` `saving`/`save_failed` mapping; `pipeline.ts:1027-1031`. Backfill limited to open, `submission_state='not_saved'`, no active save job, pack status exactly `saved_to_shopify`; set printed first (expected 1: #23750); **rollback**: inside the backfill transaction, `{id, previous_status}` is written to a table created by the Track S migration; reverse SQL committed beside it. Valid only until the next save job for that pack runs (after that the job's own write is the truth). Canary: #23750 on its deadline run. Ships independently and first in time (due 20 Nov); §3.1's #23750 row asserts only `stage ≠ saved` until a post-Track-S re-capture adds `save_failed`.
- **Order-situation consequences** (rev 7 steps 3, 5, 6): own plan, own pre-release threshold-crossing count, own canary.

## 7. Acceptance criteria
1. PR 1 merges green; it contains §3.1–3.6, with every known gap as `it.fails`.
2. After PR 3: zero `it.fails` remain in the §3.1/§3.2 suites (named list in PR 1), and the per-fixture table in §3.1 holds.
3. Planted mutations fail CI: (a) delete a surface that is an owner's only reader → owner-coverage fails; (b) add a new `page.tsx` and, separately, a `.ts` helper taking `WorkspaceData`, not reached by the harness → enumeration fails; (b2) a builder that only spreads `data` → owner coverage fails; (c) add `pack.savedToShopifyAt` or `appliedRule.mode` read in `record/**` → rawReadScan fails; (d) remove `parcel_outcome` from the registry → #17066 render test fails.
4. Bank invariance for PRs 1–3: the PRs touch no file under `lib/defence/**`, `lib/packs/**`, `lib/automation/**`, `lib/jobs/**` (checked in each PR); PR 0 parity suites green (`completenessModeParity.test.ts`, `orderSourceNoReturnParity.test.ts`, `noReturnFactVerdict.test.ts`). Track S and order-situation consequences excluded by §6.
4b. List/dashboard/portal counts unchanged on all fixtures (no `resolveAttention` change).
5. Card visibility parity (§5) on all fixtures.
6. `npm test`, `tsc --noEmit`, `npm run build`, `release:verify` green; critic pass on each diff; dev shape check on whj8db-1q (#23750, #24285), cay-collective (#17066), 6a8848-dd (one review-awaiting, ID recorded in PR 1).
7. After each prod deploy (explicit in-chat go per change): #17066-type and #23750 verified in the browser.

## 8. Review record
- r1 (status-explanation draft) → replaced after analysis showed the single-source failures.
- r2: Architect SOUND-WITH-CHANGES (wrong §3.1 rows; manifest limited to pure builders; `it.fails`; narrow Phase B to asks; local post-answer visibility; render tests primary). Critic ITERATE (seam bypassable; manifest must be owner-keyed; surface enumeration; Principle 5 violated by Phase B steps 3/5/6 + save truth; enforcement scheduled last; rawReadScan premise wrong — patterns not roots; gate inputs unspecified; fixture tokens/PII/IDs; Principle 1 overstated). All applied.
- r4: Architect SOUND-WITH-CHANGES (typed `EnrichSourceRows` + shared loader; #23750 can't flip from enrichment → re-capture after Track S; PR 1 classifies existing pattern hits incl. `useDisputeWorkspace` saved reads). Critic **APPROVE** (non-blocking: name reach mechanism; `readOk` source; proxy after enrichment; `dispute.automationMode` owner key; #23750 assertion wording). All applied in r5.
- r3: Architect SOUND-WITH-CHANGES (PR 1 must include `deriveWorkspace` extraction + harness mocks; live builder = harness + pure builders; leaf-read semantics; `returnRequest` key; coverage does not catch the checklist bypass; enumeration proven by render reach; per-pattern scopes + owner allow-list + `allowed` class; one `it.fails` per assertion; client render gates; rollback window). Critic ITERATE (enumeration `.ts` + by import; fixture drift → shared `enrichWorkspacePayload`; read semantics + planted spread test; `resolveAttention` ripple → removed from scope; exact payload keys; name parity suites; emails consistency; scrub shop domains/GIDs; exact regex). All applied.

- **PR 1 as built (2026-11-10), deviations from sections 3.0-3.6.** Each is the closest faithful version; none drops a piece.
  1. `deriveWorkspace` takes the translators as a third argument (`deriveWorkspace(data, clientState, translators)`): `useTranslations` is hook-bound, so they are injected. Behaviour-preserving; parity test `deriveWorkspaceParity.test.ts` against a frozen copy (`deriveWorkspaceLegacy.ts`) on the 7 real fixtures x 3 client states + the loading state (the synthetic record variants lack the server assessment envelope and cannot run `deriveWorkspace`).
  2. Three owner keys in 3.2 are not payload paths. Used: `dispute.refundStatement`, `dispute.orderSituation`, `pack.checklistV2` (the route returns the EFFECTIVE checklist there). `tests/harness/ownerKeys.ts` documents the mapping.
  3. The `pack.savedToShopifyAt` reads classified in 3.4 as `useDisputeWorkspace.ts:1152,1212,1225,1275` moved to `hooks/deriveWorkspace.ts` with the extraction (5 hits: the 4 lines plus the `savedToShopifyAt:` key passed to `computeNextAction`). Baselined `open -> PR 2` there. The comment at `useDisputeWorkspace.ts:930` is a comment and is not scanned, so it needs no entry.
  4. Review-awaiting case: every `needs_review` dispute on 6a8848-dd has no evidence pack except `fc1971af-5ad5-46ad-a2e7-815de799a044`, so the pick query requires a prepared package (a pack-less dispute cannot show the review ask).
  5. Fixture capture does not use a service-role key. It runs the real route through `scripts/fixtures/lib/readOnlyDb.ts`: supabase-js GETs become SELECTs run via `npm run db:query:prod -- --read-only` (guard per call); every non-GET throws. One named exception: the upserting RPC `ensure_shop_settings` is answered by a plain SELECT of the stored row. Launcher is `capture-workspace-fixture.mjs`, runner `capture-runner.mts` (tsx).
  6. `enrichWorkspacePayload` is the identity in PR 1 (PR 1 changes no route output) plus an exported `ENRICHED_PATHS` (empty) that the capture uses to strip enriched fields so fixtures stay pre-enrichment. The route loads `loadEnrichSourceRows` in parallel with its other reads (about 5 extra reads per 4s poll; PR 2 passes rows it already holds).
  7. Surface enumeration found surfaces beyond the 3.3 initial exemptions: five API routes (the workspace route itself, dispute list, dashboard stats, claim-divergence cron, evidence upload), `EvidenceBuilderSection.tsx` and the real `useDisputeWorkspace.ts` (replaced by `workspaceHookMock` in the harness). Each is baselined with a reason. `CardholderAcknowledgementCard.tsx` is reached by an extra render with `?section=cardholder-ack`, not exempted.
  8. `orderSituation\??\.refund` (exact regex from 3.4) does not match the alias the record uses (`const sit = d.orderSituation; sit?.refund`), so recordInputs has no hit for it. Owner coverage is the net for that read; not widened here.
  9. #21037 and #24612 are decided (won) disputes in prod now. Their "must not show" assertions (No return initiated, ack offer) already hold, so they are plain tests; the #24612 refund-line assertion is an `it.fails`.
  10. 3.5: `saved` / `under_review` fixtures now carry `lifecycle` + `submission_state` + `submittedAt` and NOT `pack.savedToShopifyAt`; new `stamped_not_saved` carries only the stamp (+ `not_saved`).
  11. Unrelated and pre-existing: `lib/defence/pdf/__tests__/DefencePackageDocument.test.ts` fails in this environment (pdf-worker exit) on a clean `origin/develop`.
- **Merchant asks registry, built before PR 2 (2026-11-10, branch `feat/single-source-merchant-asks`).** The maintainer reordered the work so the registry (section 5) ships first, driven by #17066. Done: `lib/disputes/merchantAsks.ts` (`resolveMerchantAsks`, seven asks in the section 5 order, `primaryAsk`, `askActionKey`); `asks` computed in `enrichWorkspacePayload` and added to `ENRICHED_PATHS`; `RecordInputs.asks` replaces `offerAck` and the hero action reads `primaryAsk`; the parcel and return cards render on the Overview for required, pending asks; the inline gates of `ReturnRequestCard`, `BankClaimCard`, `GorgiasCommsReviewSection` and `deriveMissingItems` moved verbatim into lib and the components call them. `resolveAttention`, completeness, the list, dashboard counts and `lib/defence|packs|automation|jobs` are untouched. Flipped to plain tests: the three #17066 assertions and the review-awaiting one. New: `tests/unit/merchantAsks.test.tsx` (parity with frozen copies of the old gates, rendered card visibility on both tabs, hero invariant, planted mutation). `asks` left the owner-coverage exemptions (the record reads it).
  Deviations, none dropping an item:
  1. **`pending` added to `Ask`** (`{ id, priority, offered, pending }`). `offered` is the card gate verbatim, so an answered bank claim or return question, or a decision already made, stays `offered` (collapsed card). Without `pending` the hero would keep asking for something already answered. The hero invariant is therefore "no `action.none` / acknowledgement while a required ask is offered AND pending". `gorgias_review` is never pending (informational, no action sentence).
  2. **`review_decision` is pending only in review mode with no choice made** (stage `prepared_review` or `needs_attention` with the package filed under "Require my approval"). In auto-pilot (`held`, or `needs_attention` under auto) the decision row is offered but the hero does not say "Approve the package" (the held-is-not-review rule). Review mode in `needs_attention` is what the review-awaiting fixture is, so the registry now outranks the old stage precedence there.
  3. **`stageOf` moved** unchanged from `record/recordInputs.ts` to `lib/disputes/workspacePayload/recordStage.ts` (plus `recordStatusOf`, `isReviewMode`) because `review_decision` needs the stage server-side. That directory is on the rawReadScan owner allow-list, so the two `open -> PR 2` baseline counts for `recordInputs.ts` (`savedToShopifyAt`, `appliedRule.mode`) dropped from 2 to 1. The reads did not go away; PR 2 still deletes `stageOf` there in favour of the owners.
  4. **Optional-ask ordering changes one hero sentence.** The old chain preferred the acknowledgement over "add the missing evidence" in `needs_attention`; the registry order (section 5) puts `missing_evidence` first, and a `needs_attention` dispute with no missing merchant task no longer says "Adding the missing evidence ... would strengthen the case" (it says none, or the acknowledgement).
  5. **Required cards on the Overview**: the parcel and return cards are added for pending asks only; `bank_claim` already rendered there and the decision row already sits above the tabs. The acknowledgement and parcel cards keep calling `canOfferCardholderAcknowledgement` / `canOfferParcelOutcome` directly (the same functions the registry calls; `heldCopyTruth.test.ts` pins the acknowledgement card to that call) rather than reading `data.asks`.
  6. **No Claude-written copy.** The action sentence for an ask is the ask's existing card title (`disputes.evidenceTab.parcelOutcome.title`, `disputes.evidenceTab.returnRequest.title`, `disputes.bankClaim.title`) or the existing `disputes.record.action.*` sentence. One help paragraph was added to `help.embedded.articles.disputeDetailPage` in all six locales.
- **Known gaps asserted as `it.fails` after PR 1 (the named list from criterion 2):**
  `disputePage.renderedRealCases.test.tsx`: #17066 shows the parcel ask on the Overview (PR 3); #17066 action token is the parcel ask (PR 3); #17066 does not offer the cardholder acknowledgement as the primary action (PR 3); #23750 stage is not 'saved' (PR 2); #23750 does not show headline.saved (PR 2); #23750 does not show a package version as saved (PR 2); #24612 shows the refund line from refundStatement (PR 2); #24285 shows the build-failed state (PR 2); #24285 does not show prepared.version (PR 2); won-filed shows the outcome explanation (PR 2); review-awaiting review ask is the action (PR 3).
  `ownerCoverage.test.tsx`: `dispute.refundStatement` is read (PR 2).
  `disputeRecord.test.ts`: a pack stamped saved while `submission_state=not_saved` is not stage 'saved' (PR 2).
  Baselined, not `it.fails`: owner keys not in the payload yet (`dispute.evidenceSavedToShopifyAt`, `dispute.automationMode`, `assessmentGate`, `asks`, `outcomeExplanation`), and the `open` rawReadScan entries (all `removedBy` PR 2).

## ADR
- **Decision:** owner-keyed presence enforcement + rendered real-case tests land first; then wire the record page to existing owners; then one asks registry. Bank/filing-affecting work split into named tracks.
- **Drivers:** fourth recurrence; blacklist guards and surface-keyed lists die with the surface; redesign had no data contract.
- **Alternatives:** patch only (recurs); new aggregator (third owner of the same thing).
- **Why chosen:** deleting, bypassing or never-reading an owner fails CI, independent of which page exists.
- **Consequences:** `derived` and evidence-sections extracted to pure builders; `stageOf`, `FACT_CATEGORY_FIELD`, local delivery classification deleted; payload gains `evidenceSavedToShopifyAt`, `automationMode`, `assessmentGate`, `asks`, `outcomeExplanation`, all via `enrichWorkspacePayload`.
- **Follow-ups:** copy plan (after PR 3); Track S; order-situation consequences plan; filing incident; dispute emails + dispute list registered in owner coverage; list/dashboard "answer needed" attention signal.

**Done when:** every `it.fails` listed in section 8 passes without `.fails`, the baseline has zero `open` entries, and `ownerCoverage`, `surfaceEnumeration`, `disputePage.renderedRealCases` and `rawReadScan` are green.
