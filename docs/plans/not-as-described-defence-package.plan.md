# Not-as-described defence package — consensus plan

**Status: APPROVED for PR 0 + PR 1 (maintainer, 2026-09-28); PR 2–4 approved 2026-09-28 (in chat: "continue with three to four"); PR 5 not approved.** Consensus plan ralplan v5.1 (Architect APPROVE, Critic APPROVE, 2026-09-27). Source: the maintainer's external plan of 2026-09-23. Citations are `origin/develop`.

**Decided by the maintainer 2026-09-27:** D5 — remove the hedged ("narrow") framing for not-as-described letters. Overclaim guards stay: confident voice, claims limited to what the evidence proves.

## 0. External plan vs repo reality

| External plan says | Repo reality (develop) | Consequence |
|---|---|---|
| Line items lack product/variant IDs, description, media | True — `lib/shopify/queries/orders.ts:71` | Separate query; core order query untouched |
| Build a claim/evidence argument plan | Exists — `lib/argument/plan/deriveArgumentPlan.ts:2` ("the ONLY owner of … issuer-facing claim authority") | Extend, no second model |
| Delivery ≠ conformity; exclude IP/AVS | Encoded — `lib/defence/reasonCodes/product_unacceptable.ts` v3 (`avoid`, "DELIVERY IS NOT CONFORMITY", `criticalCategories:["product_listing"]` :51) | Pin with tests |
| Listing is its own evidence class | `lib/defence/factClassifier.ts:275` → `product_listing`; value only `{hasListing}` (:1022-1025); payload `uploads[]` only (`lib/evidence/model/payloads.ts:143,339-349`); one record `product_description#0` (`lib/evidence/model/derive.ts:216-221,292-294`) | Listing content has no data path — PR 3 adds one |
| Collect automatically | No collector (`lib/evidence/model/domains.ts:72-79`); `lib/automation/completeness.ts:497` `critical`, `expectedSource:"manual_upload"`; DB template maps it to `collector_key='order_confirmation'` (`20260411120000_…collector_key.sql:19-28`), text "Description the customer saw at the time of purchase" (`20260411150000_…:151`). Prod 2026-09-01: 0/252 had a listing | Core gap |
| Scoring | Two-axis `product` branch ships: `lib/argument/caseStrength.ts:706-835`; `productFamilyStrength.test.ts` pins bare listing + order → WEAK; listing `supportingOnly` (`canonicalEvidence.ts:321-327`) | PR 5 question only: should a collected listing leave `supportingOnly`? |
| Letter strategy | `lib/defence/strategies/product_not_as_described_listing_as_purchased.ts` says "published at the time" and "Argue the listing-as-published matched what was delivered"; gated on `order_record_present` (`strategy.ts:18`) | **Live overclaim in filed letters** — fixed first (PR 1) |
| Hedging | `lib/defence/narrativeWriter.ts:381-385`: `narrow` → "The available evidence supports…"; `derivePackageMode` returns `narrow` for any weak case (`factClassifier.ts:1083`) — i.e. nearly every not-as-described letter hedges | D5: removed for this family (PR 1) |
| Scopes | `read_products` in `shopify.app.prod.toml:54`; per-shop grant in `shop_sessions.scopes` (`lib/shopify/sessionStorage.ts:18`) unverified | PR 0 |

## 1. Policy

Counsel stance: `feedback_bank_optimized_rebuttal` (maintainer directive 2026-09-23); `docs/plans/merchant-counsel-stance.plan.md` (PR #767, not on develop — this plan does not depend on it).
- **C1** Bank text defends; limitations/contradictions are merchant-UI only. No sentence claims more than its evidence proves — enforced by deterministic guards (not caveats).
- **C2** Exhibit caption "Product listing as published in the store, retrieved {date}" is a fact, allowed. "May differ from what the customer saw" is a hedge, forbidden.
- **C3** Fatal-loss rule: no refund ≥ dispute amount in bank text. Unchanged here.
- **C4** No new LLM pipeline; `narrativeWriter.ts` consumes new facts (the counsel writer `lib/defence/counsel/run.ts` only has an `item_not_received` playbook, `playbooks.ts:77-79`, so it is not involved); token delta measured.

## 2. RALPLAN-DR summary

**Principles**
1. One source of truth: listing content lives in the snapshot table; evidence items reference it by id + hash.
2. Truth by omission: no overclaim, no hedging in bank text.
3. Collection never breaks the core: core order query untouched; collector returns outcomes, never throws.
4. Immutable, dated evidence; purge- and retention-compatible.
5. Every change to the filed artifact (letter text, strategy selection, PDF, completeness score, auto-save decision) is either **behind a flag that makes it byte-identical when OFF**, or shipped as its **own measured change with its own prod approval**.

**Decision drivers**
1. The live strategy overclaims today — the cheapest, highest-value fix needs no collector.
2. 0/252 listing coverage.
3. Deadline cron auto-files without human review.

**Options**

| Option | Pros | Cons |
|---|---|---|
| **A‴. Letter fix first (standalone measured change), then collector entirely behind a flag (chosen)** | Filed-text fix ships immediately without collector risk; collector's effects (completeness, gate, mode, PDF, inputHash) all switch together; flag OFF = collector does not run | Two approvals; listing absent from letters until flag ON |
| A′. Collector inside build, partial gating (v2) | One rollout | Proven leaky: completeness `fieldsProvided` (`buildPack.ts:575-577,716`), strategy selection, forbidden phrases, PDF all changed with flag OFF |
| A″. Out-of-band snapshot job, attach on next rebuild | Zero build risk | First build (possibly filed by the deadline cron) lacks the listing; two builds per dispute |
| B. External plan verbatim | Complete | Duplicates `CaseArgumentPlan`; external §4/§6 contradict C1 |
| C. Merchant upload only | No API calls | 0/252 measured failure |

## 3. Implementation

### PR 0 — Read-only measurement (scripts only)
- `scripts/sql/product-scope-grants.sql` — per active prod shop: newest offline `shop_sessions` row (`user_id IS NULL`), `scopes` contains `read_products`. Run `npm run db:query:prod -- --file …` (guard prints ref).
- `scripts/sql/product-disputes-open.sql` — open disputes with effective reason `PRODUCT_UNACCEPTABLE`: shop, review mode, `packageMode`, strength, `completeness_score`, deadline.
- Identify the external plan's order #90627 (shop, dispute id) as a regression fixture; never refiled.
- Output: `docs/plans/not-as-described-defence-package/pr0-measurements.md`.

### PR 1 — Letter fix for this family (standalone filed-text change; no collector)
- **Strategies:** rewrite both `product_not_as_described_listing_as_purchased.ts` and `product_not_as_described_narrow_fallback.ts` (the latter claims the listing fact is "always present", and its line 13 "what evidence supports the merchant's position" steers toward the banned hedge — reworded). In `listing_as_purchased`: remove "at the time" and "matched what was delivered"; keep gating on `order_record_present` (so selection is unchanged); argue from order record, variant, documented resolution; listing sentence only when a `product_listing` fact is approved (already possible via merchant upload today).
- **D5 (precise scope):** the shared cached system prompt (`narrativeWriter.ts:381-385`) is NOT edited. The family overlay (`reasonCodes/families/product_not_as_described.ts`, `overlayPromptBody`, emitted after the base prompt at `narrativeWriter.ts:579-584`) states explicitly that it overrides base rule 10's `narrow` hedged-framing instruction for this family, and instructs: for `narrow` packages, do not use hedging phrases ("The available evidence supports/indicates…", "consistent with"); state each supported fact plainly. What stays from `narrow`: ≤4-sentence summary and **no declarative reason-code conclusions** (no "the item was as described"); `full`'s closing reason-code sentence is not enabled. PDF: add `conclusion:product_not_as_described:narrow` in `lib/defence/pdf/thesisTemplates.ts` (the `conclusion:any:narrow` fallback at :283-288 says "Based on the available evidence…") — a plain request for reversal on the stated record. `NARROW_AGGRESSIVE_PHRASES` (`validateNarrative.ts:536`) kept. Other families byte-identical.
- **Deterministic guards** in the family file's empty lists (`reasonCodes/families/product_not_as_described.ts:17-19`): unconditional bans in `prohibitedBankPhrases`, fact-conditional ones in `guardedBankPhrases`; they flow via `extraHardPhrases`/`guardedPhrases` (`validateNarrative.ts:274-280`) and into the composed-PDF check (`documentValidation.ts:136-137`). Global `FORBIDDEN_PHRASES`/`CLAIM_GUARDS` untouched (CI test: other families' phrase sets unchanged). Assertion patterns only — `(was|were|is|are) as described`, `matched (the|its) (description|listing)`, `conform(ed|s|ing) to`, `not defective`, `(perfect|good|excellent) condition`, `at the time of (purchase|order)` (unless a historical-provenance fact exists), `within the expected (timeframe|delivery window)` (unless a delivery-promise fact), and IP/AVS/CVV/3DS sentences. Restating the cardholder's claim ("the cardholder states the item was not as described") stays legal — tested. NO_RETURN: the sanctioned sentence verbatim "No return has been recorded in Shopify for this order." (`claimGuards.ts:365-366`); `RETURN_ABSENCE_BANS` (:375) unchanged.
- **Routing:** no scheme-rule citation unless the network is resolved from the dispute record; wallet/PayPal labels → none. Fix the NO_RETURN overstatement comment at `orders.ts:44`.
- **Measurement before prod approval:** regenerate letters on develop for 3 decided prod PRODUCT_UNACCEPTABLE disputes (read-only data, no save) old vs new; report side-by-side, validator results, token delta. Canary rule applies.

### PR 2 — Snapshot storage (schema only, inert)
- Migration `product_listing_snapshots`: `shop_id uuid not null references shops(id)` (so `admin_purge_shop` discovers it via FK, `shop-redact/route.ts:20-22`), dispute_id, order_gid, line_item_gid, product_gid, variant_gid, fetched_at, product_updated_at, source_url, title, variant_options jsonb, description_text, description_html, image_paths text[], content_hash (sha256 over text + each image's bytes hash), provenance_class default `current_at_preparation`.
- Append-only trigger honouring the purge GUC from `20260906180000_restore_audit_mutation_guc.sql` (flag `app.allow_append_only_delete`, pattern `20260906170000_shop_purge_allow_append_only_delete.sql:81`).
- Unique `(dispute_id, line_item_gid, content_hash)` → identical content skipped; changed content = new row.
- **Retention:** `SECURITY DEFINER` RPC `purge_expired_product_snapshots()` sets the GUC and deletes rows where `fetched_at < now() - shops.retention_days` (default 365, computed live, matching `retention-cleanup/route.ts:34-58`), returning their `image_paths`; `retention-cleanup` calls it and removes those objects from `evidence-packs`.
- **Shop redaction:** new code in `shop-redact` deleting storage prefix `{shop_id}/product-listings/` in `evidence-packs` (no storage deletion exists there today); runs regardless of the `admin_purge_shop` result, including `unknown_shop` on re-delivery.
- Apply `npm run db:migrate:dev` in session; prod migration with the PR 3 release.

### PR 3 — Collector, entirely behind `PRODUCT_LISTING_EVIDENCE_ENABLED` (lib/featureFlags.ts)
- **Flag OFF: `productSource` is not invoked.** Nothing else in this PR has an effect without its output. Acceptance #7 proves byte-identity.
- **Scope:** runs only when the family is `product_not_as_described`, resolved by ONE new shared helper `effectiveFamilyForDispute()` that both `buildPack.ts:203-215` (GENERAL → bank-claim reclassification) and `buildDefencePackageJob.ts:317,351-361` (`familyKeyForModule`) call, so the collector and the letter cannot disagree on family. Other families never get the section.
- **Query** `lib/shopify/queries/productEvidence.ts` by order id (line items → product description/media(first:3)/updatedAt/onlineStoreUrl, variant selectedOptions/image, line-item customAttributes), paginated, registered in `lib/shopify/queries/registry.ts` for the drift dry-run.
- **Source** `lib/packs/sources/productSource.ts` in the `Promise.allSettled` fan-out (`buildPack.ts:454`), registered in `domains.ts`. Catches everything; per-line-item outcome `present|absent|inaccessible|failed|custom_item|deleted`. Budget: 8 s timeout, ≤ 2 requests per 50 line items; verify the build job's time budget in PR 3.
- **Retry (bounded to exactly one):** on `failed`, the collector enqueues `collect_product_evidence` with dedupe key `collect-product:<pack_id>:retry1`. `buildPack` reuses `pack_id` across rebuilds (`buildPack.ts:168-179`) and `jobs_dedupe_key_uniq` is permanent across statuses (`20260807200000_…:89-91`), so this key can exist once per pack, ever — that permanence IS the cap. The retry handler re-runs only the product query + snapshot insert; it does not call the collector's enqueue path. If it succeeds and no `final`/`submitted` defence package exists and no `save_to_shopify` job is pending/running, it enqueues a normal pack rebuild. The `jobs` table has no payload column (`007_jobs.sql:3-19`), so no option is passed: the permanent `retry1` key alone guarantees a failure on that (or any later) rebuild cannot enqueue again. No `build_run_id` is introduced. Duplicate handling: add an opt-in `enqueueJob(…, { onDuplicate: "return" })` that returns `{ duplicate: true }` on 23505 (today it rethrows a plain Error that loses the code, `claimJobs.ts:152-154`); the default behaviour and the `Promise<string>` return type for the 16 existing callers are unchanged. **Billing:** PR 3 must verify (test) that rebuilding an existing `pack_id` consumes no pack credit (packs are billed at build — memory `project_review_lifecycle_and_overview_copy`); if it does, the retry stores the snapshot only and never rebuilds.
- **Images:** `evidence-packs/{shop_id}/product-listings/{dispute_id}/` (shop-first, matching the bucket layout, `featureFlags.ts:45`), ≤3 per line item, ≤1 MB each.
- **Data path:** `evidence_items` payload variant `listings[]` `{snapshotId, lineItemGid, contentHash}` in its own section (never mixed with `uploads[]`); `derive.ts` `instanceKey`/`perInstanceSourceId`, `payloads.ts` `instanceCount`/`normalizeEvidencePayload` handle it; `recordId = product_description#<lineItemGid>`; representative = line item with the highest `originalTotalSet` (deterministic, not `collectedAt` ties). Divergence manifest + `derive.characterization.test.ts` entries updated deliberately. `factClassifier.ts` value extraction reads title/variant/excerpt (≤600 chars) from the snapshot. Merchant uploads keep their current classification.
- **Completeness:** the collector's `fieldsProvided` includes `product_description` (only when it runs). The DB-template repoint is NOT a migration: templates `019_seed_global_templates.sql:133` (b…0004) and `20260411150000_…:151` (b…0013) map `product_description` → `order_confirmation`, and `completeness.ts:342-343` matches on `collector_key`, so an unconditional repoint would drop the item on templated packs with the flag OFF. Instead the key resolution in `completeness.ts` maps that item to `product_description` only when the flag is ON. The guidance-text migration (6 locales, no "at the time of purchase") changes wording only. `completeness.ts:497` `expectedSource` → `auto_shopify` (a valid `EvidenceItemSource`, `lib/types/evidenceItem.ts:29-35`) and `collectionType` → `auto`, both only when the flag is ON. No `CURRENT_PROMPT_VERSION` (`buildDefencePackageJob.ts:39`) or validator-version bump, and no `domains.ts` required-field change that applies with the flag OFF.
- **PDF:** exhibit per line item — caption (C2), title/variant, excerpt, images from bucket bytes, dedupe by `content_hash`, ≤6 images per PDF. Only rendered when a `listings[]` section exists.
- **Merchant UI:** outcome states + limitation strings, i18n keys `disputes.evidence.productListing.{present,absent,inaccessible,failed,deleted,customItem,currentListingOnly,reconnectForProducts}` in 6 locales; `inaccessible` → reconnect action. "Included in package" bound to the package `inputHash` (`planInputHash.ts`).
- **Flag-ON replay (before prod flag ON):** for all open PRODUCT_UNACCEPTABLE packs on prod data (read-only harness `npm run analysis:evidence`): including templated packs (b…0004, b…0013) under the flag-ON key resolution, count changes in `completeness_score`, auto-save gate outcome (`autoSaveGate.ts:35`), `packageMode`, strength, and `inputHash` staleness (how many existing defence packages go stale). Output `docs/plans/not-as-described-defence-package/flag-on-replay.md`.

### PR 4 — Rollout
develop flag ON → PR 3 replay file → prod deploy flag OFF → prod canary (acceptance #10) → maintainer sign-off recorded in §5 → prod flag ON.

### PR 5 — Scoring (PLAN ONLY until sign-off)
Should a collected, item-linked listing count as Axis-1 (leave `supportingOnly`)? Read-only re-score; report tier and auto-save crossings.

### Deferred
Order-time capture (`orders/create`), counsel-v2 playbook for this family, `bankEffect` (#767).

## 4. Acceptance criteria
1. Fixture with accessible product (flag ON) → outcome `present`; snapshot row with `content_hash`, correct `line_item_gid`; ≥1 object under `product-listings/…`.
2. 403 / timeout / deleted product / thrown error → pack builds; correct outcome; exactly one `collect_product_evidence` job for `failed`; the real `enqueueJob` with `onDuplicate: "return"` against a mocked insert returning 23505 yields `{ duplicate: true }`, and without the option still throws; the retry-triggered rebuild whose collector fails enqueues nothing; a later ordinary rebuild of the same pack whose collector fails also enqueues nothing (key `retry1` already used); rebuilding an existing `pack_id` consumes no pack credit.
3. Guard tests: each banned pattern rejected in fixture sentences; claim-restatement sentence and the sanctioned NO_RETURN sentence accepted; guards inactive for other families.
4. PR 1: for family `product_not_as_described` with `packageMode = narrow`, the overlay text names itself an override of base rule 10, forbids hedging phrases and keeps the no-reason-code-conclusion rule; `prohibitedBankPhrases` (`readonly RegExp[]`, `lib/defence/types.ts:247`) for this family includes `/\bthe\s+(available|submitted)\s+(evidence|records)\s+(supports?|indicates?|is\s+consistent\s+with)\b/i`, so a generated letter containing a rule-10 hedge fails validation deterministically (bare "consistent with" stays legal); the overlay describes the hedge without quoting it ("no qualifying lead-ins about what the evidence supports or indicates") so `familyRegistry.test.ts:113-121` stays green, and the `:105-110` expectation of an empty overlay for this family is updated; the PDF conclusion uses `conclusion:product_not_as_described:narrow` (no "available evidence"); other families' prompts, phrase sets and PDF conclusions byte-identical (snapshot tests).
5. Snapshot table: UPDATE and plain DELETE rejected; DELETE under `admin_purge_shop` succeeds; `purge_expired_product_snapshots()` deletes expired rows and returns paths; shop-redact deletes the storage prefix (mocked storage).
6. Core webhook → build_pack → save regression tests green.
7. **Flag OFF byte-identity** on 8 fixtures (product untemplated, product with `pack_template_id` b…0004, product with b…0013, plus other families): `collectedFields`, template `collector_key` resolution, `completeness_score`, persisted checklist `expectedSource`, auto-save gate decision, `packageMode`, strength, strategy selection, narrative input, `prompt_version`, PDF render tree, `inputHash` — all identical to baseline.
8. `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run release:verify`, i18n parity green per PR.
9. `flag-on-replay.md` exists with all five counts; prod flag ON only after a maintainer sign-off line is recorded in §5 of this plan (pass/fail = presence of that line).
10. **Prod canary (no filing):** on 2–3 **decided** PRODUCT_UNACCEPTABLE disputes, build-only rebuild with save disabled; verify via `db:query:prod` the snapshot row, image objects, `evidence_items` `listings[]` payload; read the PDF. Before any bulk rebuild.

## 5. Decisions / sign-offs (maintainer, 2026-09-28)
- **D1 caption:** yes, for a current listing. The retrieval date stays visible; nothing may imply it was the listing at purchase.
- **D2 limits:** yes as initial limits — 3 images per line item, 6 per PDF, 1 MB each. Retention = shop `retention_days` (computed live, §3 PR 2).
- **D3 metafields:** omitted by default; add selected fields later only if a real case shows their value.
- **D4 scoring measurement:** run now, read-only; any scoring change stays in PR 5. **Result** (`not-as-described-defence-package/pr0-measurements.md` §4): counting the listing as Axis-1 would make 66 of 71 packs Strong; decided would-be-Strong cases won 25 of 45. Recommendation: keep the listing `supportingOnly` — no PR 5 scoring change.
- **D5 hedging:** confirmed — defend without apologetic hedging, but never assert an unsupported reason-code conclusion, and never claim the delivered product matched the listing unless item-specific evidence establishes that link.
- **PR 1 release gate:** compare the three decided-case letters and run the composed-document validation before opening the production release for separate approval.
- **PR 2–4 go-ahead** (maintainer, in chat, 2026-09-28). PR 2 built: migration `20260928120000_product_listing_snapshots` (applied on dev, verified: UPDATE/DELETE refused, duplicate content skipped, retention RPC returns image paths and removes the row), `lib/packs/productListingStorage.ts`, retention cron + shop-redact storage cleanup.
- **PR 3a built (2026-09-28):** collector, snapshots, one retry, data path, flag-ON checklist mapping; 17 new tests; flag OFF byte-identical. Query validated read-only on a live Mein Maison order (#90055: title, 989-char description, 3 images, variant; cost 5). **Deviation, deliberate:** the payload's `listings[]` carries the short copy (title, variant, ≤ 600-char excerpt, URL, date) next to `{snapshotId, contentHash}`, so the classifier and PDF stay pure; the snapshot row stays the full record and the hash ties the two. PR 3b (PDF exhibit) and 3c (merchant UI) next.
- Flag-ON sign-off (PR 4): _(pending)_

## ADR
- **Decision:** A‴ — ship the letter fix (both strategies rewritten, hedge removal per D5 via the family overlay + a family PDF conclusion, family-scoped deterministic guards) as a standalone measured change; add an inert append-only snapshot store; add the product collector fully behind `PRODUCT_LISTING_EVIDENCE_ENABLED`, running only for the not-as-described family, turned on after a measured replay and recorded sign-off; scoring separate.
- **Drivers:** live overclaim in filed letters; 0/252 listing coverage; deadline auto-filing.
- **Alternatives:** A′ (leaky partial gating), A″ (first filed build lacks evidence), B (duplicate argument owner, contradicts C1), C (measured failure).
- **Why chosen:** fixes filed letters now at no collector risk; every collector effect switches together with one flag; OFF is provably byte-identical.
- **Consequences:** two prod approvals; new table + storage prefix with explicit retention and redaction; +1–2 Admin requests per product-family build when ON; existing product packages may go stale when the flag flips (counted in replay).
- **Follow-ups:** order-time capture, counsel playbook, `bankEffect`, PR 5.
