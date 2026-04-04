# EPIC A1 — Automation Pipeline

> **Status:** Done  
> **Week:** 1–3 (parallel with EPIC 1)  
> **Dependencies:** EPIC 0  
> **Last verified against code:** 2026-04-04

## Goal

Shift DisputeDesk from "generate evidence on click" to **automation-first**:
when a new dispute appears, auto-build an evidence pack, run rules +
completeness scoring, and (when gates pass) auto-save evidence back to
Shopify. Submission still happens in Shopify Admin.

## App Store submission scope

**Shopify App Review** does not require a separate “A1 complete” gate: reviewers
validate install, OAuth, embedded UX, described functionality, and policy
compliance on a **development store**. Core flows (sync → pack build → save
evidence to Shopify, billing if applicable) must work end-to-end.

**Product/marketing:** Positioning as “automation-first” is supported in code
and copy; optional hardening (extra integration tests, load scenarios) can
continue after listing. Track any post-launch polish in new tickets rather than
keeping A1 open.

## Architecture

```
Dispute detected (webhook / cron sync)
  │
  ▼
runAutomationPipeline(dispute)
  ├─ auto_build_enabled?  ── No ──▶ skip
  ├─ existing non-failed pack? ──▶ skip (idempotent)
  └─ Yes ──▶ enqueue build_pack job
                │
                ▼
          buildEvidencePack(pack)
            ├─ collect sources (order, tracking, policies)
            ├─ evaluateCompleteness(reason, fields)
            │   └─ score, checklist, blockers, recommended_actions
            └─ evaluateAndMaybeAutoSave(pack)
                  ├─ auto_save_enabled?
                  ├─ score >= threshold?
                  ├─ blockers == 0? (if enforce_no_blockers)
                  ├─ review required?
                  └─ Decision:
                       ├─ auto_save ──▶ enqueue save_to_shopify job
                       ├─ park_for_review ──▶ status = ready (review queue)
                       └─ block ──▶ status = blocked
```

**Code:** [`lib/automation/pipeline.ts`](../../lib/automation/pipeline.ts) (`runAutomationPipeline`, `evaluateAndMaybeAutoSave`), [`lib/jobs/handlers/buildPackJob.ts`](../../lib/jobs/handlers/buildPackJob.ts), [`lib/disputes/syncDisputes.ts`](../../lib/disputes/syncDisputes.ts) (triggers pipeline when `triggerAutomation` and rules yield `auto_pack`).

## Database Changes (010_automation.sql)

### New table: `shop_settings`

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| shop_id | uuid PK FK | — | Links to shops |
| auto_build_enabled | boolean | true | Auto-build packs on new dispute |
| auto_save_enabled | boolean | false | Auto-save to Shopify when gates pass |
| require_review_before_save | boolean | true | Park for review before auto-save |
| auto_save_min_score | int | 80 | Min completeness score (0–100) |
| enforce_no_blockers | boolean | true | Block save if required items missing |

### Extended fields on `evidence_packs`

| Column | Type | Description |
|--------|------|-------------|
| blockers | jsonb | Missing required evidence items |
| recommended_actions | jsonb | Suggested improvements |
| saved_to_shopify_at | timestamptz | When evidence was pushed to Shopify |
| approved_for_save_at | timestamptz | When a reviewer approved the pack |
| approved_by_user_id | uuid | Who approved |

### New pack statuses

`draft`, `blocked`, `saved_to_shopify` (added to existing enum)

## Job Types

| Job | Trigger | Handler |
|-----|---------|---------|
| sync_disputes | Cron (every 5 min) or manual | Fetch disputes from Shopify, upsert, trigger pipeline |
| build_pack | Automation pipeline | Collect sources, score, decide next step |
| save_to_shopify | Auto-save gate or manual approve | Push evidence via GraphQL mutation |

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/automation/settings | Read shop automation settings |
| PATCH | /api/automation/settings | Update automation toggles |
| POST | /api/disputes/sync | Enqueue sync_disputes job |
| POST | /api/packs/:packId/approve | Approve pack → enqueue save_to_shopify |

## Completeness Engine

Per dispute reason (PRODUCT_NOT_RECEIVED, FRAUDULENT, etc.), a static
template defines required and recommended evidence fields. The engine:
1. Compares collected fields against the template.
2. Returns score (0–100), checklist, blockers, recommended_actions.
3. Blockers = missing **required** items.

## Auto-Save Gate

Decision logic:
1. Is auto_save_enabled? No → block.
2. Is score >= auto_save_min_score? No → block.
3. Are blockers empty (if enforce_no_blockers)? No → block.
4. Is require_review_before_save AND not approved? Yes → park for review.
5. Otherwise → auto_save.

## UI Changes

### Marketing Landing Page

- Hero: "Automatic dispute ops for Shopify"
- How it works: Connect once → Auto-generate packs → Auto-save to Shopify
- Pricing: Free (review required), Starter (auto + review), Pro (full auto)

### Embedded Dashboard

- "Automation is ON" banner
- Automation status summary card (toggles + threshold)
- KPI: "Auto-Saved" count

### Portal Dashboard

- Same automation banner + status card
- Dispute status badges: Building, Needs Review, Blocked, Saved to Shopify

### Settings

- Automation toggles: auto-build, auto-save, require-review, blocker gate
- Completeness threshold slider

## Acceptance Criteria

Verification notes point to the canonical implementation.

- [x] New dispute detected → evidence pack created within one job cycle — [`syncDisputes`](../../lib/disputes/syncDisputes.ts) → `runAutomationPipeline` → `build_pack` job ([`lib/automation/pipeline.ts`](../../lib/automation/pipeline.ts)).
- [x] Pack has completeness_score + blockers computed — [`buildPack`](../../lib/packs/buildPack.ts) via [`handleBuildPack`](../../lib/jobs/handlers/buildPackJob.ts).
- [x] If auto_save gates pass → evidence pushed to Shopify automatically — [`evaluateAndMaybeAutoSave`](../../lib/automation/pipeline.ts) enqueues `save_to_shopify` ([`lib/jobs/handlers/saveToShopifyJob.ts`](../../lib/jobs/handlers/saveToShopifyJob.ts)).
- [x] If require_review → pack parked until approved — gate `park_for_review` → status `ready`; merchant uses approve flow.
- [x] Approve action → evidence saved + audit event — [`POST /api/packs/:packId/approve`](../../app/api/packs/[packId]/approve/route.ts) inserts job + `manual_approved_for_save` audit.
- [x] Marketing copy says "automatic" not "click to generate" — i18n e.g. `messages/en-US.json` (`howItWorksStep1`, `howItWorksStep2`, embedded `automationBanner`).
- [x] All copy: "Save via API; submit in Shopify Admin" — policy strings in help/settings (see EPIC-5 / `help.embedded` automation banner).
- [x] shop_settings row auto-created on first access (upsert) — [`ensure_shop_settings`](../../lib/automation/settings.ts) RPC.
- [x] Idempotent: no duplicate packs for same dispute — [`runAutomationPipeline`](../../lib/automation/pipeline.ts) checks existing non-failed pack before insert.
