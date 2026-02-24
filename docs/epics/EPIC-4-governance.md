# EPIC 4 — Governance Controls and Review Queue

> **Status:** Pending
> **Week:** 3–4
> **Dependencies:** EPIC 1, EPIC 2

## Goal

Merchants configure rules controlling whether disputes get auto-packed or routed to a manual review queue. Completeness gates prevent premature actions.

## Tasks

### 4.1 — Rule Data Model and Evaluator
- Rules in `rules` table: `match` (JSONB) + `action` (JSONB).
- Match schema: `{ reason: string[], status: string[], amount_range: { min?, max? } }`. All AND-joined; empty = match all.
- Action schema: `{ mode: "auto_pack" | "review", require_fields: string[] }`.
- `lib/rules/evaluateRules.ts`:
  - Fetch enabled rules for shop, ordered by priority.
  - First matching rule wins.
  - Default (no match): `review`.

### 4.2 — Rule Execution on Dispute Sync
- After sync, for each new/updated dispute:
  - Evaluate rules.
  - `auto_pack`: trigger `buildPack()` automatically.
  - `review`: set `needs_review = true` on dispute.
  - Log `audit_events` with `event_type: rule_applied`.

### 4.3 — Review Queue UI
- `app/disputes/page.tsx` — "Review Queue" tab showing `needs_review = true` disputes.
- Sorted by due date ascending (most urgent first).
- Each row: dispute summary, due date countdown, completeness, action buttons.

### 4.4 — Rules Settings UI
- `app/settings/rules/page.tsx`:
  - List rules with match summary, action, enabled toggle.
  - "Add Rule" form: multi-select reasons, optional amount range, action dropdown, required fields.
  - Edit / disable / delete.
  - Reorder for priority (up/down arrows).

### 4.5 — Completeness Gate
- On pack preview, if completeness < threshold (default 60%):
  - Warning banner: "Missing recommended evidence."
  - "Save to Shopify" shows confirmation dialog listing missing items.
- Guidance only — merchant can proceed.

### 4.6 — Audit Trail for Rule Execution
- Every evaluation: `event_type: rule_applied` with `{ rule_id, match_conditions, resulting_action }`.
- Manual override: `event_type: rule_overridden`.

## Key Files
- `lib/rules/evaluateRules.ts`
- `app/settings/rules/page.tsx`
- `app/api/rules/route.ts`
- Modified: `lib/disputes/syncDisputes.ts`, `app/disputes/page.tsx`, `app/packs/[packId]/page.tsx`

## Acceptance Criteria
- [ ] Rules apply deterministically; same dispute + same rules = same outcome.
- [ ] Every rule application logged in `audit_events` with full payload.
- [ ] Review queue shows disputes needing review, sorted by due date.
- [ ] Completeness gate warns but does not hard-block.
- [ ] Rules UI allows CRUD + enable/disable + reorder.
- [ ] Override rate trackable from audit events.
