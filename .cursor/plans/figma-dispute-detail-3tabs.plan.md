# Figma dispute-detail integration — all 3 tabs

**Status:** DRAFT v3 (PATCH 1 applied 2026-04-25) — awaiting approval. No code lands until decisions are signed off.

**Source of truth (Figma):** `.cursor/plans/figma-shopify-dispute-detail.tsx` (41562 bytes, fetched 2026-04-25 via Figma MCP `resources/read`).

**Source of truth (backend):** Audited 2026-04-25 across `lib/packs/buildPack.ts`, `lib/automation/pipeline.ts`, `lib/shopify/formatEvidenceForShopify.ts`, `lib/argument/types.ts` + strength engine, `app/api/disputes/[id]/workspace/route.ts`, `app/api/packs/[id]/submission-preview/route.ts`, `app/(embedded)/app/disputes/[id]/hooks/useDisputeWorkspace.ts`. Findings drive every UI mapping below.

---

## 0. Governing rules (from the corrected implementation prompt)

> **The UI is a debuggable surface of the backend, not a simplified dashboard.**
> - Flow is **pipeline → evidence pack → Shopify payload → UI**. Figma is a visual layer, not a source of truth.
> - **No UI-level summarization.** Direct field rendering. No combining backend fields into one label. No friendly-text rewrites of structured data.
> - **Every field is rendered or marked "Missing / Not available".** Silent omission is forbidden.
> - **No data-structure collapse.** Domain separation (Payment / Fulfillment / Customer / Device & IP / Policies) is preserved. No section is hidden because it's empty — it shows an explicit empty state.
> - **Shopify submission is exactly visible.** Structured view + raw payload, both byte-equivalent to what the submitter sends.
> - **Defense text never exceeds data.** Every claim maps to a visible evidence field via `argumentMap.counterclaims[].supporting[]` or `RebuttalSection.evidenceRefs[]`.
> - **No UI-inferred strength.** Only render backend outputs.
> - **NO IMPLICIT UI MAPPING.** The UI must not match data by display text, labels, template fragments, copied sentence pieces, or array position. All cross-references between collections (whyWins ↔ counterclaims, rebuttal sections ↔ evidence fields, submission fields ↔ Shopify field labels, etc.) must use stable IDs:
>   - `counterclaimId`
>   - `evidenceFieldKey`
>   - `submissionFieldName`
>   - `rebuttalSectionId`
>   - `evidenceRefs[]` (array of `evidenceFieldKey`)
>
>   **Forbidden:** matching `whyWins.strength` rows to a counterclaim by `title` text; matching a rebuttal paragraph to an evidence label by substring; routing UI sections by human-readable copy; relying on array order to pair items across collections.
>
>   **Required:** every cross-collection reference resolves through an explicit ID. If a stable ID does not exist in the backend output today, it is added to the API contract **before** the UI renders that pair.
>
> - **No client-side strength classification.** The UI may only render strength values that come from the backend: `caseStrength.overall`, `counterclaim.strength`, `checklist item.priority` and `checklist item.status`, and `pack.submissionReadiness`. The UI must not compute, infer, upgrade, downgrade, or fabricate any strength / confidence / risk classification.
> - **Preserve all existing logic.** No feature deletions.

---

## 1. Backend output → UI field map (the single source of truth)

This table drives every render. If a UI element is not in this table, it is not allowed.

| UI element | Source (file:line approx) | Type | Treatment |
|------------|---------------------------|------|-----------|
| **Hero outcome label** ("Likely to win" / "Could win" / "Hard to win") | `derived.caseStrength.overall` (`useDisputeWorkspace.ts:649` calls `calculateCaseStrength` in `lib/argument/strength.ts:203-299`) | `"strong" \| "moderate" \| "weak" \| "insufficient"` | **1:1 map**. No client-side inference: "strong" → "Likely to win", "moderate" → "Could win", "weak" / "insufficient" → "Hard to win". |
| **Hero coverage value** (replaces fake "X% confidence") | `derived.caseStrength.score` (0-100) | `number` | Render as **"Evidence coverage: {score}/100"**. Backend computes this as evidence weight collected. **Do not call this "confidence"**, which the backend never produces. |
| **Hero description** | `derived.caseStrength.strengthReason` | `string` (templated by reason family) | Render verbatim. This is a backend-templated sentence (e.g., "Payment verification and purchase behavior strongly support this defense."). |
| **Hero improvement hint** (when present) | `derived.caseStrength.improvementHint` | `string \| null` | Render verbatim below the strengthReason. Hidden only when `null`. |
| **Recommendation paragraph** | **`derived.recommendationText` (backend, REQUIRED, see 3.A.5)** | `string` | Render verbatim. The current client-side composition in `OverviewTab.tsx:382-415` is a **temporary compatibility shim**, marked with `TODO: move to backend-derived recommendationText. Do not extend this UI logic.` and removed when the backend field is shipped. |
| **Recommendation helper** (post-submit days-elapsed line) | **`derived.recommendationHelperText` (backend, REQUIRED, see 3.A.5)** | `string \| null` | Render verbatim. Current client-side `calendarDaysSince` derivation is a temporary shim — same TODO marker, same removal path. |
| **`EVIDENCE_EVALUATION_HELPER` footnote** | `lib/argument/evidenceStatus.ts` | static string | Keep as today. |
| **Submission deadline line** | `dispute.dueAt` / `pack.savedToShopifyAt` | ISO timestamp | "Submission deadline: {formatDate(dueAt)}" / "Submitted {formatDate(savedToShopifyAt)}". |
| **Timeline step 1** ("Evidence submitted") | `pack.savedToShopifyAt` | timestamp | When `submitted`: green check + `Submitted to Shopify on {formatDate(savedToShopifyAt)}`. When pre-submit: gray dot + "Not yet submitted". |
| **Timeline step 2** ("Bank review in progress") | implicit (post-submit) | derived | Active blue clock when submitted, pending gray dot otherwise. |
| **Timeline step 3** ("Outcome notification") | `dispute.finalOutcome` | `string \| null` | Pending gray when `null`. Green check + outcome label when set. |
| **O3 supporting rows** | `derived.whyWins.strengths[]` (backend, each row carries `counterclaimId`) — see 3.A.5 | `Array<{ text: string; counterclaimId: string }>` | For each entry: resolve `argumentMap.counterclaimsById[counterclaimId]` (ID-keyed map, see 3.A.5). Render `text` as the row title. Subtitle is built by iterating `counterclaim.supporting[].evidenceFieldKey` and rendering the corresponding payload values from `pack.evidenceItemsByField[evidenceFieldKey]` (also ID-keyed). Strength pill = `counterclaim.strength`. **No text/title-based pairing.** |
| **O3 missing-signals sub-section** | `derived.whyWins.weaknesses[]` (each row carries `counterclaimId`) — see 3.A.5 | `Array<{ text: string; counterclaimId: string }>` | Same ID-resolution as supporting rows. For each: render `text` as title; subtitle iterates `counterclaim.missing[].evidenceFieldKey`. Each evidence field renders with one of the empty-state taxonomy values (§3.E) — never silently dropped. |
| **O4 coverage headline** | `derived.missingItems` filtered by `priority === "critical"` | `MissingItem[]` | "All critical evidence present" when empty, "{N} critical {item\|items} missing" otherwise. |
| **O4 progress bar** | `pack.completenessScore` (server-computed) | `number` | Tone derived from `caseStrength.overall`. **Do not recompute server-side score on the client.** |
| **O4 priority breakdown rows** (Critical / Supporting / Optional) | `effectiveChecklist` filtered by `priority` | `ChecklistItemV2[]` | Each row: `{N}/{M} complete` from `status === "available" \|\| "waived"` count over total. Click-through expands the per-priority field list with status badges (Included / Missing / Waived). |
| **Automation rule pill** | `appliedRule.mode` (workspace API normalizes legacy values to `auto`/`review`) | `"auto" \| "review"` | "Automatic" / "Review before submit". `Change rule` button → `/app/rules?family={mapReasonToRulesFamily(reason)}`. |
| **E1 defensibility blurb** | `derived.caseStrength.strengthReason` | string | Same backend output as the Hero, surfaced in a different visual treatment. |
| **E2 strength legend** | static educational copy | n/a | Two chips, no data binding. |
| **E3 Customer claim** | `dispute.reason` mapped through 6-family table (D5) | string | Hardcoded mapping with explicit fallback ("Customer claim"). Reason → claim is deterministic and traceable. |
| **E3 Our defense** | symmetric mapping to E3 customer claim | string | Same. |
| **E4 argument blocks** | `data.argumentMap.counterclaims[]` keyed by `counterclaim.id` (one accordion per counterclaim, **iteration order is the array order from the backend — but every cross-reference within the row resolves by ID, never by position**) | `CounterclaimNode[]` | Header: `title` + `strength` pill + chevron. Body iterates `counterclaim.supporting[]`: each entry's `evidenceFieldKey` resolves `pack.evidenceItemsByField[evidenceFieldKey]` for the raw value, with the empty-state taxonomy applied (§3.E). Below: `counterclaim.missing[]` rendered with "Add this evidence" button → `actions.navigateToEvidence(evidenceFieldKey)`. Below: `counterclaim.systemUnavailable[]` rendered with the **System unavailable** taxonomy state. |
| **E4 audit log (full per-field detail)** | `effectiveChecklist` + `pack.evidenceItems` | both | Below the argument blocks: complete present-evidence rows (existing G3) + missing-evidence rows with Add/Waive/Upload (existing G4). Render every checklist field. |
| **R1 Submission status hero** | `pack.savedToShopifyAt`, `derived.readiness`, `derived.caseStrength`, `pack.submissionState` | composite | Pre-submit: amber/red panel + "Ready to submit / Needs review" headline + Submit primary button (override modal gates weak strength via existing R-existing 2 logic). Post-submit: green panel + timestamp + "View in Shopify Admin" deep link via `getShopifyDisputeUrl`. |
| **R2 Formatted view** | `GET /api/packs/:id/submission-preview` returning `SubmissionField[]` | array | Render every field as label/value row inside grouped sections (Order / Payment / Fulfillment / Customer / Device & IP / Policies / Other). Use field `shopifyFieldName` to determine grouping. **Empty values render as "Missing" pill, not omitted.** |
| **R2 Raw view** | **NEW: `GET /api/packs/:id/submission-preview?format=raw`** returning the actual GraphQL `disputeEvidenceUpdate` mutation payload | JSON | `<pre>` block. **Byte-equivalent to what the submit job sends to Shopify.** Built by `lib/shopify/formatEvidenceForShopify.ts:buildEvidenceForShopify` (read-only invocation). |
| **R3 structured view** ("What was sent" collapsibles) | `SubmissionField[]` regrouped | array | Order Summary / Payment Verification / Timeline / Customer Activity / Policies. Each `<details>` summary shows label + tight subtitle (e.g., "AVS: Match · CVV: Match"). Body shows full sub-fields. Empty groups still render with "No data submitted under this section". |
| **R4 final statement** | `data.rebuttalDraft.sections[]` (each carries `id`, `text`, `evidenceRefs[]`, `claimId`) — see 3.A.3 / 3.A.5 | `RebuttalSection[]` | Render each section by `section.id`. Section text is a paragraph; below the text, render a "Citing:" line listing each `evidenceRefs[].evidenceFieldKey` resolved through the same ID-keyed map used by O3/E4. **Section→counterclaim provenance** uses `section.claimId` → `argumentMap.counterclaimsById[claimId]`. Copy button writes joined section text to clipboard. |
| **R4 stale warning** | `data.rebuttalOutdated` (boolean from API) | boolean | Yellow Banner above the panel: "Argument outdated — pack updated after this argument was generated. Regenerate to refresh." with a Regenerate button calling `actions.regeneratePack()`. |
| **R4 traceability footnote** (per-claim → evidence field map) | `RebuttalSection.evidenceRefs[]` populated server-side (3.A.3); each entry is an `evidenceFieldKey` resolved via the ID-keyed lookup map | `string[]` of `evidenceFieldKey` | Each section gets a "Citing: {field labels joined}" subdued line, where labels come from `pack.evidenceItemsByField[evidenceFieldKey].label`. **If 3.A.3 has not shipped:** render the explicit empty-state copy "Per-claim provenance unavailable in this build" — never substitute by matching paragraph text against evidence labels. |
| **R5 supporting documents** | `pack.evidenceItems` filtered to `payload.fileId !== undefined` | array | Render each as a list row: file icon + filename + size + external-link icon. **Empty state shows "No supporting files attached" — explicit, not hidden.** |
| **F1 failure short-circuit** | `derived.isFailed` + `derived.failureCode` | boolean + string | Unchanged early-return Banner with safe `FAILURE_COPY` (never renders raw `failure_reason`). |
| **F2 auto-save banner** | Latest `pack.auditEvents` of type `"auto_save_blocked"` | array | Unchanged — reasons + Add-missing / Submit-anyway buttons. |

---

## 2. Per-tab implementation outline

### 2.1 Overview tab (in order)

1. F1 banner if `derived.isFailed` (early return).
2. F2 banner if auto-save was blocked.
3. **O1 hero** — strength label + `caseStrength.score`/100 + `strengthReason` paragraph + `improvementHint` line + recommendation paragraph + recommendation helper + `EVIDENCE_EVALUATION_HELPER` footnote + deadline line.
4. **O2 timeline** — 3 steps, derived from submission and finalOutcome.
5. **O3 "What supports your case"** — for each `whyWins.strength`, look up the matching `counterclaim` (via templated mapping) and render with raw subtitle from `counterclaim.supporting[]` payload values + counterclaim strength pill. Below: Missing-signals sub-section pulling from `whyWins.weaknesses[]` and `counterclaim.missing[]`. Each missing row exposes `Add this evidence` → `actions.navigateToEvidence(field)`. **Never silently omit a weakness.**
6. **O4 "Evidence coverage"** — headline + bar (`pack.completenessScore`) + per-priority breakdown rows. Each breakdown row expands to show the priority's items with their `evidenceRowStatus` badges. View-all link → switches to Evidence tab.
7. **Automation rule card** — mode pill + helper + Change rule button.
8. **Footer CTAs** — Submit / Edit (pre-submit) or View in Shopify / Set up policies (post-submit).

### 2.2 Evidence tab (in order)

1. F1 / F2 banners (mirror Overview).
2. **E1** defensibility blurb — `caseStrength.strengthReason`.
3. **E2** strength legend chips.
4. **E3** Claim-vs-Defense split — hardcoded reason → claim/defense table (D5 below).
5. **E4 argument blocks** — one accordion per `argumentMap.counterclaims[]`. Body shows `supporting[]` rows (looked up against `pack.evidenceItems` for raw values) + `missing[]` rows (with Add/Waive/Upload controls preserved from G4) + `systemUnavailable[]` rows (informational).
6. **Full audit list** — every `effectiveChecklist` item with `WHY_TEXT` (G1), `MISSING_IMPACT` (G2), waive flow (G5), DropZone (G6), refs/scrollIntoView (G10) preserved verbatim. This is the unredacted log; argument blocks above are the structured summary.
7. Footer: `actions.markEvidenceReady` / `actions.regeneratePack` (G9).

### 2.3 Review & Submit tab (in order)

1. F1 / F2 banners.
2. **R1 hero** — pre vs post-submit variants (existing override-modal flow R-existing 2-3 preserved).
3. **R2 "Exact data sent to Shopify"** — formatted ↔ raw toggle. Formatted from `SubmissionField[]`; raw from new `?format=raw` endpoint output. **Empty values render with "Missing" pill, not omitted from the formatted view.** Raw view is byte-equivalent to the GraphQL mutation.
4. **R3 "What was sent" collapsibles** — same `SubmissionField[]` regrouped into 5 native `<details>` sections. Empty sections still render with "No data submitted under this section".
5. **R4 final statement** — `rebuttalDraft.sections[]` text + Copy button + stale warning + traceability footnote (or explicit "unavailable" line if `evidenceRefs` not populated).
6. **R5 supporting documents** — file list from `pack.evidenceItems` filtered to attachments. Empty state "No supporting files attached".

---

## 3. Required prerequisite work

### 3.A Server / API gaps to close (before tab implementation)

| # | Gap | Required change | File(s) | Risk |
|---|-----|-----------------|---------|------|
| 3.A.1 | `submissionFields[]` is hardcoded empty in the workspace endpoint | Don't try to populate it there. Keep the existing `GET /api/packs/:id/submission-preview` as the source for R2/R3. The UI calls it on tab mount (existing behavior). | `app/api/disputes/[id]/workspace/route.ts:207` (no change) | Low. |
| 3.A.2 | **Raw GraphQL mutation payload not exposed anywhere** | Extend `GET /api/packs/:id/submission-preview` with optional `?format=raw` query param. When `raw`, response includes `mutationPayload: { disputeEvidenceUpdate: {...} }` produced by calling **the exact same `buildEvidenceForShopify(pack, dispute, rebuttalDraft)` invocation that the submit job uses** — same input shape, same normalization, same field-omission rules. **Read-only**, no audit events, no Shopify call. <br><br>**Forbidden:** alternate "preview" builder, client-side reconstruction, JSON built from `SubmissionField[]`, test-mode payload differences, partial payloads. The submit job and the preview endpoint must call **the same exported function**. <br><br>**Test requirement:** new unit test in `lib/shopify/__tests__/formatEvidenceForShopify.test.ts` (or sibling) asserts `buildRawSubmissionPreview(fixturePack, fixtureDispute, fixtureRebuttal)` is byte-equivalent to `buildSubmitPayload(fixturePack, fixtureDispute, fixtureRebuttal)` across every fixture (at minimum: post-submit-strong, pre-submit-weak, fraud, PNR, subscription, duplicate). Failure to be byte-equivalent fails the test. | `app/api/packs/[id]/submission-preview/route.ts`, importing `lib/shopify/formatEvidenceForShopify.ts` | Medium — must not invoke any side-effect path. Audit `buildEvidenceForShopify` for mutations before extending. |
| 3.A.3 | `RebuttalSection.evidenceRefs[]` typed but not populated in API response | Either (a) ensure the rebuttal-generation code persists `evidenceRefs` in the JSONB sections column and update the workspace query to project it, or (b) accept that R4 traceability footnote shows "Per-claim provenance unavailable in this build" until follow-up. | `app/api/disputes/[id]/workspace/route.ts:103-108`, rebuttal generator | Low for (b), Medium for (a). |
| 3.A.4 | Pack file attachments are not first-class — only inferable from `evidence_items.payload.fileId` | Add a derived `attachments[]` array on the workspace response, populated by scanning `pack.evidenceItems` for entries with `payload.fileId` + filename + size + mimeType. **Do not change the underlying data model.** | `app/api/disputes/[id]/workspace/route.ts` | Low — additive read. |
| 3.A.5 | **Stable cross-collection IDs missing from the workspace payload** — UI cannot honor the "no implicit mapping" rule without them. | Audit each ID below for current presence; populate the missing ones in the workspace response. Required IDs and their resolution paths: <br><br>• `argumentMap.counterclaims[].id` — must already exist as `CounterclaimNode.id` per `lib/argument/types.ts:23`. **Verify it survives serialization to the client.** Add `argumentMap.counterclaimsById: Record<id, CounterclaimNode>` (a server-built map) so the UI never needs to scan the array. <br>• `whyWins.strengths[].counterclaimId` — backend addition. Each `WhyWinsResult.strength` row currently is a string (`lib/argument/whyWins.ts`); it must become `{ text: string; counterclaimId: string }`. Same for `whyWins.weaknesses[]`. <br>• `counterclaim.supporting[].evidenceFieldKey` — must already exist as the existing `field` property per `lib/argument/types.ts:23-27`. **Rename to `evidenceFieldKey` in the workspace response** for the API contract to be self-documenting (back-compat shim if needed). Same for `counterclaim.missing[].evidenceFieldKey` and `counterclaim.systemUnavailable[].evidenceFieldKey`. <br>• `rebuttalDraft.sections[].id` — must already exist as `RebuttalSection.id`. Verify serialization. <br>• `rebuttalDraft.sections[].evidenceRefs[]` — typed but not populated (see 3.A.3). Each ref is an `evidenceFieldKey`. <br>• `submissionFields[].shopifyFieldName` — already present per the audit; no change. <br>• `pack.evidenceItemsByField: Record<evidenceFieldKey, EvidenceItem>` — server-built ID-keyed map so the UI's per-row payload lookup is O(1) and order-independent. | `app/api/disputes/[id]/workspace/route.ts`, `lib/argument/whyWins.ts`, `lib/argument/types.ts` | Medium — touches `whyWins.ts` shape (breaking for any current consumer; grep for usages first). Low for the ID-map additions (read-only). |

**3.A.6 — Backend-derived recommendation copy.** The `derived.recommendationText` and `derived.recommendationHelperText` fields must be populated by the same engine that already runs in `useDisputeWorkspace.ts:382-415` (move that logic into `lib/argument/recommendation.ts` or co-locate inside `calculateCaseStrength`). The workspace API exposes the resulting strings. Until this lands, the UI keeps the existing client-side composition behind a `// TODO: move to backend-derived recommendationText. Do not extend this UI logic.` marker; the marker is removed when the backend field ships.

### 3.B Client / UI changes that are NOT allowed under this plan

- ❌ **Do not** introduce numeric "confidence" percentages. The backend produces no such number; using `caseStrength.score` (0-100) is allowed but must be **labelled "Evidence coverage", never "Confidence"**.
- ❌ **Do not** synthesize defense bullets in the UI. `synthesizeDefenseBullets` and `DEFENSE_RULES` (existing F5 in `OverviewTab.tsx`) are removed; their job is now done by reading `whyWins.strengths[]` (backend) and resolving provenance via `counterclaimId`.
- ❌ **Do not** match data across collections by display text, label fragments, template substrings, or array position. Every cross-reference uses an explicit ID per the §0 NO IMPLICIT UI MAPPING rule.
- ❌ **Do not** assign per-row strength pills client-side. Strength values come exclusively from `caseStrength.overall`, `counterclaim.strength`, `checklist item.priority` and `checklist item.status`, and `pack.submissionReadiness`. The UI cannot compute, infer, upgrade, or downgrade any of them.
- ❌ **Do not** silently drop empty fields. Every empty value renders one of the §3.E taxonomy states — never disappears.
- ❌ **Do not** hide sections because they're empty. Every section listed in §2 renders even when zero items; empty state copy is required.

### 3.C Removed / deprecated client-side code (will be deleted in implementation)

| Code | Location | Replaced by |
|------|----------|-------------|
| `synthesizeDefenseBullets` + `DEFENSE_RULES` | `OverviewTab.tsx` | `whyWins.strengths[]` resolving `counterclaimId` → `argumentMap.counterclaimsById[counterclaimId]` (ID-only) |
| `WHY_EVIDENCE_MATTERS` (Overview copy) | `OverviewTab.tsx` | Per-row raw values from `pack.evidenceItemsByField[evidenceFieldKey]`. The map already exists in `EvidenceTab.tsx` (`WHY_TEXT`); not duplicated on Overview. |
| Client-side UI bullet composition for missing items | `OverviewTab.tsx:870-930` | `whyWins.weaknesses[]` + `counterclaim.missing[]`, rendered with the §3.E taxonomy state. |
| Client-side recommendation composition (`recommendation` / `recommendationHelper` calculation) | `OverviewTab.tsx:382-415` | `derived.recommendationText` + `derived.recommendationHelperText` (backend, 3.A.6). UI keeps the local logic only as a temporary shim with a removal TODO. |

### 3.D Field visibility classification (every Review & Submit field MUST be tagged)

Every field surfaced in the Review & Submit tab — both the formatted view (R2 + R3) and the raw view (R2 raw) — must carry one of three visibility tags. The tag is set on the backend (`SubmissionField.visibility` and parallel typed annotations in the raw mutation builder) and respected by the UI:

| Tag | Definition | UI behaviour |
|-----|------------|--------------|
| `merchant_visible` | Value originated with the merchant or merchant-uploaded evidence; safe for normal display. | Standard label/value row with no annotation. |
| `system_generated_visible` | Value came from DisputeDesk system logic (e.g., `DEVICE_LOCATION_NEUTRAL_REVIEWED` / `DEVICE_LOCATION_NEUTRAL_MISSING` injected by `formatEvidenceForShopify` when bank-eligible IP data is absent). It IS sent to Shopify, so it MUST appear in both views. | Label/value row + an inline pill **"System-generated value"** (or **"System-generated fallback"** when the value is one of the static fallbacks). The merchant must understand they did not author this text but it was submitted on their behalf. |
| `internal_only` | Internal flags or metadata never sent to Shopify (e.g., diagnostic telemetry). | Hidden from merchant UI by default; surfaced only in a debug/dev payload view if such a view exists. |

**Hard rule:** A field that is actually submitted to Shopify cannot be tagged `internal_only`. If it goes out, the merchant sees it (with the appropriate tag).

### 3.E Universal empty-state taxonomy (every rendered field MUST use exactly one)

Replaces the loose "Missing / Not available" wording. Every rendered evidence/payload field on every tab must be exactly one of:

| State | Definition | Example |
|-------|------------|---------|
| `Present` | Value exists and is in use. | "AVS: Match" |
| `Missing` | Expected for this dispute type but absent. The merchant can usually act to add it. | "Tracking number: Missing" with `Add this evidence` button |
| `Not applicable` | Not relevant for this dispute reason (e.g., signature confirmation on a digital-goods order). | "Delivery signature: Not applicable" |
| `System unavailable` | Source cannot provide this data (e.g., IP enrichment didn't run, or `bankEligible === false`). | "VPN/proxy detection: System unavailable" |
| `Waived` | Merchant intentionally skipped/waived. | "Refund policy: Waived (reason: Already submitted separately)" |

Mapping inputs → state:
- `ChecklistItemV2.status === "available"` → **Present**
- `ChecklistItemV2.status === "missing"` AND `collectionType !== "automatic"` → **Missing**
- `ChecklistItemV2.status === "missing"` AND `collectionType === "automatic"` AND the source returned `bankEligible === false` (or equivalent) → **System unavailable**
- `ChecklistItemV2.status === "missing"` AND priority is irrelevant for this `dispute.reason` (per a backend-supplied `applicabilityByReason` table — flagged as a future backend addition if absent today) → **Not applicable**
- `ChecklistItemV2.status === "waived"` → **Waived**

If the inputs are insufficient to disambiguate (e.g., we cannot today distinguish "missing" from "not applicable" for a specific field/reason combo), **default to `Missing`** and flag the gap inline as a TODO requiring backend `applicabilityByReason` data.

---

## 4. Decisions

| # | Decision | Resolution under the corrected spec |
|---|----------|------------------------------------|
| D1 | Hero color for non-strong cases | **Adaptive (green / amber / red).** Strict 1:1 from `caseStrength.overall`. Uniform green when data is weak would be fake completeness. |
| D2 | Per-field rows + Fix buttons placement | **Both Overview AND Evidence.** Overview shows the structured signal list with explicit Missing-signals sub-section (§2.1 step 5–6). Evidence shows the unredacted audit log below the argument blocks (§2.2 step 6). |
| D3 | Automation rule placement | **Overview footer card** (§2.1 step 7). Merchant must see what rule routed the dispute on the same screen as case strength. |
| D4 | R5 Supporting documents | **Implement now**, sourced from `pack.evidenceItems` with `payload.fileId`. Explicit "No supporting files attached" empty state. Backend gap 3.A.4. |
| D5 | E3 Claim-vs-Defense | **Hardcoded 6-family table** with explicit fallback. Mapping is deterministic and traceable. |
| D6 | R2 Raw view | **Build via API extension 3.A.2.** Raw view renders the actual GraphQL mutation payload, byte-equivalent to what the submit job sends. **No client-side stringify of `SubmissionField[]`** — that would not be byte-equivalent. |
| D7 | Sequencing | **Backend prerequisites first** (3.A.2 + 3.A.4), then **one tab per commit**: Overview → Evidence → Review & Submit. R4 traceability footnote behind 3.A.3 — if not done before Review tab, surface "Per-claim provenance unavailable" inline (no silent drop). |

E3 mapping table (D5):

| `dispute.reason` | Customer claim | Our defense |
|------------------|----------------|-------------|
| FRAUDULENT / UNRECOGNIZED | Unauthorized transaction | Authorized transaction |
| PRODUCT_NOT_RECEIVED | Product not received | Order delivered to customer |
| PRODUCT_UNACCEPTABLE / NOT_AS_DESCRIBED | Product not as described | Product matched the listing |
| SUBSCRIPTION_CANCELED | Subscription not cancelled | Subscription handled per policy |
| CREDIT_NOT_PROCESSED | Refund not processed | Refund timing per policy |
| DUPLICATE | Duplicate charge | Charges are distinct transactions |
| (default) | Customer claim | Our defense |

---

## 5. Validation checklist (audit-mode, must pass before each push)

For every tab, every state (failed / no-pack / pre-submit weak / pre-submit strong / post-submit), the following must be true:

- [ ] Every backend field in §1 is rendered in the tab where the table places it, OR explicitly marked with one of the §3.E taxonomy states.
- [ ] No claim in O3, E4, R3, or R4 exists without a corresponding entry in `argumentMap.counterclaims[].supporting[]` or `RebuttalSection.evidenceRefs[]` (when populated).
- [ ] **No text/title/template-based mapping exists.** Cross-collection lookups go through `counterclaimId`, `evidenceFieldKey`, `submissionFieldName`, `rebuttalSectionId`, or `evidenceRefs[]` only. Grep the new code for any `.find((x) => x.title === ...)` / `.find((x) => x.text.includes(...))` patterns — must be zero.
- [ ] **`whyWins` rows resolve via `counterclaimId` only.** Searched the rendered DOM tree for any string-equality fallbacks — none found.
- [ ] **Rebuttal sections show `evidenceRefs` or the explicit "Per-claim provenance unavailable" empty state.** No silent paragraph-text-to-evidence-label inference.
- [ ] **`recommendationText` is backend-derived** (3.A.6 shipped) **OR** the temporary client-side shim is marked with the `// TODO: move to backend-derived recommendationText` comment.
- [ ] **R2 raw view payload is built by the same `buildEvidenceForShopify` invocation as the submit job.** Verified by the byte-equivalence unit test in 3.A.2.
- [ ] **Every rendered field has one of the §3.E taxonomy states**: Present / Missing / Not applicable / System unavailable / Waived.
- [ ] **Submitted system-generated fields are labelled** with the §3.D `system_generated_visible` pill ("System-generated value" / "System-generated fallback") in both R2 views.
- [ ] No client-side synthesis of strength labels, defense bullets, or confidence values.
- [ ] R2 raw view bytes equal the JSON returned by `GET /api/packs/:id/submission-preview?format=raw`.
- [ ] No section is hidden when empty — empty states render with explicit copy.
- [ ] `tsc --noEmit` clean, `vitest run` 661 tests pass, `npm run build` green.
- [ ] Forbidden-copy grep (`"submit response"` absent).

Recommended extra: a Vitest snapshot test that renders the new OverviewTab against a fixture workspace data shape (covering all five states) and asserts each backend field name appears in the rendered HTML — guards against silent regressions.

---

## 6. Risks

- **3.A.2 (raw mutation payload exposure)** is the highest-risk piece. Audit `buildEvidenceForShopify` for any function call that touches the DB, Shopify, or audit log before adding it to a GET endpoint. Mitigation: read-only signature, wrap in a unit test that asserts no `supabase.*` or fetch calls fire when invoked from the route handler.
- **3.A.3 (rebuttal provenance)** is acceptable to defer; the plan handles its absence explicitly. But Approval 3 (Review tab) should re-confirm whether you want it shipped together or as a follow-up.
- **Removing `synthesizeDefenseBullets`** changes which strengths surface in Overview O3. Today's bullets fire on field presence; the new path fires on `whyWins.strengths[]` from the backend. Verify the surfaced set looks reasonable across the 6 reason families before pushing. If a family produces fewer bullets than today, decide whether to backfill in `lib/argument/whyWins.ts` (backend) — never re-add UI synthesis.
- **Shopify mutation rendering** in R2 raw view will reveal payloads that today are invisible to merchants (e.g., when `bankParagraph` is missing the formatter injects `DEVICE_LOCATION_NEUTRAL_MISSING`). Merchants will see this. Acceptable per the audit-mode rule but worth flagging as a transparency change.

---

## 7. FINAL INTEGRITY GUARANTEE

The implementation must guarantee, on every push:

- ✅ Every rendered value has a source field in the backend response — no fabricated values.
- ✅ Every rendered claim has `evidenceRefs[]` (or an explicit "Per-claim provenance unavailable" state) — no claim survives without traceable provenance.
- ✅ Every strength label comes from the backend (`caseStrength.overall`, `counterclaim.strength`, `checklist.priority`, `checklist.status`, `pack.submissionReadiness`) — no UI-side classification.
- ✅ Every Shopify payload field is visible in both structured (R2 formatted, R3) and raw (R2 raw) form — neither view drops a key the other shows.
- ✅ Every raw payload is generated by **the same** `buildEvidenceForShopify` function that the submit job calls — proven byte-equivalent by the 3.A.2 unit test.
- ✅ No UI element depends on label matching, template matching, copied sentence fragments, or array order — every cross-collection reference resolves through a stable ID per §0 NO IMPLICIT UI MAPPING.
- ✅ No empty field disappears silently — every rendered slot uses one of the five §3.E taxonomy states.
- ✅ System-generated submitted values are labelled `System-generated value` / `System-generated fallback`, never disguised as merchant-provided.

If any guarantee fails before push, the push is blocked and the failure is recorded in the commit body.

---

## 8. Approval gates

- **Approval 1 (now):** Sign off on §1 (output → UI map), §3 (prerequisite API extensions including stable IDs and recommendation engine move), §4 (decisions D1–D7), and §7 (Final Integrity Guarantee). Once acked I deliver in this order:
  1. Backend prereqs (in order, separately verifiable):
     - 3.A.5 — stable IDs in workspace payload (`counterclaimsById`, `evidenceItemsByField`, `whyWins.*.counterclaimId`, `evidenceFieldKey` rename, etc.).
     - 3.A.2 — raw mutation payload via `?format=raw`, plus the byte-equivalence unit test.
     - 3.A.6 — `derived.recommendationText` / `derived.recommendationHelperText` exposed by the workspace API.
     - 3.A.4 — derived `attachments[]` on workspace response.
     - 3.A.3 — populate `RebuttalSection.evidenceRefs[]` (acceptable to defer; UI renders the explicit empty state if not shipped before the Review tab).
  2. Overview tab.
  3. Evidence tab.
  4. Review & Submit tab.
- **Approval 2 / 3 / 4:** After each commit lands and you've seen it, ack before the next.

Reply **"(plan v3 patch 1 accepted)"** to start with the backend prereqs. Or call out any field/decision to revise — I'll respin before any code lands.
