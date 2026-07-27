# Implementation Plan — Design alignment on a shared presentation model

**Status:** DRAFT FOR REVIEW (rev. 5) — no code to be written until approved.
**Scope:** Embedded Shopify app only (`app/(embedded)/app/**`). **Four approved surfaces:** Dashboard, Disputes list/search, Individual dispute detail, and Settings — all covered by one design system.
**Source of truth:** the four approved Claude Design mockups (`Dashboard.html`, `Disputes.html`, `Dispute Detail.html`, `Settings.html`, project `d706fd3a…`). These are a *specification* to transcribe literally (CLAUDE.md #8), not a starting point to reinterpret.

The single most important thing the mockups establish is not a coat of paint — it is a **shared presentation model** that separates four independent dimensions and refuses to collapse them into one "Needs action / Done" label. Every section below serves that goal, and every rule in this document is internally consistent with the corrected model in §0/§3.

---

## 0. The central reframing (why this plan exists)

Today the code has **one** conflated axis. `figmaStatus()` (`disputeListHelpers.ts:323`) collapses everything into `action-needed | needs-review | under-review | submitted | closed`, and the dashboard/detail derive urgency, hero, and "Needs action / Submitted" chips from that same axis. Consequences confirmed in the audit:

- Every active dispute reads as a merchant task (`nextActionSubmitEvidence` = "Submit evidence" is the *default* next-action cell — `disputeListHelpers.ts:461-472`).
- "Ready to Submit" / "Waiting on Issuer" / "Submitted to bank" language treats DisputeDesk's own work as a merchant queue (`dashboard.readyToSubmit`, `waitingOnIssuer`, en.json:278-280).
- Saved-to-Shopify and confirmed-transmission are conflated (`windowClosedBanner.title` = "Submitted to bank", en.json:1357; `savedBody.fallback` = "…submitted to the bank", en.json:1445).
- Strength arithmetic contradicts the grade (`strengthDetailMixed` = "{strong} strong + {moderate} moderate", en.json:644 — shown next to a "Weak" pill).
- Internal vocabulary leaks ("Automation & Submission Activity", en.json:295; normalized-status enums surfaced as chips).

The fix is **four independent dimensions** carried end to end, each derived from its own inputs and never allowed to overwrite another:

| Dimension | Canonical values | Derived from |
|---|---|---|
| **1. Operational lifecycle** — what DisputeDesk is doing (current state) | `building_evidence` · `monitoring` · `pack_prepared` · `saved_to_shopify` · `under_review` · `won` · `lost` · `closed` | **objective operational facts only** (final outcome, confirmed external transmission, saved-to-Shopify state, verified completed-package state, package build state, whether meaningful monitoring remains). **Never** from strength, coverage, attention, technical errors, or involvement. |
| **2. Merchant attention** — whether the merchant must act | `none` · `opportunity` · `recommended` · `requested` · `blocking` · `technical_error` | **new resolver** over Gorgias review state, deadline risk, blockers, sync/technical errors. Never modifies lifecycle. |
| **3. Evidence strength** — how strong the response is | `strong` · `moderate` · `weak` · `not_assessed` | rules engine only (`caseStrength.overall` / `lib/argument/caseStrength.ts`). **Never re-derived in the UI.** |
| **4. External lifecycle** — where the dispute is with the network | `transmissionConfirmed` (bool) + milestone `Sent to card network` + `outcome` (`pending`/`won`/`lost`/`closed`) | `submission_state === 'submitted_confirmed'` (reliable external) + `final_outcome`. |

**"Sent to card network" is a milestone, not a current lifecycle state.** The audit found no backend field that distinguishes "just sent" from a later "under review" period. Therefore, when `submission_state === 'submitted_confirmed'`:

- **Current lifecycle:** `under_review`
- **Timeline milestone (detail page only):** "Sent to card network"
- **Dashboard bucket:** Under review
- **List primary state:** Under review

Do **not** show "Sent to card network" as a *current* list or dashboard state unless a distinct, reliable external state is later found.

**The central rule:** "No action required" (dimension 2 = `none`, or any non-mandatory attention) is orthogonal to "Done" (dimension 1 ∈ {`under_review`, `won`, `lost`, `closed`}). A dispute can be `monitoring` + `weak` + `none`, and that is a *calm, correct* state — not a task, not a warning.

---

## 1. Current-state audit (preserved)

### 1.1 Dashboard (`app/(embedded)/app/page.tsx` → `EmbeddedDashboardPage`, line 276)

| Region | Component | Notes |
|---|---|---|
| Attention banner | `DashboardAttentionBanner.tsx` | `attentionBannerMessage` plural (en.json:326), CTA "Review now" |
| Operational summary cards | `DashboardOperationalSummary.tsx:169-237` | The four cards to rename/recolor — §4 |
| KPI tiles | `DashboardKpis.tsx:270-343` | "Performance overview" strip — metric audit §14 |
| Recent disputes table | `DashboardRecentDisputesPreview.tsx` | Polaris `Badge` via `normalizedStatusBadge` (157-175) |
| Insights strip | `DashboardOperationalInsightsStrip.tsx` | `fraudIntel.strip*` |
| **"Automation & Submission Activity"** feed | `RecentActivityFeed` (inline `page.tsx:191`) | heading `dashboard.recentActivity` (en.json:295) → rename "DisputeDesk activity" |
| Insights (trend + categories) | `DashboardInsights.tsx` | content unchanged |
| Outcome breakdown | `OutcomeBreakdown` (inline `page.tsx:65`) | content unchanged |
| Help card | `DashboardHelpCard.tsx` | "How to read your dashboard" — matches mockup footer |

- **Data:** `GET /api/dashboard/stats?period=` → `DashboardStats` (`dashboardHelpers.ts:20-85`). Operational buckets in `app/api/dashboard/stats/route.ts:110-149`. Core metrics from `computeDisputeMetrics` (`lib/disputes/metrics.ts`, called route.ts:55). Activity feed from `dispute_events` (route.ts:74-196), event labels `disputeTimeline.eventTypes.*` (en.json:4676), descriptions `…eventDescriptions.*` (en.json:4700).

### 1.2 Disputes list (`app/(embedded)/app/disputes/page.tsx` → `DisputesListPage`, line 128)

- Table: `DesktopDisputesTable.tsx` (8-col grid) / `MobileDisputesList.tsx` → `MobileDisputeCard.tsx`.
- KPI cards (inline `KpiCard`, `page.tsx:72`, rendered 517-560): "Needs action", "Amount at risk", "Strong cases" (sub "Ready to submit"), "Awaiting response" (sub "Submitted to bank"). **Top-left card value = API shop-wide `aggregates.needs_attention`; others = `figmaKpis(disputes)` — two different sources** (`page.tsx:274`, `368`).
- Columns incl. **"Next action"** (`disputes.colNextAction`, en.json:636) → cell `figmaNextAction()` (`disputeListHelpers.ts:461-472`).
- View-model resolvers all in **`disputeListHelpers.ts`**: `figmaStatus` (323), `figmaCaseStrength` (387), `figmaStrengthDetail` (398), `figmaOutcome` (422), `figmaDueDate` (433), `figmaNextAction` (461), `figmaIsUrgent` (479), `figmaRowChrome` (489), `figmaReviewChip` (358), `figmaKpis` (508).
- **No shared Badge/token layer** for merchant surfaces: pill colors hardcoded and duplicated across `DesktopDisputesTable.tsx:66-104`, `MobileDisputeCard.tsx:57-100`, `DashboardOperationalSummary.tsx`, `DashboardKpis.tsx`, `page.tsx` (`STATUS_COLORS:109`, `OUTCOME_COLORS:53`).
- **Data:** `GET /api/disputes` (`app/api/disputes/route.ts`). Selects `*` from `disputes` (so `normalized_status`, `submission_state`, `final_outcome`, `submitted_at`, `closed_at`, `due_at`, `review_state`, `needs_review`, `review_due_at`, `phase`, `amount` flow). Per-row `caseStrength` merged from `evidence_packs.pack_json->case_strength` (Stage A, 211-246) + live recompute `calculateCaseStrength` (254-328). Returns `{ disputes[], aggregates:{needs_attention}, pagination }`. **`pack.status`, `pack.failureCode`, `gorgiasEvidenceStale`, Gorgias pending-count are NOT on the list row** — only folded into `caseStrength`. This gap matters for the attention resolver (§7, §12).

### 1.3 Dispute detail (`app/(embedded)/app/disputes/[id]/page.tsx` → `WorkspaceShell.tsx`)

- **Tabs (LIVE order, `WorkspaceShell.tsx:82-86`, indices 0/1/2):** Overview (0) → `tabs/OverviewTab.tsx`; **Evidence (1)** → `tabs/EvidenceTab.tsx`; **Review & Submit (2)** → `tabs/ReviewSubmitTab.tsx`. Labels `disputes.workspaceShell.tabs.*` (en.json:917-921). Active-tab mapping at 277-285; deep-link `?section=gorgias-comms` forces the Evidence tab (93-101). **The approved mockup order is different** (see §6.0) — Overview → Review and Forward → Evidence — so the tab strip must be reordered and "Review & Submit" renamed.
- **Heading** is inline in `WorkspaceShell.tsx:138-213` (not a component). Title `"Dispute #{id} — {reason}"`, a green "Submitted" / red "Needs action" pill (176-184), a strength pill (185-192), Amount/Customer/Date/Reason grid (196-211). **It does NOT render a deadline line or a "View in Shopify Admin" link.**
- **Shopify Admin URL builder (reliable, reuse verbatim):** `lib/shopify/shopifyAdminUrl.ts` → `getShopifyDisputeUrl(shopDomain, disputeEvidenceGid)` (16-28). Returns `https://admin.shopify.com/store/{handle}/payments/dispute_evidences/{numeric}` or **`null`** when the evidence GID is absent. Tested by `tests/unit/shopifyAdminUrl.test.ts`. Callers: `OverviewTab.tsx:37/666`, `useReviewView.ts:14/60`, `CompleteDefencePackageCard.tsx:1273`.
- **Overview** (`OverviewTab.tsx`, ~1866 lines): hero keyed off `presentationStatus × heroVariant` (`resolveHeroTitle` 333-352, `resolveHeroSubtitle` 354-402); timeline `timelineForPresentation()` 445-599; monitoring banner 828-901; recommendation card 957-981; review-lifecycle banner 706-786. **This existing infrastructure is reused — §6.2 lists exactly what is reused/modified/removed.**
- **Review & Submit** (`ReviewSubmitTab.tsx` → `CompleteDefencePackageCard.tsx` + `InclusionReviewSection.tsx`; hook `useReviewView.ts`). Submit/saved/sent copy to correct (§8); large PDF presentation (`DefencePackageHtmlView.tsx`, `viewPdf`/`reviewDraftPdf`, preview `/api/defence-packages/{id}/preview`).
- **Evidence** (`EvidenceTab.tsx` → `CaseSummaryCard`, `EvidenceUsedSection`, `GorgiasCommsReviewSection.tsx`, `MissingOrWeakSection`). Gorgias actions via `disputes.gorgiasComms.*`. AVS/CVV/fraud-screening framing in `disputes.whyText.*` (en.json:880-894), `disputes.sourceCaption.*` (824-851).

### 1.4 View-model types & fields (`workspace-components/types.ts`)

- `WorkspaceDispute` (61-107): identity/order fields, `dueAt`, `submittedAt` (Shopify `evidenceSentOn`, meaningful only when `submissionState === 'submitted_confirmed'`), `normalizedStatus`, `submissionState` (`not_saved`|`saved_to_shopify`|`submitted_confirmed`|`submission_uncertain`|`manual_submission_reported`), `finalOutcome`, `needsReview`/`needsAttention`/`attentionReason`, `reviewState` (`in_review`|`approved`|`conceded`), `reviewDueAt`.
- `WorkspacePack` (109-188): `savedToShopifyAt` (123), `status` (`queued`|`building`|`saving`|`saved_to_shopify`|`saved_to_shopify_unverified`|`saved_to_shopify_verified`|`failed`), `failureCode`, `lastRebuildOutcome`, `rebuildPending`, `gorgiasEvidenceStale`, `coverage`.
- `PresentationStatus` (17-24): `DRAFT`|`SAVED_TO_SHOPIFY`|`AWAITING_SHOPIFY_AUTO_SUBMISSION`|`SUBMITTED_TO_NETWORK`|`CLOSED_WON`|`CLOSED_LOST`|`CLOSED_UNKNOWN`. Closest existing analogue to the operational lifecycle.
- `CaseStrengthResult` (`lib/argument/types.ts`): `overall`, `heroVariant`, `strengthReasonI18n`, `improvementHintI18n`, signal counts.

**Guardrail tests present:** `tests/unit/disputeDetailCopy.test.ts`, `tests/unit/shopifyAdminUrl.test.ts`.

---

## 2. Mockup-to-component mapping

Legend: **M** = modify existing · **R** = reuse as-is · **N** = new shared component.

### 2.1 Dashboard.html

| Mockup area | Action | Target | Data | Presentation rule |
|---|---|---|---|---|
| State banner (`renderBanner`) | M | `DashboardAttentionBanner.tsx` | `stats.merchantActionCount` (new) | 0 → neutral blue "DisputeDesk is monitoring {N} active disputes / No action is currently required from you." >0 → "{N} disputes need your attention / DisputeDesk is handling everything else automatically." Count = **blocking + requested + merchant-resolvable technical_error only** (deadline risk amplifies emphasis but never adds to the count — §3/§4). |
| Four operational cards | M | `DashboardOperationalSummary.tsx` | mutually-exclusive buckets (§4) | Partition by precedence Closed → Under review → Action required → Building & monitoring |
| Performance overview KPIs | M | `DashboardKpis.tsx` | metric audit §14 | Keep tiles; correct formulas + currency handling |
| Recent disputes table | M | `DashboardRecentDisputesPreview.tsx` | row lifecycle chip from shared resolver | Status column = operational-lifecycle chip (Building evidence / Monitoring / Evidence saved to Shopify / Under review / Won / Lost), not normalized-status enum |
| **"DisputeDesk activity"** feed | M | `RecentActivityFeed` (`page.tsx:191`) | `stats.recentActivity` → plain-language events | Rename heading; translate event vocabulary (§8) |
| Insights / Outcome / Help | R | `DashboardInsights.tsx`, `OutcomeBreakdown`, `DashboardHelpCard.tsx` | unchanged | Restyle to tokens only |

### 2.2 Disputes.html

| Mockup area | Action | Target | Data | Presentation rule |
|---|---|---|---|---|
| Title + subtitle | M | `disputes/page.tsx` | — | Copy per mockup |
| 4 summary cards | M | `KpiCard` inline (`page.tsx:72`) | Active / Amount at risk / **Merchant action required** / Under review | Single source per card (§5); "Merchant action required" = genuine tasks only |
| Filter bar | M | `page.tsx:404-499` | separate lifecycle / strength / attention filters | §11 — three independent dimensions, no merged "canonical status" filter |
| Table columns | M | `DesktopDisputesTable.tsx` / `MobileDisputeCard.tsx` | shared resolver | Rename "Next action" → **"Status & next step"**; two-line cell (lifecycle label + responsibility copy) |
| Case-strength column | M | same | `caseStrength.overall` + evidence description | Grade from rules engine; secondary = evidence *description*, never arithmetic |
| Row emphasis | M | `figmaRowChrome` → new `attentionRowClass` | dimension-2 | Emphasis follows **attention only**; light for opportunity/recommended, warn for blocking, error for technical_error; **none** for active/weak/editable/saved |
| Outcome pill | R (recolor) | same | `final_outcome` | Won / Lost / Pending |

### 2.3 Dispute Detail.html

| Mockup area | Action | Target | Data | Presentation rule |
|---|---|---|---|---|
| Persistent header card | M | `WorkspaceShell.tsx:138-213` | resolver + `getShopifyDisputeUrl` | Operational-lifecycle pill + strength pill + conditional attention pill; deadline line; **"View in Shopify Admin"** secondary button — hidden/disabled when URL is `null` (§6.1), never a guessed fallback |
| Hero banner (Overview) | M | `OverviewTab.tsx` hero (789-826 equivalent) | resolved dimensions → surface copy | Map resolved lifecycle/attention/strength/editable/milestone to copy/layout; **no parallel status system** (§6.2) |
| Outcome card | M | Overview | `outcome` | Won/Lost details |
| Evidence assessment card | M | Overview | `caseStrength` | Strength grade + explanatory copy **only** (no operational callout) |
| Activity timeline | M (reuse) | `timelineForPresentation` | milestones | Keep **separate** "Evidence saved to Shopify" and "Sent to card network" milestones |
| Merchant-attention card | M | Overview | dimension-2 | Blue for recommended/requested opportunity copy; red for technical_error |
| Evidence pack / coverage / submission summary | R (wording) | Overview + Evidence sections | pack coverage | Preserve; wording only |
| Tab bar | M (reorder + label) | `WorkspaceShell.tsx` | — | Reorder to Overview → Review and Forward → Evidence; rename "Review & Submit" → "Review and Forward" (§6.0) |
| Review and Forward tab | **PROTECTED** | `ReviewSubmitTab.tsx` & children | — | Wording-only (§6.3 / §8); reorder/rename of nav only, no content redesign |
| Evidence tab | **PROTECTED** | `EvidenceTab.tsx` & children | — | Wording-only (§6.3 / §8) |

### 2.4 Settings.html (fourth approved surface)

| Mockup area | Action | Target | Notes |
|---|---|---|---|
| Store connection | R | existing settings | — |
| "Your involvement" (Hands-off / Stay involved) | M / NEW-persistence | settings page | Presentation-only preference — approved visible behavior + open decisions in §12/§12S |
| "Saving evidence to Shopify" (Save automatically / Require approval) | M | existing automation mode (`auto`/`review`) | Maps to existing two-mode model (`feedback_two_automation_modes`) |
| Notifications list | M | existing notifications | Copy per mockup; some defaults keyed to involvement (mockup-visible) |
| Gorgias / Team / Billing / Data protection | R | existing | Copy alignment only |
| Pause evidence updates modal | M/verify | existing pause control | Copy per mockup |

---

## 3. Shared resolution layer (the spine)

**New module:** `lib/disputes/presentation/` — pure, dependency-light, unit-tested; imported by (a) `/api/disputes` row mapping, (b) `/api/dashboard/stats` bucketing, (c) the detail workspace hook. Single interpretation for all surfaces; **no page re-derives lifecycle/attention/strength on its own.**

### 3.1 Files

- `types.ts` — canonical enums (dimensions 1–4, §0) + `DisputePresentation` result type.
- `resolveLifecycle.ts` — **objective facts only.** `resolveLifecycle(input) → OperationalLifecycle` where `input = { finalOutcome, transmissionConfirmed, savedToShopify, verifiedPackagePrepared, packBuildState, monitoringPossible }`. **Precedence:**
  1. **Terminal?** → `won` (`final_outcome='won'`) | `lost` (`final_outcome='lost'`) | **`closed`** for every other reliably terminal case: a supported non-won/lost final outcome (`accepted`/`expired`/`refunded`/`canceled`/`closed_other`/`unknown`, §12) **AND** a dispute in a reliable terminal state whose `final_outcome` is missing/incomplete. A terminal dispute is never left un-terminal just because `final_outcome` is null — it resolves to `closed` (neutral), which keeps it inside the Closed bucket rather than disappearing from every card (§4). `Won`/`Lost` labels are used only when a supported final outcome exists; all other terminal states show neutral "Closed".
  2. `transmissionConfirmed` (`submission_state === 'submitted_confirmed'`) → `under_review`.
  3. **saved-to-Shopify — deterministic rule (no ambiguity):**
     - **`submission_state` is authoritative whenever it holds a recognized value.** If `submission_state === 'saved_to_shopify'` → `saved_to_shopify`. If `submission_state` holds any other recognized value (e.g. `not_saved`, `submission_uncertain`, `manual_submission_reported`), that value governs and **`PresentationStatus` may NOT override it** — in particular `PresentationStatus = SAVED_TO_SHOPIFY` can never promote an explicit `submission_state = not_saved` to saved.
     - **`PresentationStatus ∈ {SAVED_TO_SHOPIFY, AWAITING_SHOPIFY_AUTO_SUBMISSION}` is used ONLY when `submission_state` is missing, null, or genuinely unknown/unrecognized** — never as a tiebreak against a recognized `submission_state`.
     - **`pack.savedToShopifyAt` is display-only** (the timestamp shown in copy); it MUST NOT by itself trigger the `saved_to_shopify` lifecycle, so a stale pack timestamp can never override a newer `submission_state` or a rung-1/2 fact.
     - **`manual_submission_reported` is NOT resolved by an earlier rung** (it is merchant-asserted, not externally confirmed, so it is not treated as `transmissionConfirmed` at rung 2). Its lifecycle/attention treatment is **explicitly deferred to open question 6 (§12)**; until decided, it does not emit `saved_to_shopify` on the strength of `PresentationStatus` alone.
  4. **verified** completed-but-not-saved package state → `pack_prepared`. *If no reliable field exists, this rung is skipped entirely (§9).*
  5. package build in progress (`pack.status ∈ {queued, building, saving}`) → `building_evidence`.
  6. **Fallback — factually defensible, never a false "Monitoring":** emit `monitoring` **only when `monitoringPossible` is true**, i.e. an evidence package/assessment already exists **and** the evidence pipeline is actively watching connected sources for changes (not halted). If processing was interrupted or a build **failed** with no completed prepared/saved fact for rungs 3–4 to have fired, do **not** claim `monitoring`: resolve to the last verified operational fact, defaulting to **`building_evidence`** (evidence work not yet complete). `monitoringPossible` is the guard that keeps "Monitoring" a true statement — a failed/interrupted case with nothing prepared falls back to `building_evidence`, and the technical problem is carried on the **attention** dimension (`technical_error` if merchant-resolvable, else internal — §3.1), never on lifecycle.
  - **Input `monitoringPossible`** = (a package/assessment exists) AND (the evidence pipeline is not in a failed/halted state). It is derived from objective build/monitoring facts — **not** from the attention dimension — so this rung still reads no technical-error *attention* value; it reads the objective *fact* of whether monitoring is actually running.
  - **`resolveLifecycle()` MUST NOT read:** coverage, fatal-loss rules, evidence strength, hero variant, merchant attention, communication availability, or involvement preference. Coverage/fatal-loss may influence evidence-assessment copy (§6.2), never lifecycle. (It reads the objective *fact* of an interrupted/failed build to avoid a false "Monitoring", but never the merchant-facing `technical_error` attention value.)
- `resolveAttention.ts` — `resolveAttention(input) → MerchantAttention`. Never returns or mutates a lifecycle value. A technical or internal failure sets **attention** only (or nothing); lifecycle stays `building_evidence`/`monitoring` per objective facts. There is no `monitoring_problem` lifecycle. **Deadline risk is a separate fact, not an attention value** — it raises urgency and visual emphasis (§5) but does not by itself create or gate any attention value.

  **Deterministic, mutually-exclusive definitions (each backend state maps to exactly one attention value; the resolver returns the first that matches, in this precedence):**
  1. `technical_error` — a **merchant-resolvable** technical problem: the merchant can actually fix it (e.g. reconnect/re-authorize expired Gorgias/OAuth credentials). Enters Action required. (Internal failures are excluded — see below.)
  2. `blocking` — **DisputeDesk cannot continue without merchant intervention.** Work is halted pending the merchant (e.g. a required approval before the first Shopify save in review mode, or a required decision without which the pipeline cannot proceed). **A blocked case is Action required regardless of whether a deadline risk exists**; a near deadline only amplifies its emphasis (§5).
  3. `requested` — the merchant has been **explicitly asked** to review, approve, upload, reconnect, or decide something, but work is **not** halted (e.g. Gorgias messages the pipeline surfaced for review as `proposed`/`needs_reapproval`, or a review decision offered but not gating progress). Enters Action required.
  4. `recommended` — a **concrete contribution is available and recommended**, but **no explicit review task has been created** and it is not blocking (e.g. the pipeline identified a specific addable item and recommends it, without raising a review request). Does **not** enter Action required. **Never derived from `caseStrength`/`heroVariant`/generic `improvementHint` copy alone.**
  5. `opportunity` — **something optional is available, but DisputeDesk is not recommending it** (a purely optional add the merchant may make; no recommendation, no request). Does **not** enter Action required. Independent of strength (§8).
  6. `none`.

  The ladder is deterministic: a state that is *blocking* is never also *requested*; a state that is *requested* (an explicit ask) is never also *recommended*; a *recommended* concrete item is never also mere *opportunity*. Each backend signal is classified to exactly one rung during the §12 data-mapping step.
  - **Internal / non-merchant-resolvable failures are NOT merchant attention.** A failed package build, an internal `failureCode`, `submission_state === 'submission_uncertain'`, or `gorgiasEvidenceStale` (stale evidence, which alone is especially insufficient) do **not** set `technical_error`. They trigger (a) an **internal support/ops alert** (DisputeDesk-side; existing/new alerting, out of the merchant Action-required flow) and (b) optional merchant-facing **transparency copy** — neutral, verified wording that does not assert monitoring is unaffected: **"DisputeDesk detected a technical issue and is working to resolve it. No action is currently required from you."** — carrying **no** action and **not** incrementing `merchantActionCount`. Classifying which specific `failureCode`s / signals are merchant-resolvable vs internal is a backend clarification (§12).
- `resolveStrength.ts` — pass-through of `caseStrength.overall` → `strong|moderate|weak`, plus `not_assessed` when no assessment exists yet (§12). No re-derivation. `strengthDisplay(surface, value)` provides per-surface labels (§8).
- `resolvePresentation.ts` — composes the three resolvers + external-lifecycle booleans (`transmissionConfirmed`, `editable`, `outcome`, `sentMilestoneAt`) into one `DisputePresentation`. `resolveAttention` output is **never** allowed to feed back into `resolveLifecycle`.
- `buckets.ts` — `dashboardBucket(presentation)` (§4) and `listActiveFlag(presentation)`.
- `labels.ts` — maps each dimension value to its i18n key per surface (drives §8); all label decisions in one place.

### 3.2 Cross-mockup reconciliation the resolver encodes
- **Strength labels:** list mockup "Strong/Moderate/Weak"; detail mockup "Strong evidence / Partially supported / Limited evidence / Not yet assessed". Canonical values = `strong|moderate|weak|not_assessed`; detail page renders `moderate`→"Partially supported", `weak`→"Limited evidence"; list stays terse. Same underlying `overall`.
- **Lifecycle vs milestone:** `submitted_confirmed` → lifecycle `under_review` on every surface; "Sent to card network" appears only as a detail-page timeline milestone.

---

## 4. Dashboard-bucket precedence (mutually exclusive) + population scope

**Population being bucketed (must be defined, not assumed).** The four operational cards are an **operational inventory**, not an all-time count:
- **Building & monitoring**, **Action required**, and **Under review** are point-in-time snapshots over **all currently unresolved disputes** (no open-date window), consistent with the existing `activeDisputes` snapshot in `lib/disputes/metrics.ts` (which is deliberately *not* period-windowed) and its dormant-inquiry exclusion (`isDormantInquiry`).
- **Closed** is **windowed by `closed_at` ∈ the selected reporting period** — matching the existing `totalClosed`/`closedSplit` (window-scoped) so it reconciles with the outcome tiles and does not dwarf current work with all-time history.

So the four counts sum to **the operational window = (all currently unresolved disputes) + (disputes closed within the selected period)**, *not* the all-time inventory. This split (open = snapshot, closed = period) is confirmed against the current metrics layer; the exact reporting-period default for the Closed card is carried to §12 for confirmation.

`dashboardBucket(presentation)` assigns each dispute in that population to exactly one bucket, in this order (documented in code and tested):

1. **Closed** — **any reliably terminal dispute** within the reporting period: a supported final outcome (Won/Lost, or neutral "Closed" for accepted/expired/refunded/canceled/closed_other/unknown) **or** a reliable terminal state whose `final_outcome` is missing/incomplete (labelled neutral "Closed"). This guarantees the four cards are a **complete partition**: a terminal-but-outcome-null dispute is excluded from Active (§5) and therefore must land here, not vanish. (The alternative — excluding such records and surfacing them as a data-quality exception — is explicitly rejected in favor of this neutral-Closed approach, consistent with the `closed` lifecycle value.)
2. **Under review** — reliable external transmission confirmed (`transmissionConfirmed === true`) AND no final outcome yet.
3. **Action required** — unresolved AND pre-transmission AND `attention ∈ {blocking, requested, merchant-resolvable technical_error}`. `blocking` qualifies regardless of any deadline. A deadline risk does **not** add a case here on its own — it only amplifies emphasis on a case that already has a required merchant action (§5); a case with no required action is never Action required merely because a deadline approaches (DisputeDesk auto-submits).
4. **Building & monitoring** — all remaining unresolved pre-transmission disputes. Includes `building_evidence`, `monitoring`, `pack_prepared`, `saved_to_shopify`, **and** the `opportunity` and `recommended` attention states.

Because Closed and Under review are evaluated first, a closed or under-review dispute with stale attention data attached **never** falls into Action required.

---

## 5. Search / list changes (to match Disputes.html)

1. **Summary cards** (single source each, from the shared resolver):
   - "Active disputes" = `listActiveFlag` (`isActive`). **Definition is a verified allow-list, not "`final_outcome === null`".** "No final outcome yet" is **not** assumed equivalent to active — a dispute can be administratively closed, withdrawn, canceled, or expired while `final_outcome` is null/incomplete. `isActive` must therefore evaluate: (a) not won/lost/`closed`; (b) no reliable closed state (`closed_at` / a terminal `normalized_status` such as `accepted_not_contested`/`closed_other`); (c) not a supported withdrawn/canceled/expired/administratively-closed state; (d) dormant-inquiry excluded (`isDormantInquiry`). The safe implementation **preserves the existing verified allow-list** `ACTIVE_NORMALIZED` (metrics.ts:179-183, which already excludes the terminal states and, crucially, **INCLUDES** `submitted`/`waiting_on_issuer`/`submitted_to_bank`, i.e. under-review) rather than swapping in a null-outcome test. **This deliberately INCLUDES under-review disputes** — active until an outcome is received. Under-review cases appear in *both* the "Active disputes" KPI and the "Under review" operational bucket — the KPI counts inventory, the bucket classifies current state; they are not mutually exclusive. Any move away from the allow-list must first verify each withdrawn/canceled/expired/administratively-closed state (§12).
   - "Amount at risk" = sum of `amount` over the same active set, **including under-review disputes**, in the primary currency only. Non-primary currencies are disclosed as **dispute counts** ("Plus N disputes in {currency}"), never as currency amounts (§13 currency rule).
   - "Merchant action required" = genuine tasks only = `blocking` + `requested` + merchant-resolvable `technical_error`; amber only when > 0. A deadline risk does not add to this count on its own — it only amplifies emphasis on a case already in this set.
   - "Under review" = `transmissionConfirmed && !closed`.
   - **Fixes** the current dual-source bug (top-left API `needs_attention` vs `figmaKpis`).
2. **Column rename:** "Next action" → **"Status & next step"**. Two-line cell: primary operational-lifecycle label + secondary responsibility copy (not an imperative). Examples: `Monitoring / No action required`; `Communication recommended / Customer communication may strengthen this response`; `Review communication / Review the suggested customer messages`; `Evidence saved to Shopify / DisputeDesk will continue monitoring while changes remain possible`; `Under review / The response can no longer be changed`.
3. **Case-strength column:** grade pill from `caseStrength.overall`; secondary line = evidence *description* (Delivery confirmed / Payment and fulfilment support / Customer communication included/missing / Limited delivery evidence / Limited corroborating evidence / Delivery still pending). **Delete** `strengthDetailSignals` and `strengthDetailMixed` (en.json:643-644) — they contradict the grade.
4. **Row emphasis — a graded hierarchy that separates optional suggestions from concrete tasks** (`attentionRowClass(dimension-2)`), replacing `figmaRowChrome`:
   - `opportunity` / `recommended` → **`att-light`**: light, non-alarming emphasis (optional; does not enter Action required).
   - `requested` → **`att-action`**: a **clear Action-required treatment**, visibly distinct from and stronger than the light optional tint — a concrete merchant task.
   - `blocking` → **`att-warn`**: stronger warning treatment (halted work). A deadline risk on a case that already carries a required action (`blocking`/`requested`) also raises it to `att-warn` emphasis — deadline risk is emphasis, never a standalone attention value.
   - merchant-resolvable `technical_error` → **`att-tech`**: error treatment.
   - all else → none.
   **Never** highlight for active/weak/editable/monitoring/saved. `requested`/`blocking`/`technical_error` emphasis is never suppressed by involvement; only the light `opportunity` tint may be affected by involvement (see §12S, and only if the approved mockup keeps it).
   *Note (deliberate refinement of the mockup):* `Disputes.html` applies the same `att-light` tint to opportunity, recommended, **and** requested. Per reviewer direction, this plan separates `requested` into the stronger `att-action` treatment so optional suggestions are visibly distinct from concrete tasks. This is an intentional, reviewer-approved departure from the mockup's row-tint, surfaced here for transparency (CLAUDE.md #8).
5. **Filters — three independent dimensions (§11), not a merged status filter.**
6. **Deadline cell:** never print "Submitted" as a deadline; show "Sent {date}" only once transmission is confirmed; red weight only under genuine, actionable deadline risk (`figmaDueDate` rework, `disputeListHelpers.ts:433`).
7. **Data:** `/api/disputes` must surface the fields the attention resolver needs per row (§7 gap).

---

## 6. Detail-page changes (to match Dispute Detail.html)

### 6.0 Tab order and label (approved nav change)
- **Approved order:** 1) Overview → 2) Review and Forward → 3) Evidence.
- **Live order today:** Overview (0) → Evidence (1) → Review & Submit (2). The earlier draft's claim that the mockup and live order matched was **wrong** and is corrected here.
- Reorder the tab array (`WorkspaceShell.tsx:82-86`), the active-tab mapping (277-285), and the `?section=gorgias-comms` deep-link target (93-101, now the Evidence tab at its new index). Rename `disputes.workspaceShell.tabs.reviewSubmit` "Review & Submit" → **"Review and Forward"**.
- Reordering and renaming the tab navigation are **approved**. They do **not** authorize redesigning either tab's contents.

### 6.1 Heading (`WorkspaceShell.tsx:138-213`)
- Keep title `Dispute #{id} — {reason}` + Amount/Customer/Date/Reason grid.
- **Replace** the green "Submitted" / red "Needs action" pill with the **operational-lifecycle pill** + **evidence-strength pill** + **conditional attention pill**. The attention pill is shown **only when attention ≠ none** — never rendered merely because the merchant chose "Stay involved". When attention is `none`, there is no attention pill in either involvement mode.
- **Add** deadline line "Shopify response deadline: {date}" (label bolded), hidden when not applicable.
- **Add** "View in Shopify Admin" secondary button from `getShopifyDisputeUrl(shopDomain, disputeEvidenceGid)` verbatim. **When it returns `null`:** do **not** construct or guess any fallback URL, and do **not** redirect to a general disputes index — **hide or disable** the action using the approved unavailable-state treatment, with brief explanatory copy that the Shopify Admin link is unavailable if needed. Navigational only; must not imply a Submit/Forward button.

### 6.2 Overview tab (`OverviewTab.tsx`) — reuse the shared resolver, do not build a second one
The Overview must **not** introduce an independent status system. The shared resolver exclusively determines lifecycle, attention, strength, editable state, and external milestones; Overview only maps those resolved dimensions to surface-specific copy/layout.

**Reuse / modify / remove of existing infrastructure:**
- **Reuse (structure):** the hero card container and the timeline renderer `timelineForPresentation()` (445-599) — these become presentation of resolved dimensions rather than re-classifiers.
- **Modify:** `resolveHeroTitle`/`resolveHeroSubtitle` (333-402) become thin maps from `(lifecycle, attention, strength, editable, milestone)` → copy. They no longer branch on `presentationStatus × heroVariant` as a private status axis; those inputs are replaced by the shared `DisputePresentation`.
- **Remove:** any Overview-local classification that duplicates lifecycle/attention/strength (the private `HeroVariant` branching used for status, the "needs action vs submitted" derivation in the header). Evidence strength stays as **assessment copy only**.
- **Map, don't recreate:** the mockup's per-state hero copy is reproduced by mapping each approved presentation to a combination of shared dimensions. Only add a genuinely new presentational variant where the mockup requires copy that no existing dimension-combination covers, and note it explicitly at build time.

**Section order per mockup:** Hero → (conditional) Outcome → Evidence assessment → Activity timeline → (conditional) Merchant-attention card → Evidence pack → Evidence coverage → Submission summary → (Stay-involved) Currently monitoring.

**No strength-based operational callouts (§8):** there is **no** "Strong case, saved to Shopify" green callout and **no** "Strong evidence pack prepared" operational headline. For a **saved, editable** case the primary operational presentation is always:
- Headline: "Evidence saved to Shopify"
- Message: "The latest evidence package has been saved with the Shopify dispute. DisputeDesk will continue monitoring and updating it while changes remain possible."
- Merchant status: "No action required"
- Next milestone: "Shopify response deadline: {date}"

Strength for that case appears only inside the Evidence-assessment card as explanatory copy. "View in Shopify Admin" remains a secondary navigational action regardless of strength.

**Timeline** keeps **separate** "Evidence saved to Shopify" and "Sent to card network" milestones; sent is never inferred from saved.

### 6.3 Protected tabs (redesign forbidden — CLAUDE.md #8)
**Review and Forward** and **Evidence** get **wording-only** corrections (§8). Do not restructure, move components, redesign the PDF presentation, remove manual upload, the Gorgias workflow, approve/exclude, the Shopify Admin link, or simplify evidence explanations. The nav reorder/rename in §6.0 is the only structural change and touches navigation, not tab contents.

---

## 7. Data-field verification (what supports the model; what is ambiguous)

| Model need | Existing field(s) | Verdict |
|---|---|---|
| Final outcome | `final_outcome` (won/lost/partially_won/accepted/refunded/canceled/expired/closed_other/unknown) | **Reliable** for won/lost. Non-won/lost rendering is an open decision (§12). |
| Confirmed transmission | `submission_state='submitted_confirmed'` (Shopify `evidenceSentOn`) | **Reliable** as a boolean → lifecycle `under_review`, milestone "Sent to card network". |
| Saved to Shopify | **Authoritative:** `submission_state` whenever it holds a recognized value (`saved_to_shopify` → saved; any other recognized value governs and cannot be overridden). **Fallback:** `PresentationStatus ∈ {SAVED_TO_SHOPIFY, AWAITING_SHOPIFY_AUTO_SUBMISSION}` **only when `submission_state` is missing/null/unrecognized** — never overrides an explicit `not_saved`. **Display timestamp only:** `pack.savedToShopifyAt`. | **Reliable via `submission_state`.** A pack timestamp alone does **not** prove the current lifecycle and never triggers `saved_to_shopify` by itself (matches §3.1). |
| **Package prepared (completed-but-not-saved)** | none verified | **UNSUPPORTED / AMBIGUOUS.** `queued`/`building`/`saving`/`failed` and the mere existence of a draft record do **not** prove a completed, ready package. **Do not infer `pack_prepared`.** Until an exact completed-but-not-saved backend state is verified, the resolver skips the `pack_prepared` rung and falls back to `building_evidence` or `monitoring` per verified facts. Backend clarification, not an assumed rule (§12). |
| Editable vs non-editable | `derived.isReadOnly`, `derived.readiness`, `submission_state` | **Usable** (read-only once transmitted/closed). Confirm the "saved but response locked, awaiting transmission" edge. |
| Outcome received | `final_outcome` | **Usable**; non-won/lost mapping open (§12). |
| Merchant communication review | Gorgias review status (`proposed`/`needs_reapproval`/`approved`/`excluded`/`bad_match`) | **Present on detail; NOT on the list row.** Must be surfaced to `/api/disputes` for list-level attention (§12). |
| Integration / sync error | `pack.status='failed'`, `pack.failureCode`, `pack.gorgiasEvidenceStale`, `submission_state='submission_uncertain'` | **Partial.** A distinct first-class "Gorgias connection expired" signal may not exist — confirm or derive (§12). |
| Merchant-reported submission | `submission_state='manual_submission_reported'` | **Merchant-asserted, not externally confirmed.** Do not treat as `transmissionConfirmed`; mapping open (§12). |
| Response strength | `caseStrength.overall` + `heroVariant` | **Reliable.** `not_assessed` (pre-assessment) is **new** — confirm it can be represented distinctly from `weak` (§12). |

**Do not guess** any flagged row — each is carried into §12.

---

## 8. Copy inventory

Representative; the full sweep touches `dashboard`, `disputes`, `disputeTimeline`, and `fraudIntel` namespaces in `messages/en.json`. **All new/changed keys must be translated across all 6 locales in the same session** (`feedback_translate_on_add`; en/de/es/fr/pt/sv), and `scripts/verify-i18n-parity.mjs` must stay green.

| # | Current | Replacement | Where | Condition |
|---|---|---|---|---|
| 1 | "Automation & Submission Activity" (295) | "DisputeDesk activity" | Dashboard feed heading | always |
| 2 | "Ready to Submit" / "Evidence complete" (278,329) | *(card removed)* | Dashboard op cards | — |
| 3 | "Waiting on Issuer" / "Submitted to bank" (280,330) | "Under review" / "Response sent" | Dashboard op cards | always |
| 4 | "Action Needed" / "Needs manual review" (277,328) | "Action required" / "Needs your input" | Dashboard op cards | always |
| 5 | attention banner (326) | neutral: "DisputeDesk is monitoring {n} active disputes" + "No action is currently required from you." / attention: "{n} disputes need your attention" + "DisputeDesk is handling everything else automatically." | Dashboard banner | by `merchantActionCount` |
| 6 | "Next action" (636) | "Status & next step" | List column header | always |
| 7 | "Submit evidence"/"Add evidence"/"Review before submitting"/"Waiting for bank" (646-649) | lifecycle label + responsibility subcopy (Monitoring/No action required; Communication recommended/Customer communication may strengthen this response; Review communication/Review the suggested customer messages; Evidence saved to Shopify/DisputeDesk will continue monitoring while changes remain possible; Under review/The response can no longer be changed) | List cell | per lifecycle/attention |
| 8 | "{strong} strong + {moderate} moderate" / "{count} strong signals" (643-644) | evidence descriptions (Delivery confirmed / Payment and fulfilment support / Customer communication included/missing / Limited delivery evidence / Limited corroborating evidence / Delivery still pending) | List strength subtitle | per evidence |
| 9 | "Ready to submit" (627) / "Submitted to bank" (629) | "Merchant action required" / "Under review" card copy | List KPI cards | always |
| 10 | statusPill "Submitted"/"Needs action" (928-929) | operational-lifecycle + strength + conditional attention pills | Detail heading | per resolver |
| 11 | "Submitted to Shopify" / "Submitted to bank" (`windowClosedBanner.title` 1357, `savedBody.fallback` 1445, etc.) | "Evidence saved to Shopify" / "Sent to card network" | Review/Evidence tabs | "Sent" only when `transmissionConfirmed` |
| 12 | "Submit now" (333), "Submit now anyway" (991), "Submit to Shopify" (988/1456) | "View in Shopify Admin" (reuse `overviewExtra.viewInShopify`, 989) for the general merchant action | Detail heading / Overview | link available; hidden/disabled when URL `null` (§6.1) |
| 13 | "Review & Submit" tab (921) | "Review and Forward" | Detail tab label | approved (§6.0) |
| 14 | Evidence "Strong" framing on AVS/CVV alone (`whyText.avs_cvv_match` 891, etc.) | "The evidence package contains supporting payment, fraud-screening, and fulfilment signals." (+ optional "The significance of these signals depends on the dispute reason and the other evidence available.") | Evidence tab | wording-only |
| 15 | Gorgias states | "Approved for inclusion" / "Not included" / "Reported as an incorrect match" | Evidence tab | wording-only |
| 16 | activity event enums (`disputeTimeline.eventTypes.*`) | Dispute detected / Evidence collection started / Evidence package created / Customer communication recommended / Evidence saved to Shopify / Evidence sent to card network / Dispute is under review / Outcome received | Dashboard + detail activity | per event |

---

## 9. Package-prepared semantics (explicit)

`pack_prepared` is emitted **only** when a verified backend state proves the package is completed and not yet saved. The mere existence of a draft/evidence-pack row, or a status of `queued`/`building`/`generating`/`saving`/`failed`, does **not** qualify. If no reliable completed-but-not-saved field is confirmed:

- The `pack_prepared` rung in `resolveLifecycle` is skipped.
- The dispute resolves to `building_evidence` (if a build is in progress) or `monitoring` (otherwise), per verified facts.
- The list/detail "Evidence package prepared" presentation is treated as **unsupported** until the field is verified — it is not built on an assumption.

This is tracked as a backend clarification in §12, not an implementation assumption.

---

## 10. Status & visual-state matrix (full specification)

Palette: **neutral** grey `#F1F2F3`/`#4B5563`; **info/blue** `#E0F2FE`/`#075985`; **opportunity/recommended** light-blue tint (`att-light`); **indigo (saved)** `#E0E7FF`/`#3730A3`; **requested (clear task)** `att-action` blue border+tint; **amber (blocking/deadline)** `#FEF3C7`/`#92400E` (`att-warn`); **green (won/sent)** `#D1FAE5`/`#065F46`; **red (merchant-resolvable technical / lost)** `#FEE2E2`/`#991B1B` (`att-tech`). Warning/red is reserved for a genuine reason to act. There is no "Monitoring needs attention" lifecycle anywhere.

This matrix is split into two linked tables sharing the same **Case** key (kept split only for width — it is one specification).

### 10A — Classification (objective facts → resolved dimensions → color)

| Case | Objective backend facts | Lifecycle (primary) | Attention → secondary copy | Strength treatment | Color / emphasis |
|---|---|---|---|---|---|
| Building, no action | pack `queued/building/saving`; no save/outcome | Building evidence | none → No action required | grade or `not_assessed` | blue, no row emphasis |
| Monitoring, no action | not saved; no outcome; monitoring possible | Monitoring | none → No action required | grade | blue, no emphasis |
| Weak, nothing to add | as monitoring; `overall='weak'`; no concrete contribution | Monitoring | none → No action required | Weak (neutral, **not** alarming) | blue, **no** emphasis |
| Optional communication available (opportunity) | editable; an optional add exists but is non-essential | Monitoring | opportunity → Optional: you can add customer communication | grade | `att-light` (optional) |
| Communication recommended | editable; a **concrete** matched/addable contribution exists | Monitoring | recommended → Customer communication may strengthen this response | grade | `att-light` (optional) |
| Gorgias awaiting explicit review | matched conversation `proposed`/`needs_reapproval` | Monitoring | requested → Review the suggested customer messages | grade | **`att-action` (clear task)** |
| Evidence package prepared | *verified* completed-but-not-saved state (else falls back — §9) | pack_prepared *(only if verified)* | none → No action required | grade | indigo, none |
| Saved to Shopify, editable | `submission_state='saved_to_shopify'` (authority) | Evidence saved to Shopify | none *(unless a separate genuine task exists)* → DisputeDesk will continue monitoring while changes remain possible | grade (assessment copy only) | indigo, **no warning** |
| Confirmed transmission (just sent) | `submission_state='submitted_confirmed'`, `submitted_at` recent | Under review | none → The response can no longer be changed | grade | green accent on the Sent milestone; row neutral |
| Under review (awaiting outcome) | `submitted_confirmed`; no `final_outcome` | Under review | none → The response can no longer be changed | grade | grey/neutral, none |
| Won | `final_outcome='won'` | Won | none | grade | green |
| Lost | `final_outcome='lost'` | Lost | none | grade | red |
| Merchant-resolvable technical error | expired Gorgias/OAuth creds the merchant can re-grant | **Building evidence or Monitoring** (objective; `monitoring` only if genuinely monitoring — a failed build with nothing prepared falls back to `building_evidence`, §3.1 rung 6) | technical_error → Reconnect to restore monitoring | unchanged (error never lowers strength) | `att-tech` (error) |
| Internal (non-merchant) technical failure | pack `failed`/internal `failureCode`/`submission_uncertain`/`gorgiasEvidenceStale` | **Building evidence or Monitoring** (objective; `monitoring` only if genuinely monitoring — a failed build with nothing prepared falls back to `building_evidence`, §3.1 rung 6) | **none** → transparency-only (neutral, does not assert monitoring is unaffected): "DisputeDesk detected a technical issue and is working to resolve it. No action is currently required from you." | unchanged | neutral (no merchant emphasis); internal support alert raised |
| Deadline risk requiring intervention | tight `due_at` **and** an unmet required action (e.g. review-mode approval) | *(its objective lifecycle)* | blocking (or requested) → Deadline {date} — please review now | grade | `att-warn` (only then) |

### 10B — Surface presentation (per Case key from 10A)

| Case | Dashboard bucket | Dashboard banner effect | List primary state | Detail Overview presentation | Hands-off effect | Stay-involved effect |
|---|---|---|---|---|---|---|
| Building, no action | Building & monitoring | no increment | Building evidence / No action required | Hero "Building your evidence pack"; monitoring copy | — | may show fuller monitoring detail |
| Monitoring, no action | Building & monitoring | no increment | Monitoring / No action required | Hero "Monitoring"; no action | — | fuller timeline detail |
| Weak, nothing to add | Building & monitoring | no increment | Monitoring / No action required | Assessment card notes limited evidence; **no** task | — | — |
| Optional communication available (opportunity) | Building & monitoring | **no increment** | Monitoring + optional add | Opportunity card (optional) | opportunity emphasis may be de-emphasized (§12S, if mockup keeps it) | opportunity surfaced more prominently |
| Communication recommended | **Building & monitoring** | **no increment** | Communication recommended / Customer communication may strengthen this response | Opportunity card, optional "Add customer communication" | optional emphasis may be de-emphasized (§12S) | recommendation surfaced more prominently |
| Gorgias awaiting explicit review | **Action required** | **increments** `merchantActionCount` | Review communication / Review the suggested customer messages | Attention card: review the suggested messages | shown (genuine task; never suppressed) | shown |
| Evidence package prepared | Building & monitoring | no increment | Evidence package prepared *(unsupported until verified — §9)* | "Package prepared; monitoring continues" | — | — |
| Saved to Shopify, editable | Building & monitoring | no increment | Evidence saved to Shopify / DisputeDesk will continue monitoring while changes remain possible | Standard "Evidence saved to Shopify" block (§6.2); **no** strength callout | — | — |
| Confirmed transmission (just sent) | Under review | no increment | Under review | Timeline shows "Sent to card network" milestone; response locked | — | — |
| Under review (awaiting outcome) | Under review | no increment | Under review / The response can no longer be changed | "Card network is reviewing"; outcome pending | — | — |
| Won | Closed | no increment | Won | Outcome card (won) | — | — |
| Lost | Closed | no increment | Lost | Outcome card (lost) | — | — |
| Merchant-resolvable technical error | **Action required** | **increments** `merchantActionCount` | Technical attention required | Attention card with reconnect action | shown (never suppressed) | shown |
| Internal (non-merchant) technical failure | **not** Action required — stays Building & monitoring | **no increment** | (its objective lifecycle); optional transparency note | Transparency note only; no action | transparency note may be quieter | transparency note shown |
| Deadline risk requiring intervention | **Action required** *(only in that situation)* | **increments** `merchantActionCount` | (lifecycle) + amber deadline | Hero deadline emphasized; action stated | shown (never suppressed) | shown |

---

## 11. List filters — three independent dimensions

The list exposes three orthogonal filter dimensions; they are never merged into one "canonical status" filter, and existing (incorrect) query logic is not preserved under new labels.

1. **Lifecycle filter** (uses lifecycle values only): All · Monitoring (building_evidence + monitoring + pack_prepared) · Saved to Shopify · Under review · Won · Lost · Closed. **"Sent to card network" is not a lifecycle filter value** — with current data it is indistinguishable from Under review. The mockup's separate "Sent" and "Under review" options both resolve to `under_review`; the plan presents a single **Under review** option and drops the redundant "Sent to card network" filter.
2. **Evidence-strength filter** (independent): Any · Strong · Moderate · Weak — from `caseStrength.overall`, never from lifecycle.
3. **Merchant-attention filter** (independent): the mockup's "Attention required" maps to genuine tasks only = `blocking` + `requested` + merchant-resolvable `technical_error` (a deadline risk amplifies emphasis but is not itself an attention value). Optional communication (`recommended`) and other `opportunity` states are surfaced through an **optional communication / opportunity** attention filter value **only if** the approved mockup provides that control — they are never folded into "Attention required".

Mockup control mapping: `Disputes.html`'s status `<select>` (`all/monitoring/comm/saved/sent/review/won/lost/attention`) maps as — `monitoring`→lifecycle Monitoring; `comm`→attention (recommended/requested) presentation filter; `saved`→lifecycle Saved to Shopify; `sent`+`review`→single lifecycle Under review; `won`/`lost`→lifecycle; `attention`→merchant-attention genuine-tasks filter. The `strength` `<select>` maps to the independent strength dimension.

---

## 12. Data-field / product open questions (must be answered before/at build)

Resolved by this revision and therefore **removed**: sent-vs-under-review separation; Review & Submit rename; dashboard-bucket mutual exclusivity; whether coverage maps into lifecycle; whether `monitoring_problem` is derived.

Remaining genuine unknowns:

1. **Exact completed-but-not-saved package state** — is there a reliable backend field that means "package built and ready, not yet saved"? If not, `pack_prepared` is not emitted (§9).
2. **`not_assessed` strength** — can we represent "no assessment yet" distinctly from `weak` (`overall` is 3-valued today)?
3. **Technical-failure classification (merchant-resolvable vs internal)** — which specific signals are merchant-resolvable (→ attention `technical_error`, enters Action required) vs internal (→ support/ops alert + optional transparency copy, **no** Action required)? Needs a per-`failureCode` classification and confirmation of whether a reliable "Gorgias/OAuth credentials expired — merchant can re-grant" signal exists. Default until classified: only an explicit merchant-reconnect state is `technical_error`; `pack.status='failed'`/internal `failureCode`/`submission_uncertain`/`gorgiasEvidenceStale` are internal (no merchant action).
4. **List-row data surfacing** — how to efficiently add `pack.status`/`failureCode`/`gorgiasEvidenceStale`/Gorgias-pending (and the "concrete addable contribution" signal that gates `recommended`) to the `/api/disputes` row so list-level attention is accurate (query-shape decision).
5. **Non-won/lost final outcomes, `isActive`, and terminal-without-outcome routing** — presentation of `accepted`/`expired`/`refunded`/`canceled`/`closed_other`/`unknown` (proposal: neutral "Closed", not "Lost"), their win-rate treatment (§13.1 DECISION rows), confirmation that each withdrawn/canceled/expired/administratively-closed state is reliably terminal so `isActive` excludes it, **and** which state(s) constitute a "reliable terminal state with missing/incomplete `final_outcome`" that resolves to `closed`/Closed per §3.1 rung 1 / §4 (so the four cards stay a complete partition). This "reliable terminal state" definition is the shared dependency across `isActive`, the `closed` lifecycle, and the Closed bucket. Until verified, `isActive` stays the existing `ACTIVE_NORMALIZED` allow-list (§5/§13) — not a `final_outcome === null` test.
5b. **Currency disclosure** — `otherCurrencyCounts` is dispute counts; confirm the secondary line stays a count ("Plus N disputes in {currency}") or whether per-currency **monetary** subtotals are wanted (new computation, never a count rendered as money).
6. **`manual_submission_reported`** — merchant-asserted, not externally confirmed. Does it map to `under_review` (and if so, may copy claim transmission)? Proposal: keep lifecycle at `saved_to_shopify`/`monitoring` with a "merchant reported submission" note, `transmissionConfirmed=false`.
7. **Hands-off / Stay involved** — persistence model and the exact approved set of presentation effects; specifically whether the list opportunity-tint de-emphasis and detail-timeline density (open items in §12S) are approved beyond notification defaults.
8. **Any reliable external review state beyond confirmed transmission** — if Shopify later exposes a distinct "under review" signal, revisit the sent-vs-under-review collapse.
9. **Closed operational-card reporting scope** — confirm the population split in §4: the three open buckets are point-in-time snapshots (all unresolved) and **Closed is windowed by the selected reporting period**; confirm the default period for the Closed card.
10. **Win-rate outcome mapping** — confirm the §13.1 DECISION rows (`partially_won`, `accepted`, `expired`, `refunded`/`canceled`). Until confirmed, the metric keeps `won ÷ (won+lost)` with a denominator-disclosing label.

### 12S. Settings / involvement — approved vs. reusable vs. new vs. open (no item listed in two buckets)
- **Approved visible Settings behavior (present in `Settings.html` itself — treated as resolved):** the "Your involvement" control (Hands-off / Stay involved) drives **notification defaults**: some notifications default on only in Stay-involved (mockup toggles "Evidence package ready" and "Monthly chargeback digest" are gated by involvement), and Hands-off reduces nonessential notifications while critical deadline/connection/approval alerts remain non-suppressible. The mockup's own note is authoritative: "This preference changes what you see — not the defence produced."
- **Reusable existing settings:** the "Saving evidence to Shopify" choice (Save automatically / Require approval) maps directly onto the existing `auto`/`review` automation mode.
- **New persistence/backend work:** storing the involvement preference if it is a genuinely new stored field rather than a view-only toggle — scope TBD (§12 item 7).
- **Open product decisions (NOT presented as resolved):** whether involvement additionally affects list/detail *presentation prominence* beyond notifications — specifically (a) de-emphasizing the light `opportunity` row tint in Hands-off (seen in `Disputes.html`) and (b) detail-timeline density "Detailed history" vs "Key milestones" (seen in `Dispute Detail.html`). These appear in the **list/detail** mockups but **not** in the approved **Settings** mockup, so they are held as open decisions and will not be implemented as settled behavior until confirmed. **There is no "always-on attention pill in Stay-involved"** — the attention pill follows attention ≠ none only (§6.1).
- **Hard invariants (involvement must NEVER affect):** objective lifecycle, evidence strength, saved/sent facts, editability, outcomes, required/blocking actions, technical errors, actionable deadline risks, dashboard-bucket truth, or cross-page classification. Hands-off must not conceal available evidence or any genuine task. Stay-involved must not convert `recommended` into `requested`.

### 12V. Verification results (2026-07-24, repository evidence)

Executed as step 1 of §14. Status per §12 item — **RESOLVED** = repo evidence settles it; **DECISION** = product call required before implementing that part.

| Item | Status | Evidence |
|---|---|---|
| 1. Package prepared | **RESOLVED — `pack_prepared` IS supported.** `evidence_packs.status = 'ready'` is exactly "built, complete, not yet saved": `buildPack.ts:640` writes only `ready`/`failed`; the save lifecycle (`saving → saved_to_shopify*`) is written later by the save path (`pipeline.ts:771`, `saveToShopifyJob.ts`). "Awaiting approval" (review mode) = `status='ready'` AND `approved_for_save_at IS NULL` (`app/api/packs/[packId]/approve/route.ts:51,67`). `draft`/`blocked` exist in the enum but are never written by the builder — not used. §9's fallback stays for rows without a pack. |
| 2. `not_assessed` strength | **RESOLVED.** `CaseStrengthLevel = strong\|moderate\|weak\|insufficient` (`lib/argument/types.ts:13`). Empty checklist → `overall='insufficient'` (`caseStrength.ts:360-364`) — a true pre-assessment value distinct from `weak`. Map `not_assessed` ⇔ `overall==='insufficient'` (or missing caseStrength). Never key off `heroVariant` (`insufficient` and `weak` both collapse to `hard_to_win`, `caseStrength.ts:784`). |
| 3. Technical-failure classification | **LARGELY RESOLVED.** Merchant-resolvable signal exists first-class: `integrations.status='needs_attention'` + `meta.error_code='reconnect_required'`, set on Gorgias 401/403 (`enrichGorgiasCommsJob.ts:493-511`, trigger `:316-329`) — this is attention `technical_error`. Internal (never merchant attention): `evidence_packs.failure_code='order_fetch_failed'` (the only value written, `buildPack.ts:641`); all `defence_packages.failure_code` values (`covered_shopify`/`no_bank_eligible_facts`/`validation_failed`/`llm_error`/`pdf_render_failed`/`daily_cap_reached`, `lib/defence/types.ts:35-41`); `submission_uncertain` (never runtime-written; backfill only); `gorgiasEvidenceStale` (a regenerate nudge in `pack_json`, not a failure — RPCs `20260714160000:185,278`). Billing reasons (`quota_exceeded`/`feature_blocked`/`subscription_expired`/`payment_failed`, `attentionReasons.ts:21-67`) halt the pipeline pending a merchant billing action → classify as **`blocking`** per §3.1's definition. **One DECISION remains:** `SUBMISSION_FAILED` (below). Note: the reconnect signal is currently unplumbed into dispute routes — surfacing it is part of item 4's work. |
| 4. List-row surfacing | **RESOLVED (scoping confirmed).** `/api/disputes` does `select("*")` (`route.ts:49-52`), so `submission_state`, `needs_attention`, `attention_reason`, `attention_payload`, `review_state`, `closed_at` are already per-row — meaning **`requested` is already derivable per-row** via `attention_reason='gorgias_evidence_ready'` + `attention_payload.proposal_count` (`enrichGorgiasCommsJob.ts:269-282`; actionable definition in RPC `gorgias_recompute_attention`, `20260714160000:38-46`). Gaps to add: latest pack `status` (for `pack_prepared`), shop-level integration reconnect state (one lookup per shop), and the server-side concrete-contribution signal for `recommended` — which requires **relocating `canMerchantUpload` + `MERCHANT_ACTIONABLE_FIELDS`/`SYSTEM_DERIVED_FIELDS`/`deriveMissingItems` from `useDisputeWorkspace.ts:95-252` (client hook) into `lib/`** so list/detail/dashboard share one predicate over `pack_json.checklistV2`. |
| 5. Terminal states / non-won-lost outcomes | **RESOLVED (structure); DECISION (labels/win-rate).** Reliable terminal signal = **`closed_at IS NOT NULL`** — independent of `final_outcome`, already used by the dashboard Closed scan (`stats/route.ts:119`). `closed_at` can exist with `final_outcome` NULL: the ingest path writes `closed_at` synchronously but derives `final_outcome` via fire-and-forget `updateNormalizedStatus` (`applyDisputeSnapshot.ts:444/488, 558/647`) — a measured condition (`pct_null_final_outcome`, `dataQuality/audit.ts:44-46`). §3.1 rung 1's neutral-`closed` routing is therefore correct and implementable. Automated paths write only `won/lost/refunded/accepted` (`deriveFinalOutcome.ts:11-19`); `partially_won/canceled/expired/closed_other/unknown` are admin-override-only — so the §13.1 decision narrows to `accepted` + `refunded` in practice. |
| 5b. Currency disclosure | **RESOLVED.** `otherCurrencyCounts` confirmed as dispute counts (`metrics.ts:93-98, 274-294`); the consumer already renders count phrasing (`DashboardKpis.tsx:253-262`). No monetary subtotals exist; plan wording stands. |
| 6. `manual_submission_reported` | **RESOLVED (dead value).** No code path writes it — read-only enum member (exhaustive grep). Handle defensively exactly as planned (`transmissionConfirmed=false`); no product decision needed since it cannot occur outside a manual admin override. |
| 7. Involvement / settings | **RESOLVED (facts); DECISION (binding).** No involvement/verbosity field exists anywhere — genuinely new persistence. Notification prefs are per-shop JSON at `shop_setup.steps.team.payload.notifications` with keys `newDispute/beforeDue/evidenceReady/monthlyDigest/outcome` (`app/api/shop/preferences/route.ts:8-29`); the mockup's "Approval required" toggle has **no** persisted field (new). Automation mode exists in **two** mechanisms: per-pack-type `rules.action->>'mode'` ∈ `auto\|review` (CHECK, `20260423100000:62-69`; canonical type `normalizeMode.ts:24`; default `review`) AND `shop_settings.auto_save_enabled` (+`auto_save_min_score`, `enforce_no_blockers`; `010_automation.sql:7-17`). Which one the Settings radio binds to is a **DECISION** (below). |
| 8. External review state | **RESOLVED.** Two external signals exist: `evidenceSentOn` (→ `submitted_at`, `submission_state='submitted_confirmed'`, `applyDisputeSnapshot.ts:459-466/613-626`) and Shopify status `under_review` (→ `normalized_status='submitted_to_bank'`, `normalizeStatus.ts:40-48`). `transmissionConfirmed` = `submission_state='submitted_confirmed'` OR `normalized_status='submitted_to_bank'`. The lifecycle collapse to `under_review` stands; `submitted_at` supplies the "Sent to card network" milestone date. No finer network state exists. |
| 9. Closed-card scope | **DECISION (evidence contradicts assumption).** Current behavior: the Closed operational count is **all-time** (`stats/route.ts:63-64` comment: "Closed counts must reflect *current* workload… stays unfiltered"; `:119-124`), while its cb·inq footer split is **period-windowed** (`closedSplit` from metrics) — two scopes by design today. Plan §4 proposed windowed. Product must pick one (below); §4 will be updated to match. |
| 10. Win-rate mapping | **DECISION (narrowed).** Current: `won/(won+lost)` (`metrics.ts:324-329`). Only `accepted` and `refunded` occur via automation, so the §13.1 DECISION reduces to those two (plus keeping `partially_won/expired/canceled` default-excluded, which is safe — they never auto-occur). |

**Product decisions (confirmed in-chat 2026-07-24):**
1. **Closed card scope** → **windowed by the selected reporting period** (default 30d); footer split already windowed, so the card becomes internally consistent. §4 stands as written.
2. **Win rate** → **`won ÷ (won + lost + accepted)`** — `accepted` counts as a loss; `refunded` stays excluded (resolved without a ruling on the merits); `partially_won/expired/canceled` remain excluded (never auto-occur). Card label disclosed accordingly.
3. **Settings "Saving evidence to Shopify" radio** → binds to the **per-rule `rules.action.mode` (`auto`/`review`) across all pack types** via the existing `replacePackBasedAutomationRules` path — the canonical two-mode model.
4. **`submission_failed`** → **internal only**: ops/support alert + merchant transparency copy; **not** `technical_error`, not Action required, no `merchantActionCount` increment. (The internal-failure transparency treatment in §3.1/§10 applies.)

**Derived classifications (deterministic applications of the §3.1 definitions to verified signals — documented, not assumptions):**
- Billing halts (`quota_exceeded`/`feature_blocked`/`subscription_expired`/`payment_failed`) → **`blocking`** (pipeline cannot continue without a merchant billing action).
- `missing_required_evidence` (completeness gate blocked auto-save pending merchant-providable evidence) → **`blocking`**.
- `auto_build_off` (merchant disabled auto-build; pipeline will not proceed without their intervention) → **`blocking`**.
- Review-mode approval gate (`rules.action.mode='review'` AND pack `status='ready'` AND `approved_for_save_at IS NULL`) → **`blocking`**.
- `gorgias_evidence_ready` / Gorgias actionable count > 0 → **`requested`**.
- `review_deadline_approaching` (cron explicitly re-asks the merchant to decide on a held dispute) → **`requested`**.
- `gorgiasEvidenceStale`, `order_fetch_failed`, all `defence_packages.failure_code` values, `submission_uncertain`, `submission_failed` → **internal** (transparency only).

---

## 13. Performance-metric & currency audit (Dashboard KPIs) — verified current state + proposed

Audited directly from `computeDisputeMetrics` (`lib/disputes/metrics.ts`), called by `stats/route.ts:55`; `preferredCurrency` from `shops.currency_code`. **Good news: the current metric layer is already mostly correct** — the fixes below are mostly "adopt the existing semantics via the shared resolver and correct only the *labels/cards* that misdescribe them", not formula rewrites.

| Metric | **Current formula (verified)** | **Current time scope** | **Current include/exclude** | **Current currency behavior** | **Proposed correction** |
|---|---|---|---|---|---|
| **Active disputes** | `active.length`, where `active` = rows with `normalized_status ∈ {new, in_progress, needs_review, ready_to_submit, action_needed, submitted, submitted_to_shopify, waiting_on_issuer, submitted_to_bank}` AND not dormant inquiry (metrics.ts:179-183, 303-312) | **Snapshot** — not period-windowed (metrics.ts:198-213) | **Includes** submitted/waiting/under-review states; **excludes** won/lost/accepted_not_contested/closed_other and dormant inquiries | Count spans all currencies (unitless) | **Keep this exact allow-list as `listActiveFlag`** so list KPI and dashboard share one verified definition. **Do NOT** re-express as "`final_outcome === null`" — that is not proven equivalent (withdrawn/canceled/expired/administratively-closed cases can have null outcomes). **Confirms under-review IS active** (§5). |
| **Amount at risk** | `active.filter(primaryCurrency).reduce(sum amount)` (metrics.ts:316-318) | Snapshot | Same active set (incl. under-review); primary currency only | **Already correct** — single primary currency (preferred if present, else most-frequent, else USD); other currencies excluded from the sum and surfaced via `otherCurrencyCounts` (metrics.ts:93-98, 258-296). **`otherCurrencyCounts` is a map of `{currency → DISPUTE COUNT}`, not monetary totals.** | **Keep the primary-currency sum.** Render `otherCurrencyCounts` as **counts, correctly labeled** — e.g. "Plus 10 disputes in CAD, 5 in EUR, 1 in VND" — **never** "+10 CAD" (which reads as a currency amount). The mockup's "+ 10 in CAD, 5 in EUR, 1 in VND" is a **count** disclosure and must be worded that way. If true per-currency monetary subtotals are wanted instead, that is **new** work (sum `amount` grouped by currency) and a separate decision (§12); never present a count as money. No blind USD summation exists today; preserve that. |
| **Win rate** | `round(won / (won+lost) * 100)`; `won/lost` = `outcomeList` with `final_outcome ∈ {won, lost}` (metrics.ts:324-329) | **Windowed by `closed_at` ∈ [periodFrom, periodEnd]** (metrics.ts:224-238) | Denominator = **won + lost only**; `partially_won`/`accepted`/`refunded`/`canceled`/`expired`/`closed_other`/`unknown` **currently excluded from both** numerator and denominator; active & under-review excluded (not closed) | Ratio | **Resolve the outcome mapping (below).** Active/under-review correctly excluded already. |
| **Recovered** | `outcomeList.filter(primaryCurrency).reduce(sum outcome_amount_recovered)` (metrics.ts:332-334) | Windowed by `closed_at` | Closed-in-window; primary currency | Primary-currency sum; `otherCurrencyCounts` is the same dispute-**count** map | **Keep** + count-based disclosure worded as counts ("Plus N disputes in …"), never as currency amounts. |
| **Dispute rate** | From `shop_daily_metrics` via `computeChargebackRate`; `disputeRate = cbPct + inqPct`; `null` when no snapshot or zero orders (metrics.ts:473-504) | Windowed (defaults to 30d, PRD §4) | All disputes ÷ orders; split `cb%`/`inq%` | Ratio (no currency) | **Keep**; mockup's `cb% · inq%` footer maps to `disputeRateCbPct`/`disputeRateInqPct`. Render "—" when `null`. |
| **Outcomes received** (Outcome breakdown) | `outcomeBreakdown` = count by `final_outcome` over `outcomeList` (metrics.ts:378-388) | Windowed by `closed_at` | Closed-in-window final outcomes | Count | **Keep**; ensure labels are plain-language (§8). |

**Rules preserved/enforced:** active inventory ignores open date (snapshot); Amount at risk includes under-review; win-rate denominator excludes active and under-review; **mixed currencies are never summed into one figure** — the current primary-currency total + `otherCurrencyCounts` behavior is preserved rather than replaced with USD conversion. **Disclosure precision:** `otherCurrencyCounts` carries dispute **counts**, so the secondary line must read as counts ("Plus N disputes in {currency}"); a count is never rendered as a currency amount. Per-currency monetary subtotals, if ever desired, are separate new work.

### 13.1 Win-rate outcome mapping (resolve before implementation)

The current denominator is `won + lost` only. Every other `final_outcome` is silently excluded, which is defensible but undocumented. Proposed explicit mapping (each row flagged **DECISION** must be confirmed; until then, the metric keeps the current `won ÷ (won+lost)` and the card copy states "of decided (won/lost) disputes" so it is never misleading):

| `final_outcome` | Numerator (win) | Denominator (decided) | Rationale |
|---|---|---|---|
| `won` | yes | yes | clear win |
| `lost` | no | yes | clear loss |
| `partially_won` | **DECISION** (recommend: yes) | **DECISION** (recommend: yes) | any recovery is a favorable ruling |
| `accepted` | no | **DECISION** (recommend: yes, as a loss) | merchant accepted liability |
| `expired` | no | **DECISION** (recommend: yes, as a loss) | missed deadline = effective loss |
| `refunded` / `canceled` | no | **DECISION** (recommend: exclude) | resolved without a network ruling on the merits |
| `closed_other` / `unknown` | no | exclude | not a decided defence |
| active / under-review (no outcome) | no | exclude | not decided |

If any DECISION is left unconfirmed, that outcome stays **excluded** (current behavior) and the win-rate label discloses the exact denominator. The metric is never shipped with an ambiguous denominator.

---

## 14. Implementation sequence

1. **Verify data semantics** — resolve every §7/§12 flag with the maintainer and confirm current metric formulas in `lib/disputes/metrics.ts`, *before* coding resolvers.
2. **Build shared resolvers** (`lib/disputes/presentation/**`) + unit tests, no UI changes.
3. **Wire resolvers into the two APIs** — `/api/disputes` (per-row presentation; add missing pack/Gorgias fields) and `/api/dashboard/stats` (buckets + `merchantActionCount` + corrected metrics). Keep old fields until UI cuts over.
4. **Shared status/attention token layer** to replace duplicated hardcoded colors across the five files.
5. **Detail heading + Overview** first (sets canonical vocabulary; reorder/rename tabs per §6.0).
6. **Disputes list** (columns, KPIs, three-dimension filters, attention-only row emphasis).
7. **Dashboard** (banner, four mutually-exclusive cards, activity rename/translation, metric corrections).
8. **Settings** copy + save-mode mapping + approved involvement presentation effects (§12S).
9. **Cross-page consistency pass** — the same dispute resolves identically across Dashboard, list, and detail; Settings controls only permitted optional presentation preferences.

Rationale: resolvers first means the four surfaces can never drift into separate logic.

---

## 15. Testing & visual validation

- **Resolver unit tests** covering the §10 matrix, including:
  - `opportunity` and `recommended` do **not** increment Action required / `merchantActionCount`; `requested` and `blocking` **do**.
  - `recommended` is **not** produced from `caseStrength`/`heroVariant`/generic `improvementHint` alone — it requires a concrete available contribution; a weak case with no addable item stays `none`.
  - `requested` renders the distinct `att-action` treatment, not the light `opportunity`/`recommended` tint.
  - **Attention values are mutually exclusive:** each backend fixture maps to exactly one value (a `blocking` case is never also `requested`; a `requested` explicit ask is never also `recommended`; a `recommended` concrete item is never mere `opportunity`).
  - **`blocking` enters Action required with NO deadline present** (blocked ≠ deadline-driven). A deadline risk with no required merchant action does **not** enter Action required and does **not** increment `merchantActionCount` — it only raises emphasis (`att-warn`) on a case that already carries `blocking`/`requested`.
  - **`isActive` uses the verified allow-list**, includes under-review, and **excludes** won/lost/`accepted_not_contested`/`closed_other` and dormant inquiries; a `final_outcome === null` fixture in a terminal/withdrawn state is **not** counted active.
  - **Merchant-resolvable** `technical_error` enters Action required; **internal** failures (`pack.status='failed'`, internal `failureCode`, `submission_uncertain`, `gorgiasEvidenceStale`) do **not** — they stay `none` for the merchant (no increment) and raise an internal alert instead. `gorgiasEvidenceStale` alone never yields merchant action.
  - Closed and Under review take precedence over stale attention (never land in Action required).
  - `technical_error` does **not** change lifecycle.
  - Coverage, fatal-loss, and strength do **not** change lifecycle.
  - Saved-to-Shopify never implies sent (`transmissionConfirmed` independent of saved).
  - **Saved-to-Shopify authority:** `PresentationStatus = SAVED_TO_SHOPIFY` does **not** promote an explicit `submission_state = not_saved` to saved; `PresentationStatus` is consulted **only** when `submission_state` is missing/null/unrecognized; a stale `pack.savedToShopifyAt` never triggers the `saved_to_shopify` lifecycle on its own.
  - **`manual_submission_reported` is not treated as `transmissionConfirmed`** and does not emit `saved_to_shopify` via `PresentationStatus` alone (open question 6).
  - Confirmed transmission resolves to `under_review` and produces a "Sent to card network" milestone.
  - `pack_prepared` is never inferred from mere draft-record existence (§9).
  - **Monitoring fallback is factually defensible:** a **failed/interrupted build with nothing prepared or saved** resolves to `building_evidence`, **not** `monitoring`; `monitoring` is emitted only when `monitoringPossible` is true (package/assessment exists and the pipeline is actively watching).
  - **Complete partition, no orphans:** a **reliably terminal dispute with a missing/incomplete `final_outcome`** resolves to `closed` and lands in the **Closed** bucket (neutral label) — every dispute in the operational population falls into exactly one of the four buckets; a fuzz/fixture sweep asserts zero disputes land in no bucket.
- **Count/filter tests** — dashboard buckets are a mutually-exclusive partition summing to the operational window (all unresolved + closed-in-period, §4), not all-time; a dispute under review is counted in **both** "Active disputes" (KPI) and the "Under review" bucket; list "Under review" filter requires `transmissionConfirmed`; strength and attention filters independent; no "Sent to card network" lifecycle filter.
- **Shopify Admin link** — keep `tests/unit/shopifyAdminUrl.test.ts` green; add a heading test asserting that a `null` URL yields **no** constructed/guessed fallback and a hidden/disabled action.
- **Involvement tests** — Hands-off and Stay-involved change only optional-presentation prominence and never alter objective lifecycle/attention/strength/bucket classification; Stay-involved never converts `recommended` → `requested`.
- **Tab order test** — approved order Overview → Review and Forward → Evidence; deep-link `?section=gorgias-comms` opens Evidence at its new index.
- **Saved-vs-sent regression** — extend `tests/unit/disputeDetailCopy.test.ts`.
- **Metric tests** — "Active disputes" and "Amount at risk" **include** under-review (via the allow-list, not `final_outcome === null`), excluding dormant inquiries; win-rate denominator excludes active/under-review and follows the confirmed §13.1 outcome mapping (with denominator-disclosing label when DECISIONs are unconfirmed); mixed-currency values are never summed into one figure; **`otherCurrencyCounts` is rendered as dispute counts ("Plus N disputes in {currency}"), never as a currency amount.**
- **Cross-page consistency test** — one fixture dispute resolves identically through the list mapper, the stats bucketer, and the detail hook.
- **i18n parity** — `scripts/verify-i18n-parity.mjs` green across 6 locales; forbidden-copy grep passes.
- **Responsive** — list triage cards at 393/375/320px (`feedback_embedded_mobile_design`); Polaris compatibility on `/app/*`.
- **Mockup comparison** — card-by-card diff of **all four** surfaces (Dashboard, Disputes, Dispute Detail, Settings) against their HTML mockups before "done"; `npm test`, `npx tsc --noEmit`, `npm run build`.

---

## 16. Cross-page language & out-of-scope

- The effort spans **four approved surfaces / four approved mockups**: Dashboard, Disputes list, Dispute detail, Settings. Cross-page consistency means the same dispute resolves identically across Dashboard, list, and detail, while Settings controls only permitted optional presentation preferences.
- **Out of scope:** no redesign of Review and Forward or Evidence tab contents (wording-only + the approved nav reorder/rename); no new merchant submission workflow; no changes to unrelated pages (Coverage, Insights, Playbooks, marketing, portal); no backend semantic changes until §12 is resolved.
- **Product statement (corrected):** "DisputeDesk saves dispute evidence to Shopify. The interface must not claim that DisputeDesk directly transmitted the response to the card network unless Shopify or another reliable external source confirms that transmission occurred." (This replaces the earlier, unverified "DisputeDesk never programmatically submits to card networks.")
